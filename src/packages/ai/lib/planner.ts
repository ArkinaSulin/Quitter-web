// src/packages/ai/lib/planner.ts
// Basic AI assist: a small, rule-based brain. It scans the board once per
// Preview, marks targets (independently per archetype), then plans each unit
// with one of four simple doctrines: melee, ranged, flying or mounted.
//
// Design rules:
//  - Only the active alliance's opted-in teams are plotted; heroes and units
//    hosting an attached hero are never AI-controlled.
//  - Movement/combat go through the same map rules as the manual pipeline
//    (terrain, walls, structures, doors, org gates, fog, attack cap).
//  - Thresholds use the unit's printed `movementPoints`; move pools use the
//    formation-scaled effective max.
//  - Marks are independent per archetype: melee 2/target, ranged unlimited,
//    flying 1/target, mounted 1/target + a non-mounted friendly mark.
import { Unit, Hex, AllianceGroup, Formation, hexDistance, getOrganizationLevel } from '@/types/gameProtocol';
import { parseWeapons, isProtectedHero } from '@/packages/units';
import { unitAttackCap, isMeleeWeapon, buildSwoopDropPlan, chargeStanceFor, isMeleeReachable } from '@/packages/combat';
import { isUnitRouted } from '@/packages/morale';
import { arcsContain, computeChargeReachable, applyFormationChange, computeMoveBudget, structureClimbPerStep10, isClimbingUnit } from '@/packages/movement';
import { HEX_DIRS, arcOfTarget, facingToward, rotateLeft, rotateRight } from '@/packages/primitives';
import {
  AiArchetype, AiMark, AiPlanContext, AiPlanResult, AiUnitPlan,
} from './types';
import {
  Maneuver, StructureComplex, allianceOf, applyManeuver, applyTurns, archetypeOf, chooseFacing, distanceMap,
  effectiveMax, enemyGroupsOf, enemyPool, hexKeyOf, hexesWithin, isFlankedAt, isFullyUpgraded, isGroundTarget,
  isTargetReachable, maneuversFor, movementContextFor, nextFormationUpgrade,
  primaryMaxRange, reverseDistanceMap, structureComplexFor, surfaceAt, targetPathCost, unitIsAirborne, unitSurface,
} from './board';
import { assignMarks } from './marks';

export type { AiStep, AiArchetype, AiMark, AiUnitPlan, AiPlanContext, AiPlanResult } from './types';
export { hexKeyOf, allianceOf, enemyGroupsOf } from './board';

interface Runtime {
  ctx: AiPlanContext;
  working: Unit[];
  enemies: Unit[];
  byId: Map<string, Unit>;
  byUnit: Map<string, string>;
  groundMaps: Map<string, Map<string, number>>;
  passThroughMaps: Map<string, Set<string>>;
  complexes: Map<string, StructureComplex | null>;
  reverseMaps: Map<string, Map<string, number>>;
  commit: (unit: Unit) => void;
  setTarget: (unitId: string, targetId: string) => void;
  candidates: (unit: Unit, kind: AiArchetype) => Unit[];
}

/** True when a unit may be handed to the AI. Routed units ARE eligible (they flee). */
export function isAiControllable(
  unit: Unit,
  ctx: Pick<AiPlanContext, 'alliances' | 'teams' | 'activeAlliance'>,
  hostedBy: Set<string>,
): boolean {
  if (unit.isDeleted) return false;
  if (unit.isHero) return false;
  if (unit.hidden) return false;
  if ((unit.currentUnitHp ?? 0) <= 0) return false;
  if (unit.attachedToUnitId) return false;
  if (hostedBy.has(unit.id)) return false;
  if (!ctx.teams.includes(unit.team)) return false;
  if (ctx.activeAlliance === null) return false;
  if (allianceOf(unit, ctx.alliances) !== ctx.activeAlliance) return false;
  if ((unit.actionsAvailable ?? 0) < 1 && (unit.movementPointsAvailable ?? 0) < 1) return false;
  return true;
}

/** Legal attack targets of `attacker`, with the basic ranged/melee split. */
export function legalTargets(
  attacker: Unit,
  units: Unit[],
  ctx: Pick<AiPlanContext, 'alliances' | 'formations' | 'visibleHexes'>,
): { unit: Unit; dist: number; isRanged: boolean }[] {
  const group = allianceOf(attacker, ctx.alliances);
  const foes = enemyGroupsOf(group);
  if (foes.size === 0) return [];
  const weapons = parseWeapons(attacker.weaponString || '');
  const weapon = weapons[attacker.activeWeaponIndex ?? 0] ?? weapons[0];
  const form = ctx.formations[attacker.currentFormation];
  const out: { unit: Unit; dist: number; isRanged: boolean }[] = [];
  for (const other of units) {
    if (other.isDeleted || other.hidden || (other.currentUnitHp ?? 0) <= 0) continue;
    if (isProtectedHero(other)) continue;
    if (!foes.has(allianceOf(other, ctx.alliances))) continue;
    const dist = hexDistance(attacker.hex, other.hex);
    if (dist < 1) continue;
    const key = hexKeyOf(other.hex);
    if (ctx.visibleHexes && !ctx.visibleHexes.has(key)) continue;
    const targetArc = arcOfTarget(attacker.hex, attacker.facing, other.hex);
    if (dist > 1) {
      const range = weapon?.range ?? 1;
      const maxRange = Math.max(range, weapon?.maxRange ?? range);
      if (!weapon || !(range > 1 || maxRange > 1) || dist > maxRange) continue;
      if (form && !arcsContain(form.ranged_target_arcs, targetArc)) continue;
      out.push({ unit: other, dist, isRanged: true });
    } else {
      if (form && attacker.currentFormation !== 'Scattered' && !attacker.isHero && attacker.currentFormation !== 'Hero') {
        if (!arcsContain(form.melee_target_arcs, targetArc)) continue;
      }
      out.push({ unit: other, dist, isRanged: false });
    }
  }
  return out;
}

/**
 * The next legal attack target for a live unit.
 *  - If any valid non-routed enemy exists, routed targets are ignored.
 *  - Routed targets are only eligible when every enemy is routed.
 * Order: closest, then lowest morale, then id.
 */
export function nextLegalTarget(
  attacker: Unit,
  units: Unit[],
  ctx: Pick<AiPlanContext, 'alliances' | 'formations' | 'visibleHexes'>,
): { unit: Unit; dist: number; isRanged: boolean } | null {
  const legal = legalTargets(attacker, units, ctx);
  if (legal.length === 0) return null;
  const groups = enemyGroupsOf(allianceOf(attacker, ctx.alliances));
  const hasNonRouted = units.some(u =>
    !u.isDeleted && !u.hidden && (u.currentUnitHp ?? 0) > 0
    && !isProtectedHero(u)
    && groups.has(allianceOf(u, ctx.alliances))
    && !isUnitRouted(u));
  const pool = hasNonRouted ? legal.filter(t => !isUnitRouted(t.unit)) : legal;
  if (pool.length === 0) return null;
  return pool
    .slice()
    .sort((a, b) => a.dist - b.dist
      || moraleOf(a.unit) - moraleOf(b.unit)
      || a.unit.id.localeCompare(b.unit.id))[0];
}

function moraleOf(unit: Unit): number {
  return (unit.baseMorale ?? 0) + (unit.currentMoraleModifier ?? 0);
}

function canAct(unit: Unit): boolean {
  return (unit.actionsAvailable ?? 0) >= 1 && (unit.attacksUsed ?? 0) < unitAttackCap();
}

function isAdjacent(a: Hex, b: Hex): boolean {
  return hexDistance(a, b) === 1;
}

function canAdopt(unit: Unit, formation: string, ctx: Pick<AiPlanContext, 'formations'>): boolean {
  if (formation === unit.currentFormation) return false;
  if (!(unit.formationAvailability ?? []).includes(formation)) return false;
  if (!ctx.formations[formation]) return false;
  if (formation === 'Shield Wall') {
    const weapon = parseWeapons(unit.weaponString || '')[unit.activeWeaponIndex ?? 0] ?? parseWeapons(unit.weaponString || '')[0];
    if (!unit.isShielded || !!weapon?.isTwoHanded) return false;
  }
  return getOrganizationLevel(formation) <= getOrganizationLevel(unit.currentFormation) + 1;
}

function pushFormation(plan: AiUnitPlan, unit: Unit, formation: string, ctx: AiPlanContext): Unit | null {
  if (!canAdopt(unit, formation, ctx)) return null;
  const oldMax = effectiveMax(unit, ctx.formations);
  const newMax = effectiveMax({ ...unit, currentFormation: formation }, ctx.formations);
  const applied = applyFormationChange(unit, oldMax, newMax);
  if (applied.actionsAvailable < 0) return null;
  plan.steps.push({ kind: 'formation', unitId: unit.id, from: unit.hex, formation });
  return {
    ...unit,
    currentFormation: formation,
    organizationLevel: getOrganizationLevel(formation),
    movementPointsAvailable: applied.movementPointsAvailable,
    actionsAvailable: applied.actionsAvailable,
  };
}

function pushTurns(plan: AiUnitPlan, unit: Unit, turns: { dir: 'left' | 'right' }[], ctx: AiPlanContext): Unit | null {
  const next = applyTurns(unit, turns, ctx);
  if (!next) return null;
  for (const turn of turns) plan.steps.push({ kind: 'turn', unitId: unit.id, from: unit.hex, dir: turn.dir });
  return next;
}

function pushMove(
  plan: AiUnitPlan,
  current: Unit,
  maneuver: Maneuver,
  ctx: AiPlanContext,
  elevation?: number,
): Unit {
  let unit = current;
  if (maneuver.turns.length > 0 && maneuver.unit.facing !== unit.facing) {
    unit = pushTurns(plan, unit, maneuver.turns, ctx) ?? unit;
  }
  if (maneuver.path.length === 0) return unit;
  plan.steps.push({
    kind: 'move',
    unitId: unit.id,
    from: unit.hex,
    to: maneuver.dest,
    path: maneuver.path,
    cost: maneuver.cost,
    ...(elevation != null && elevation !== (unit.elevation ?? 0) ? { elevation } : {}),
  });
  const next = applyManeuver(unit, maneuver, ctx);
  return elevation != null ? { ...next, elevation } : next;
}

function pushAttack(plan: AiUnitPlan, unit: Unit, target: Unit, charge = false): Unit {
  plan.steps.push({ kind: 'attack', unitId: unit.id, from: unit.hex, targetId: target.id, target: target.hex, ...(charge ? { charge: true } : {}) });
  return {
    ...unit,
    actionsAvailable: charge ? (unit.actionsAvailable ?? 0) : (unit.actionsAvailable ?? 0) - 1,
    attacksUsed: (unit.attacksUsed ?? 0) + 1,
  };
}

interface ScoredManeuver {
  maneuver: Maneuver;
  score: number;
}

function bestManeuver(
  unit: Unit,
  rt: Runtime,
  mode: 'ground' | 'fly',
  score: (m: Maneuver, threat: Set<string>) => number,
): Maneuver | null {
  const complex = rt.complexes.get(unit.id) ?? null;
  const movement = movementContextFor(unit, rt.working, rt.ctx, mode, complex);
  const list = maneuversFor(unit, rt.working, rt.ctx, mode, complex);
  let best: ScoredManeuver | null = null;
  for (const m of list) {
    const s = score(m, movement.threat);
    if (!Number.isFinite(s)) continue;
    if (!best || s > best.score
      || (s === best.score && m.cost < best.maneuver.cost)
      || (s === best.score && m.cost === best.maneuver.cost && m.turns.length < best.maneuver.turns.length)) {
      best = { maneuver: m, score: s };
    }
  }
  return best?.maneuver ?? null;
}

function planRouted(unit: Unit, plan: AiUnitPlan, rt: Runtime): Unit {
  const m = bestManeuver(unit, rt, 'ground', (candidate, threat) => {
    if (candidate.path.length === 0) return -Infinity;
    if (threat.has(hexKeyOf(candidate.dest))) return -Infinity;
    const mass = rt.enemies.reduce((n, e) => n + hexDistance(candidate.dest, e.hex), 0);
    return mass * 10 - candidate.cost;
  });
  if (!m) return unit;
  return pushMove(plan, unit, m, rt.ctx);
}

function isEngagedByFriendly(target: Unit, self: Unit, rt: Runtime): boolean {
  const group = allianceOf(self, rt.ctx.alliances);
  return rt.working.some(f =>
    f.id !== self.id && !f.isDeleted && !f.hidden && (f.currentUnitHp ?? 0) > 0
    && allianceOf(f, rt.ctx.alliances) === group
    && isAdjacent(f.hex, target.hex));
}

/** Remaining path cost from any hex to `target`, cached per unit/target. */
function reverseMapFor(rt: Runtime, unit: Unit, target: Unit): Map<string, number> {
  const key = `${unit.id}|${target.id}`;
  const cached = rt.reverseMaps.get(key);
  if (cached) return cached;
  const complex = rt.complexes.get(unit.id) ?? null;
  const movement = movementContextFor(unit, rt.working, rt.ctx, 'ground', complex);
  const map = reverseDistanceMap(target.hex, unit, { ...rt.ctx, units: rt.working }, 'ground', movement);
  rt.reverseMaps.set(key, map);
  return map;
}

/**
 * Last-resort movement for a unit that has no useful action. Dropping to
 * Scattered makes movement omnidirectional (free turns), which lets a boxed-in
 * Open Order unit slip out through/around friendly units instead of holding.
 */
function planEscape(
  unit: Unit,
  plan: AiUnitPlan,
  rt: Runtime,
  kind: 'melee' | 'ranged' | 'mounted',
): Unit {
  let u = unit;
  const candidates = rt.candidates(u, kind);

  const findMove = (mover: Unit): { move: Maneuver; target: Unit | null } | null => {
    // A loose move toward a target, scored by the remaining path to it so
    // detours are followed and the unit does not wander into open space.
    for (const target of candidates) {
      const reverse = reverseMapFor(rt, mover, target);
      const m = bestManeuver(mover, rt, 'ground', (man, threat) => {
        if (man.path.length === 0) return -Infinity;
        if (isFlankedAt(man.dest, man.facing, rt.enemies, target.id)) return -Infinity;
        const remaining = reverse.get(hexKeyOf(man.dest)) ?? Infinity;
        if (!Number.isFinite(remaining)) return -Infinity;
        return -remaining * 100 - man.cost * 2 - man.turns.length * 2
          - (threat.has(hexKeyOf(man.dest)) ? 20 : 0);
      });
      if (m) return { move: m, target };
    }
    return null;
  };

  if (u.currentFormation !== 'Scattered') {
    // Probe the Scattered move first so we never spend an action on a formation
    // change that cannot be followed by a move.
    if (!canAdopt(u, 'Scattered', rt.ctx)) return u;
    const oldMax = effectiveMax(u, rt.ctx.formations);
    const newMax = effectiveMax({ ...u, currentFormation: 'Scattered' }, rt.ctx.formations);
    const applied = applyFormationChange(u, oldMax, newMax);
    if (applied.actionsAvailable < 0) return u;
    const probe: Unit = {
      ...u,
      currentFormation: 'Scattered',
      organizationLevel: 0,
      movementPointsAvailable: applied.movementPointsAvailable,
      actionsAvailable: applied.actionsAvailable,
    };
    const found = findMove(probe);
    if (!found) return u;
    plan.steps.push({ kind: 'formation', unitId: u.id, from: u.hex, formation: 'Scattered' });
    u = probe;
    rt.commit(u);
    if (found.target && found.target.id !== (rt.byUnit.get(u.id) ?? null)) rt.setTarget(u.id, found.target.id);
    return pushMove(plan, u, found.move, rt.ctx);
  }

  const found = findMove(u);
  if (!found) return u;
  if (found.target && found.target.id !== (rt.byUnit.get(u.id) ?? null)) rt.setTarget(u.id, found.target.id);
  return pushMove(plan, u, found.move, rt.ctx);
}

/** Adjacent hostiles in ANY of the six surrounding hexes (facing-independent). */
function adjacentFoes(unit: Unit, rt: Runtime): Unit[] {
  return rt.enemies.filter(f => isAdjacent(unit.hex, f.hex) && isGroundTarget(f, rt.ctx));
}

/** Spend leftover MP turning to cover adjacent hostiles with the front arc/ZoC. */
function faceAdjacentHostiles(unit: Unit, plan: AiUnitPlan, rt: Runtime): Unit {
  const foes = adjacentFoes(unit, rt);
  if (foes.length === 0) return unit;
  const choice = chooseFacing(unit, foes, rt.ctx);
  if (choice.turns.length === 0) return unit;
  const turned = pushTurns(plan, unit, choice.turns, rt.ctx);
  return turned ?? unit;
}

/** Can the unit afford one full 10-ft climb step toward an elevated target? */
function canAffordClimb(unit: Unit, target: Unit, rt: Runtime): boolean {
  const top = surfaceAt(target.hex, rt.ctx);
  const cur = unit.elevation ?? 0;
  if (top <= unitSurface(unit, rt.ctx) || cur >= top) return false;
  const inst = rt.ctx.structures?.[`${target.hex.q},${target.hex.r}`];
  const template = inst ? rt.ctx.structureTemplates?.[inst.templateId] : undefined;
  const perStep = structureClimbPerStep10(template, inst, { isMounted: false });
  const budget = computeMoveBudget(unit, effectiveMax(unit, rt.ctx.formations));
  return perStep <= 0 || budget >= perStep;
}

function planMelee(unit: Unit, plan: AiUnitPlan, rt: Runtime): Unit {
  if (isUnitRouted(unit)) return planRouted(unit, plan, rt);
  let u = unit;
  const markedId = rt.byUnit.get(unit.id) ?? null;
  const candidates = rt.candidates(u, 'melee');
  let lockedTarget: Unit | null = null;

  // Climb lock: a hanging unit commits to the target at climbTo. No moves,
  // formation changes, retargeting or escape while it is on the wall.
  if (u.climbTo) {
    const target = rt.enemies.find(e => hexKeyOf(e.hex) === u.climbTo);
    if (!target) return u;
    if (!canAffordClimb(u, target, rt)) return u;
    plan.steps.push({ kind: 'climbAttack', unitId: u.id, from: u.hex, targetId: target.id, target: target.hex });
    return u;
  }

  for (let guard = 0; guard < 16; guard++) {
    // Formation has absolute priority: never attack before fully upgraded.
    if (!isFullyUpgraded(u, rt.ctx)) {
      const ordered = candidates
        .slice()
        .sort((a, b) => (a.id === markedId ? 0 : 1) - (b.id === markedId ? 0 : 1)
          || hexDistance(u.hex, a.hex) - hexDistance(u.hex, b.hex)
          || moraleOf(a) - moraleOf(b)
          || a.id.localeCompare(b.id));
      if (ordered.length === 0) break;
      const nearest = ordered.reduce((a, b) =>
        hexDistance(u.hex, a.hex) <= hexDistance(u.hex, b.hex) ? a : b);
      // At 2-3 hexes: stop and finish the formation upgrade.
      if (hexDistance(u.hex, nearest.hex) <= 3) {
        const upgrade = nextFormationUpgrade(u, rt.ctx);
        if (upgrade) {
          plan.steps.push({ kind: 'formation', unitId: u.id, from: u.hex, formation: upgrade.formation });
          u = upgrade.updated;
          rt.commit(u);
          continue;
        }
        // No upgrade available this activation: use leftover MP to cover any
        // adjacent hostiles, then finish next turn.
        u = faceAdjacentHostiles(u, plan, rt);
        break;
      }
      // Still far: stage toward the closest target that has a safe, non-ZoC
      // staging move (alternates included).
      let moved: Unit | null = null;
      for (const target of ordered) {
        const reverse = reverseMapFor(rt, u, target);
        const m = bestManeuver(u, rt, 'ground', (candidate, threat) => {
          if (candidate.path.length === 0) return -Infinity;
          if (isFlankedAt(candidate.dest, candidate.facing, rt.enemies, target.id)) return -Infinity;
          if (threat.has(hexKeyOf(candidate.dest))) return -Infinity;
          const remaining = reverse.get(hexKeyOf(candidate.dest)) ?? Infinity;
          if (!Number.isFinite(remaining)) return -Infinity;
          return -Math.abs(remaining - 3) * 100 - candidate.cost * 2 - candidate.turns.length * 2;
        });
        if (!m) continue;
        if (target.id !== markedId) rt.setTarget(u.id, target.id);
        moved = pushMove(plan, u, m, rt.ctx);
        break;
      }
      if (!moved) {
        u = faceAdjacentHostiles(u, plan, rt);
        break;
      }
      u = moved;
      rt.commit(u);
      continue;
    }

    const complex = rt.complexes.get(u.id) ?? null;
    const adjacent = adjacentFoes(u, rt);
    const strike = adjacent.filter(t =>
      surfaceAt(t.hex, rt.ctx) <= unitSurface(u, rt.ctx)
      && isMeleeReachable(u, t, rt.ctx.structures, rt.ctx.structureTemplates));
    const climbable = adjacent.filter(t =>
      surfaceAt(t.hex, rt.ctx) > unitSurface(u, rt.ctx)
      && (!complex || complex.hexes.has(hexKeyOf(t.hex))));

    if (strike.length > 0) {
      const target = strike
        .slice()
        .sort((a, b) => moraleOf(a) - moraleOf(b) || hexDistance(u.hex, a.hex) - hexDistance(u.hex, b.hex) || a.id.localeCompare(b.id))[0];
      if (!canAct(u)) {
        u = faceAdjacentHostiles(u, plan, rt);
        break;
      }
      // Face the adjacent target (any of the six sides counts as adjacent).
      const facing = chooseFacing(u, rt.enemies, rt.ctx);
      if (facing.turns.length > 0) {
        const turned = pushTurns(plan, u, facing.turns, rt.ctx);
        if (turned) u = turned;
        rt.commit(u);
      }
      let legal = legalTargets(u, [target], rt.ctx);
      if (legal.length === 0) {
        const direct = turnsTo(u.facing, facingToward(u.hex, target.hex));
        if (direct.length > 0) {
          const turned = pushTurns(plan, u, direct, rt.ctx);
          if (turned) u = turned;
          rt.commit(u);
        }
        legal = legalTargets(u, [target], rt.ctx);
      }
      if (!canAct(u) || legal.length === 0) {
        u = faceAdjacentHostiles(u, plan, rt);
        break;
      }
      u = pushAttack(plan, u, target);
      rt.commit(u);
      continue;
    }

    if (climbable.length > 0) {
      const target = climbable
        .slice()
        .sort((a, b) => moraleOf(a) - moraleOf(b) || a.id.localeCompare(b.id))[0];
      if (!canAffordClimb(u, target, rt)) {
        u = faceAdjacentHostiles(u, plan, rt);
        break;
      }
      plan.steps.push({ kind: 'climbAttack', unitId: u.id, from: u.hex, targetId: target.id, target: target.hex });
      break;
    }

    // No adjacent target: try every candidate in path order. A blocked marked
    // target must not stop the unit from finding an alternate one.
    const map = rt.groundMaps.get(u.id) ?? new Map<string, number>();
    const noStop = rt.passThroughMaps.get(u.id);
    const printed = Math.max(1, u.movementPoints ?? 1);
    const ordered = candidates
      .map(t => ({ t, cost: targetPathCost(map, t.hex, noStop) }))
      .sort((a, b) => {
        const am = a.t.id === markedId ? 0 : 1;
        const bm = b.t.id === markedId ? 0 : 1;
        return am - bm || a.cost - b.cost || moraleOf(a.t) - moraleOf(b.t) || a.t.id.localeCompare(b.t.id);
      });
    if (ordered.length === 0) break;

    // Far travel: open up, then close the distance.
    const far = ordered.find(o => Number.isFinite(o.cost) && o.cost > printed * 2);
    if (far && getOrganizationLevel(u.currentFormation) > 1 && canAdopt(u, 'Open Order', rt.ctx)) {
      const opened = pushFormation(plan, u, 'Open Order', rt.ctx);
      if (opened) { u = opened; rt.commit(u); continue; }
    }

    const tryTarget = (candidate: Unit): Unit | null => {
      const reverse = reverseMapFor(rt, u, candidate);
      const tryMode = (mode: 'engage' | 'stage' | 'progress'): Unit | null => {
        const m = bestManeuver(u, rt, 'ground', (man, threat) => {
          if (man.path.length === 0) return -Infinity;
          if (isFlankedAt(man.dest, man.facing, rt.enemies, candidate.id)) return -Infinity;
          const remaining = reverse.get(hexKeyOf(man.dest)) ?? Infinity;
          if (!Number.isFinite(remaining)) return -Infinity;
          const d = hexDistance(man.dest, candidate.hex);
          if (mode === 'engage') {
            if (d !== 1) return -Infinity;
            return -remaining * 100 - man.cost * 2 - man.turns.length * 2;
          }
          if (mode === 'stage') {
            // Stay outside ZoC until the unit is committed to the final approach.
            if (threat.has(hexKeyOf(man.dest))) return -Infinity;
            return -Math.abs(remaining - 3) * 100 - man.cost * 2 - man.turns.length * 2;
          }
          return -remaining * 100 - man.cost * 2 - man.turns.length * 2
            - (threat.has(hexKeyOf(man.dest)) ? 20 : 0);
        });
        if (!m) return null;
        if (candidate.id !== (rt.byUnit.get(u.id) ?? null)) rt.setTarget(u.id, candidate.id);
        return pushMove(plan, u, m, rt.ctx);
      };
      return tryMode('engage') ?? tryMode('stage') ?? tryMode('progress');
    };

    // Plan against one locked target. Retarget only when it has no legal move.
    let moved: Unit | null = null;
    if (lockedTarget) moved = tryTarget(lockedTarget);
    if (!moved) {
      const pool: { t: Unit; cost: number }[] = lockedTarget
        ? ordered.filter(o => o.t.id !== lockedTarget!.id)
        : ordered;
      for (const entry of pool) {
        const t = entry.t;
        moved = tryTarget(t);
        if (moved) { lockedTarget = t; break; }
      }
      if (!moved) lockedTarget = null;
    }
    if (!moved) break;
    // A zero-cost move can loop; require the manoeuvre to change hex.
    if (moved.hex.q === u.hex.q && moved.hex.r === u.hex.r) break;
    u = moved;
    rt.commit(u);
  }
  if (plan.steps.length === 0) u = planEscape(u, plan, rt, 'melee');
  return u;
}

function ensureRangedPosture(unit: Unit, plan: AiUnitPlan, rt: Runtime, threatened: boolean): Unit | null {
  if (threatened) {
    if (unit.currentFormation === 'Scattered') return unit;
    if (canAdopt(unit, 'Scattered', rt.ctx)) {
      return pushFormation(plan, unit, 'Scattered', rt.ctx) ?? unit;
    }
    return unit;
  }
  // Safe: travel Open Order. Close Order is selected only right before a shot.
  if (unit.currentFormation === 'Scattered' && canAdopt(unit, 'Open Order', rt.ctx)) {
    return pushFormation(plan, unit, 'Open Order', rt.ctx) ?? unit;
  }
  return unit;
}

function planRanged(unit: Unit, plan: AiUnitPlan, rt: Runtime): Unit {
  if (isUnitRouted(unit)) return planRouted(unit, plan, rt);
  let u = unit;
  const primaryRanged = primaryMaxRange(u) > 1;
  if (primaryRanged && (u.activeWeaponIndex ?? 0) !== 0) {
    plan.steps.push({ kind: 'weapon', unitId: u.id, from: u.hex, weaponIndex: 0 });
    u = { ...u, activeWeaponIndex: 0 };
    rt.commit(u);
  }
  const maxRange = Math.max(1, primaryRanged ? primaryMaxRange(u) : primaryMaxRange(u));

  for (let guard = 0; guard < 16; guard++) {
    const markedId = rt.byUnit.get(u.id) ?? null;
    const candidates = rt.candidates(u, 'ranged');
    const target = candidates.find(t => t.id === markedId) ?? candidates[0];
    if (!target) break;
    const near = hexesWithin(u.hex, rt.enemies, 6).filter(t => t.id !== target.id);
    const threatened = near.length > 0;

    const posture = ensureRangedPosture(u, plan, rt, threatened);
    if (posture && posture !== u) { u = posture; rt.commit(u); continue; }
    if (!posture) break;

    const legal = legalTargets(u, rt.enemies, rt.ctx).filter(t => t.isRanged);
    if (legal.length === 0 && canAct(u) && hexDistance(u.hex, target.hex) <= maxRange) {
      // In range but not in the firing arc: face the target.
      const turns = turnsTo(u.facing, facingToward(u.hex, target.hex));
      if (turns.length > 0) {
        const turned = pushTurns(plan, u, turns, rt.ctx);
        if (turned) { u = turned; rt.commit(u); continue; }
      }
    }
    if (legal.length > 0 && canAct(u) && hexDistance(u.hex, target.hex) <= maxRange) {
      if (!threatened && getOrganizationLevel(u.currentFormation) < 2 && canAdopt(u, 'Close Order', rt.ctx)) {
        const closed = pushFormation(plan, u, 'Close Order', rt.ctx);
        if (closed) { u = closed; rt.commit(u); continue; }
      }
      const shot = legal
        .slice()
        .sort((a, b) => hexDistance(u.hex, a.unit.hex) - hexDistance(u.hex, b.unit.hex) || a.unit.id.localeCompare(b.unit.id))[0].unit;
      u = pushAttack(plan, u, shot);
      rt.commit(u);
      continue;
    }

    // No shot: drop out of Close Order to reposition at travel speed.
    if (legal.length === 0 && !threatened && u.currentFormation === 'Close Order' && canAdopt(u, 'Open Order', rt.ctx)) {
      const opened = pushFormation(plan, u, 'Open Order', rt.ctx);
      if (opened) { u = opened; rt.commit(u); continue; }
    }

    // Reposition to exactly the weapon's max range (kite when safe).
    const m = bestManeuver(u, rt, 'ground', (candidate, threat) => {
      if (candidate.path.length === 0) return -Infinity;
      if (isFlankedAt(candidate.dest, candidate.facing, rt.enemies, target.id)) return -Infinity;
      const d = hexDistance(candidate.dest, target.hex);
      return -Math.abs(d - maxRange) * 100 - candidate.cost * 2 - candidate.turns.length * 2
        - (threat.has(hexKeyOf(candidate.dest)) ? 50 : 0);
    });
    if (!m) break;
    u = pushMove(plan, u, m, rt.ctx);
    rt.commit(u);
  }
  if (plan.steps.length === 0) u = planEscape(u, plan, rt, 'ranged');
  return u;
}

function planMounted(unit: Unit, plan: AiUnitPlan, rt: Runtime): Unit {
  if (isUnitRouted(unit)) return planRouted(unit, plan, rt);
  let u = unit;
  const markedId = rt.byUnit.get(u.id) ?? null;
  const ordered = rt.candidates(u, 'mounted')
    .slice()
    .sort((a, b) => (a.id === markedId ? 0 : 1) - (b.id === markedId ? 0 : 1) || a.id.localeCompare(b.id));
  if (ordered.length === 0) return u;

  const split = getOrganizationLevel(u.currentFormation) >= 2;
  const ring = split ? 2 : 4;
  const movement = movementContextFor(u, rt.working, rt.ctx, 'ground', rt.complexes.get(u.id) ?? null);
  const pool = effectiveMax(u, rt.ctx.formations);
  const chargeEnabled = rt.ctx.chargeEnabled !== false;
  const canChargeNow = chargeStanceFor({
    unit: u,
    airborne: false,
    form: rt.ctx.formations[u.currentFormation],
    chargeEnabled,
  }) === 'charge';

  const chargeDestination = (
    state: Unit,
    target: Unit,
  ): { hex: Hex; cost: number; turns: { dir: 'left' | 'right' }[] } | null => {
    if (!canChargeNow) return null;
    const dests: { hex: Hex; cost: number; arc: string; turns: { dir: 'left' | 'right' }[] }[] = [];
    // A charge is a forward wedge; try the current facing and one cheap rotation
    // either way (a mounted unit stages facing the target).
    const tries: { turns: { dir: 'left' | 'right' }[]; unit: Unit }[] = [{ turns: [], unit: state }];
    for (let i = 1; i <= 2; i++) {
      const seq: { dir: 'left' | 'right' }[] = Array.from({ length: i }, () => ({ dir: 'left' as const }));
      const l = applyTurns(state, seq, rt.ctx);
      if (l) tries.push({ turns: seq, unit: l });
      const rseq: { dir: 'left' | 'right' }[] = Array.from({ length: i }, () => ({ dir: 'right' as const }));
      const r = applyTurns(state, rseq, rt.ctx);
      if (r) tries.push({ turns: rseq, unit: r });
    }
    for (const { turns, unit: candidate } of tries) {
      const charge = computeChargeHexes(candidate, rt, pool);
      charge.forEach((cost, key) => {
        const hex = parseKey(key);
        if (!isAdjacent(hex, target.hex)) return;
        const arc = arcOfTarget(target.hex, target.facing, hex);
        if (arc !== 'flank' && arc !== 'rear') return;
        if (movement.threat.has(key)) return;
        dests.push({ hex, cost, arc, turns });
      });
    }
    dests.sort((a, b) => (a.arc === 'rear' ? -1 : 0) - (b.arc === 'rear' ? -1 : 0) || a.cost - b.cost);
    return dests[0] ?? null;
  };

  const applyCharge = (
    target: Unit,
    charge: { hex: Hex; cost: number; turns: { dir: 'left' | 'right' }[] },
  ): Unit => {
    const turned = pushTurns(plan, u, charge.turns, rt.ctx);
    if (!turned) return u;
    u = turned;
    rt.commit(u);
    plan.steps.push({ kind: 'charge', unitId: u.id, from: u.hex });
    u = { ...u, isCharging: true, chargeDistance: 0, actionsAvailable: (u.actionsAvailable ?? 0) - 1 };
    rt.commit(u);
    plan.steps.push({ kind: 'move', unitId: u.id, from: u.hex, to: charge.hex, path: [charge.hex], cost: charge.cost });
    const spent = applyManeuver(u, {
      mode: 'ground', turns: [], unit: u, dest: charge.hex, path: [charge.hex], cost: charge.cost, facing: u.facing,
    }, rt.ctx);
    u = { ...spent, chargeDistance: charge.cost };
    rt.commit(u);
    // The free charge attack.
    const legal = legalTargets(u, rt.enemies, rt.ctx).filter(t => t.unit.id === target.id && !t.isRanged);
    if (legal.length > 0) u = pushAttack(plan, u, target, true);
    plan.steps.push({ kind: 'chargeEnd', unitId: u.id, from: u.hex });
    u = { ...u, isCharging: false, chargeDistance: 0 };
    rt.commit(u);
    // Second action: disengage to the safest reachable hex, then form up.
    const retreat = bestManeuver(u, rt, 'ground', (candidate, threat) => {
      if (candidate.path.length === 0) return -Infinity;
      if (threat.has(hexKeyOf(candidate.dest))) return -Infinity;
      const nearest = rt.enemies.length > 0
        ? Math.min(...rt.enemies.map(e => hexDistance(candidate.dest, e.hex)))
        : 0;
      return nearest * 100 - candidate.cost * 2 - candidate.turns.length * 2;
    });
    if (retreat) {
      u = pushMove(plan, u, retreat, rt.ctx);
      rt.commit(u);
    }
    const upgrade = nextFormationUpgrade(u, rt.ctx);
    if (upgrade) {
      plan.steps.push({ kind: 'formation', unitId: u.id, from: u.hex, formation: upgrade.formation });
      u = upgrade.updated;
      rt.commit(u);
    }
    return u;
  };

  // Try a legal charge against any engaged candidate, not only the marked one.
  if (canChargeNow) {
    for (const target of ordered) {
      if (!isEngagedByFriendly(target, u, rt)) continue;
      const charge = chargeDestination(u, target);
      if (!charge) continue;
      if (target.id !== markedId) rt.setTarget(u.id, target.id);
      return applyCharge(target, charge);
    }
  }

  // Not charging: stage on the ring around the best reachable target.
  for (const target of ordered) {
    const staged = bestManeuver(u, rt, 'ground', (candidate, threat) => {
      if (candidate.path.length === 0) return -Infinity;
      if (isFlankedAt(candidate.dest, candidate.facing, rt.enemies, target.id)) return -Infinity;
      if (threat.has(hexKeyOf(candidate.dest))) return -Infinity;
      const d = hexDistance(candidate.dest, target.hex);
      const arc = arcOfTarget(target.hex, target.facing, candidate.dest);
      const arcBonus = arc === 'rear' ? 15 : arc === 'flank' ? 8 : 0;
      return -Math.abs(d - ring) * 100 + arcBonus - candidate.cost * 2 - candidate.turns.length * 2;
    });
    if (!staged) continue;
    if (target.id !== markedId) rt.setTarget(u.id, target.id);
    u = pushMove(plan, u, staged, rt.ctx);
    rt.commit(u);
    break;
  }
  const upgrade = nextFormationUpgrade(u, rt.ctx);
  if (upgrade) {
    plan.steps.push({ kind: 'formation', unitId: u.id, from: u.hex, formation: upgrade.formation });
    u = upgrade.updated;
    rt.commit(u);
  }
  if (plan.steps.length === 0) u = planEscape(u, plan, rt, 'mounted');
  return u;
}

function planFlying(unit: Unit, plan: AiUnitPlan, rt: Runtime): Unit {
  if (isUnitRouted(unit)) return planRouted(unit, plan, rt);
  let u = unit;
  const markedId = rt.byUnit.get(u.id) ?? null;
  const candidates = rt.candidates(u, 'flying');
  let target: Unit | null = candidates.find(t => t.id === markedId) ?? candidates[0] ?? null;
  if (!target) return u;

  const airborne = unitIsAirborne(u, rt.ctx);
  const elevation = u.elevation ?? 0;
  if (!airborne || elevation < 10) {
    const climb = bestManeuver(u, rt, 'fly', (candidate) => {
      if (candidate.path.length === 0) return -Infinity;
      const d = hexDistance(candidate.dest, target!.hex);
      return -d * 10 - candidate.cost;
    });
    if (!climb) return u;
    const nextElev = Math.min(20, elevation + 10 * Math.max(1, climb.path.length));
    u = pushMove(plan, u, climb, rt.ctx, nextElev);
    rt.commit(u);
  }

  // Swoop up to twice (each swoop = charge action + free attack). The canonical
  // charge/swoop gate decides whether a swoop is legal (airborne, fly points,
  // actions, "Charge and Swoop" scenario toggle).
  const chargeEnabled = rt.ctx.chargeEnabled !== false;
  for (let swoops = 0; swoops < 2; swoops++) {
    if (!target) break;
    const stance = chargeStanceFor({
      unit: u,
      airborne: unitIsAirborne(u, rt.ctx),
      form: rt.ctx.formations[u.currentFormation],
      chargeEnabled,
    });
    if (stance !== 'swoop') break;
    // Face the target so the charge wedge points at it.
    const faceTurns = turnsTo(u.facing, facingToward(u.hex, target.hex));
    if (faceTurns.length > 0) {
      const faced = pushTurns(plan, u, faceTurns, rt.ctx);
      if (!faced) break;
      u = faced;
      rt.commit(u);
    }
    const charged: Unit = { ...u, isCharging: true, chargeDistance: 0, actionsAvailable: (u.actionsAvailable ?? 0) - 1 };
    const swoopPlan = buildSwoopDropPlan(charged, target, {
      units: rt.working,
      alliances: rt.ctx.alliances,
      formations: rt.ctx.formations,
      structures: rt.ctx.structures,
      structureTemplates: rt.ctx.structureTemplates,
      archerReactionEnabled: rt.ctx.reactiveArchery,
    });
    if (!swoopPlan) break;
    plan.steps.push({ kind: 'charge', unitId: u.id, from: u.hex });
    plan.steps.push({ kind: 'swoop', unitId: u.id, from: u.hex, targetId: target!.id, target: target!.hex });
    u = {
      ...charged,
      hex: swoopPlan.landHex,
      elevation: swoopPlan.elevation,
      flySpeedAvailable: Math.max(0, (u.flySpeedAvailable ?? 0) - swoopPlan.cost),
      isCharging: false,
      chargeDistance: 0,
    };
    rt.commit(u);
    target = candidates.find(t => t.id !== target!.id) ?? null;
    if (!target) break;
  }

  // End the activation at 20 ft and at least 2 hexes from every hostile. If a
  // next target exists, stay 2 hexes from it so the next swoop is available.
  const retreatCost = Math.max(1, Math.ceil((20 - (u.elevation ?? 0)) / 10));
  const retreat = bestManeuver(u, rt, 'fly', (candidate) => {
    if (candidate.path.length < retreatCost) return -Infinity;
    const nearest = rt.enemies.length > 0
      ? Math.min(...rt.enemies.map(e => hexDistance(candidate.dest, e.hex)))
      : 99;
    if (nearest < 2) return -Infinity;
    const targetDist = target ? hexDistance(candidate.dest, target.hex) : 2;
    return -Math.abs(targetDist - 2) * 100 + nearest * 10 - candidate.cost * 2 - candidate.turns.length * 2;
  });
  if (retreat) {
    u = pushMove(plan, u, retreat, rt.ctx, Math.min(20, (u.elevation ?? 0) + 10 * retreat.path.length));
    rt.commit(u);
  }
  return u;
}

function parseKey(key: string): Hex {
  const [q, r] = key.split(',').map(Number);
  return { q, r, s: -q - r };
}

function turnsTo(from: number, to: number): { dir: 'left' | 'right' }[] {
  const left: { dir: 'left' | 'right' }[] = [];
  let f = from;
  for (let i = 0; i < 6 && f !== to; i++) { left.push({ dir: 'left' }); f = rotateLeft(f); }
  const right: { dir: 'left' | 'right' }[] = [];
  f = from;
  for (let i = 0; i < 6 && f !== to; i++) { right.push({ dir: 'right' }); f = rotateRight(f); }
  return right.length < left.length ? right : left;
}

function computeChargeHexes(unit: Unit, rt: Runtime, maxHexes: number): Map<string, number> {
  const movement = movementContextFor(unit, rt.working, rt.ctx, 'ground', rt.complexes.get(unit.id) ?? null);
  return computeChargeReachable(
    { hex: unit.hex, facing: unit.facing },
    movement.occupied,
    maxHexes,
    movement.costOfHex,
    movement.blockedEdge,
    movement.threat,
    !!rt.ctx.reactiveArchery,
  );
}

/**
 * Build the Basic plot for the current turn's AI units.
 */
export function planAiMoves(ctx: AiPlanContext): AiPlanResult {
  if (!ctx.activeAlliance || ctx.teams.length === 0) return { plans: [], marks: [] };
  const working = ctx.units.map(u => ({ ...u }));
  const hostedBy = new Set<string>();
  for (const u of working) if (u.attachedToUnitId && !u.isDeleted) hostedBy.add(u.attachedToUnitId);
  const controllable = working.filter(u => {
    if (ctx.excludeUnitIds?.includes(u.id)) return false;
    return isAiControllable(u, ctx, hostedBy);
  });
  if (controllable.length === 0) return { plans: [], marks: [] };

  const byId = new Map(working.map(u => [u.id, u]));
  const allEnemies = enemyPool(ctx, working);
  const primaryEnemies = allEnemies.filter(e => !isUnitRouted(e));
  // Routed units are only eligible when no non-routed enemy exists at all.
  const enemies = primaryEnemies.length > 0 ? primaryEnemies : allEnemies.filter(isUnitRouted);
  if (enemies.length === 0) return { plans: [], marks: [] };

  const meleeUnits = controllable.filter(u => archetypeOf(u) === 'melee');
  const groundOccupied = new Set<string>();
  for (const u of working) {
    if (u.isDeleted || u.hidden || u.attachedToUnitId || (u.currentUnitHp ?? 0) <= 0) continue;
    if ((u.elevation ?? 0) !== 0) continue;
    groundOccupied.add(hexKeyOf(u.hex));
  }

  // Marking uses the board before any unit has acted. Non-flyers are confined
  // to their structure complex, so their distance maps stop at the perimeter.
  const complexes = new Map<string, StructureComplex | null>();
  const passThroughMaps = new Map<string, Set<string>>();
  const groundMaps = new Map<string, Map<string, number>>();
  for (const u of controllable) {
    const complex = archetypeOf(u) === 'flying' ? null : structureComplexFor(u, ctx);
    complexes.set(u.id, complex);
    const movement = movementContextFor(u, working, ctx, 'ground', complex);
    passThroughMaps.set(u.id, movement.passThrough);
    groundMaps.set(u.id, distanceMap(u, { ...ctx, units: working }, 'ground', movement));
  }
  const flyDistance = (u: Unit, t: Unit) => hexDistance(u.hex, t.hex);
  const { marks, byUnit } = assignMarks({
    units: controllable,
    enemies,
    archetypeOf,
    reachable: (u, t) => archetypeOf(u) === 'flying'
      || isTargetReachable(groundMaps.get(u.id) ?? new Map(), t.hex, passThroughMaps.get(u.id)),
    distance: (u, t) => archetypeOf(u) === 'melee' || archetypeOf(u) === 'mounted'
      ? targetPathCost(groundMaps.get(u.id) ?? new Map(), t.hex, passThroughMaps.get(u.id))
      : flyDistance(u, t),
    meleeCap: (target) => {
      let count = 0;
      for (const dir of HEX_DIRS) {
        const adj = { q: target.hex.q + dir.q, r: target.hex.r + dir.r, s: -target.hex.q - dir.q - target.hex.r - dir.r };
        const key = hexKeyOf(adj);
        if (groundOccupied.has(key)) continue; // occupied / pass-through = not standable
        const reachable = meleeUnits.some(m => {
          const map = groundMaps.get(m.id);
          if (!map || !map.has(key)) return false;
          return !passThroughMaps.get(m.id)?.has(key);
        });
        if (reachable) count++;
      }
      return Math.min(6, count);
    },
  });

  const rt: Runtime = {
    ctx,
    working,
    enemies,
    byId,
    byUnit: new Map(byUnit),
    groundMaps,
    passThroughMaps,
    complexes,
    reverseMaps: new Map(),
    commit: (unit) => {
      const idx = working.findIndex(w => w.id === unit.id);
      if (idx >= 0) working[idx] = unit;
      byId.set(unit.id, unit);
    },
    setTarget: (unitId, targetId) => { rt.byUnit.set(unitId, targetId); },
    candidates: (unit, kind) => {
      const map = groundMaps.get(unit.id) ?? new Map<string, number>();
      const noStop = passThroughMaps.get(unit.id);
      let pool = enemies.filter(t => (kind === 'flying' || kind === 'ranged' ? true : isGroundTarget(t, ctx)));
      if (kind === 'melee' || kind === 'mounted') {
        const complex = complexes.get(unit.id) ?? null;
        if (complex) {
          // Prefer enemies inside the complex or immediately on its perimeter;
          // only fall back to exterior targets when there are none.
          const insideOrPerimeter = pool.filter(t => {
            if (complex.hexes.has(hexKeyOf(t.hex))) return true;
            return HEX_DIRS.some(d => complex.hexes.has(`${t.hex.q + d.q},${t.hex.r + d.r}`));
          });
          if (insideOrPerimeter.length > 0) pool = insideOrPerimeter;
        }
      }
      return pool
        .slice()
        .sort((a, b) => {
          const da = kind === 'flying' || kind === 'ranged' ? hexDistance(unit.hex, a.hex) : targetPathCost(map, a.hex, noStop);
          const db = kind === 'flying' || kind === 'ranged' ? hexDistance(unit.hex, b.hex) : targetPathCost(map, b.hex, noStop);
          return da - db || moraleOf(a) - moraleOf(b)
            || hexDistance(unit.hex, a.hex) - hexDistance(unit.hex, b.hex) || a.id.localeCompare(b.id);
        });
    },
  };

  const order: AiArchetype[] = ['flying', 'ranged', 'melee', 'mounted'];
  const queue = controllable.slice().sort((a, b) => {
    const oa = order.indexOf(archetypeOf(a));
    const ob = order.indexOf(archetypeOf(b));
    if (oa !== ob) return oa - ob;
    if (oa === 2) {
      const ma = groundMaps.get(a.id) ?? new Map<string, number>();
      const mb = groundMaps.get(b.id) ?? new Map<string, number>();
      const ta = rt.byUnit.get(a.id);
      const tb = rt.byUnit.get(b.id);
      const da = ta ? targetPathCost(ma, rt.byId.get(ta)?.hex ?? a.hex, passThroughMaps.get(a.id)) : Infinity;
      const db = tb ? targetPathCost(mb, rt.byId.get(tb)?.hex ?? b.hex, passThroughMaps.get(b.id)) : Infinity;
      if (da !== db) return da - db;
    }
    return a.id.localeCompare(b.id);
  });

  const plans: AiUnitPlan[] = [];
  for (const original of queue) {
    const live = byId.get(original.id);
    if (!live || live.isDeleted) continue;
    const archetype = archetypeOf(live);
    const plan: AiUnitPlan = { unitId: live.id, archetype, steps: [] };
    // A climbing/hanging unit may only climb up or down in place. Do not plan
    // horizontal moves, formation changes or escapes for it.
    if (isClimbingUnit(live, ctx.structures, ctx.structureTemplates)) {
      if (!isUnitRouted(live) && live.climbTo) {
        const target = rt.enemies.find(e => hexKeyOf(e.hex) === live.climbTo);
        if (target && canAffordClimb(live, target, rt)) {
          plan.steps.push({ kind: 'climbAttack', unitId: live.id, from: live.hex, targetId: target.id, target: target.hex });
        }
      }
      if (plan.steps.length > 0) plans.push(plan);
      continue;
    }
    try {
      if (archetype === 'flying') planFlying(live, plan, rt);
      else if (archetype === 'ranged') planRanged(live, plan, rt);
      else if (archetype === 'mounted') planMounted(live, plan, rt);
      else planMelee(live, plan, rt);
    } catch (err) {
      // A single unit's failure must never abort the whole plot.
      console.error('AI planner error', err);
    }
    if (plan.steps.length > 0) plans.push(plan);
  }

  // Final marks reflect any retargeting done during planning.
  const finalMarks: AiMark[] = [];
  for (const u of controllable) {
    const targetId = rt.byUnit.get(u.id);
    if (targetId) finalMarks.push({ targetId, byUnitId: u.id, kind: archetypeOf(u) });
  }
  void marks;
  return { plans, marks: finalMarks };
}
