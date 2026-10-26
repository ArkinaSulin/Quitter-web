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
import { isUnitRouted, computeThreatRating } from '@/packages/morale';
import { getSetting } from '@/packages/infra';
import { isHexOnGrid } from '@/packages/world';
import { arcsContain, computeChargeReachable, applyFormationChange, computeMoveCapacity, structureClimbPerStep10, isClimbingUnit, applyMoveCost, moveBudgetUnit, climbPlan, canFly, flyMax, edgeStructureHeightBetween, structureClimbCostBetween } from '@/packages/movement';
import { HEX_DIRS, arcOfTarget, facingToward, rotateLeft, rotateRight } from '@/packages/primitives';
import {
  AiArchetype, AiMark, AiPlanContext, AiPlanResult, AiUnitPlan,
} from './types';
import {
  Maneuver, StructureComplex, allianceOf, applyManeuver, applyTurns, archetypeOf, chooseFacing, distanceMap,
  effectiveMax, enemyGroupsOf, enemyPool, edgeWalls, hexKeyOf, hexesWithin, isFlankedAt, isFullyUpgraded, isGroundTarget,
  isOuterApproachHex, isOuterRimTarget, isInFriendlyKillZone,
  isTargetReachable, maneuversFor, movementContextFor, nextFormationUpgrade, noClimbDistanceMap,
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
  reverseHexMaps: Map<string, Map<string, number>>;
  complexByHex: Map<string, StructureComplex | null>;
  topAccessCache: Map<string, TopAccess | null>;
  climbObjectives: Map<string, Hex>;
  commit: (unit: Unit) => void;
  setTarget: (unitId: string, targetId: string) => void;
  candidates: (unit: Unit, kind: AiArchetype) => Unit[];
}

/** True when a unit may be handed to the AI. Routed units ARE eligible (they flee). */
export function isAiControllable(
  unit: Unit,
  ctx: Pick<AiPlanContext, 'alliances' | 'teams' | 'activeAlliance' | 'gridRadius'>,
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
  if (ctx.gridRadius != null && !isHexOnGrid(unit.hex, ctx.gridRadius)) return false;
  if ((unit.actionsAvailable ?? 0) < 1
    && (unit.movementPointsAvailable ?? 0) < 1
    && (unit.flySpeedAvailable ?? 0) < 1) return false;
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
  const mode = canFly(unit) && unitIsAirborne(unit, rt.ctx) ? 'fly' : 'ground';
  const m = bestManeuver(unit, rt, mode, (candidate, threat) => {
    if (candidate.path.length === 0) return -Infinity;
    if (threat.has(hexKeyOf(candidate.dest))) return -Infinity;
    let nearest = Infinity;
    let mass = 0;
    let overHostile = false;
    for (const enemy of rt.enemies) {
      const distance = hexDistance(candidate.dest, enemy.hex);
      nearest = Math.min(nearest, distance);
      mass += distance;
      if (distance === 0) overHostile = true;
    }
    if (!Number.isFinite(nearest)) return -candidate.cost;
    const crossesHostile = rt.enemies.length > 0 && candidate.path.some(hex =>
      !(hex.q === unit.hex.q && hex.r === unit.hex.r) &&
      rt.enemies.some(enemy => hexDistance(hex, enemy.hex) === 0),
    );
    const penalty = overHostile ? 1_000_000 : crossesHostile ? 100_000 : 0;
    return nearest * 1000 + mass * 10 - penalty - candidate.cost;
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

function reverseHexMapFor(rt: Runtime, unit: Unit, hex: Hex): Map<string, number> {
  const key = `${unit.id}|${hexKeyOf(hex)}`;
  const cached = rt.reverseHexMaps.get(key);
  if (cached) return cached;
  const complex = rt.complexes.get(unit.id) ?? null;
  const movement = movementContextFor(unit, rt.working, rt.ctx, 'ground', complex);
  const map = reverseDistanceMap(hex, unit, { ...rt.ctx, units: rt.working }, 'ground', movement);
  rt.reverseHexMaps.set(key, map);
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
  // Structure defenders hold their ground; never escape off the wall.
  if (isStructureBound(unit, rt) && !isUnitRouted(unit)) return unit;
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
/** Can the unit afford one full climb step toward `climbHex`? */
function canAffordClimbTo(unit: Unit, climbHex: Hex, rt: Runtime): boolean {
  if (unit.mountId || unit.mountName) return false;
  if ((unit.actionsAvailable ?? 0) < 1) return false;
  const top = surfaceAt(climbHex, rt.ctx);
  const cur = unit.elevation ?? 0;
  if (top <= cur) return false;
  const inst = rt.ctx.structures?.[hexKeyOf(climbHex)];
  const template = inst ? rt.ctx.structureTemplates?.[inst.templateId] : undefined;
  const perStep = structureClimbPerStep10(template, inst, { isMounted: false });
  if (perStep < 0) return false;
  const budget = computeMoveCapacity(unit, effectiveMax(unit, rt.ctx.formations));
  return perStep <= 0 || budget >= perStep;
}

function canAffordClimb(unit: Unit, target: Unit, rt: Runtime): boolean {
  return canAffordClimbTo(unit, target.hex, rt);
}

interface WallClimbAccess {
  target: Unit;
  nearHex: Hex;
  farHex: Hex;
  height: number;
  steps: number;
  perStep: number;
  nearCost: number;
  score: number;
}

function wallClimbForTarget(unit: Unit, target: Unit, rt: Runtime): WallClimbAccess | null {
  if (unit.mountId || unit.mountName || unit.isCharging) return null;
  if (rt.working.some(f => f.attachedToUnitId === unit.id && !f.isDeleted)) return null;
  const noStop = rt.passThroughMaps.get(unit.id);
  const noClimb = noClimbDistanceMap(unit, rt.working, rt.ctx, 'ground', rt.complexes.get(unit.id) ?? null);
  const ownComplex = rt.complexes.get(unit.id) ?? null;
  const surface = unitSurface(unit, rt.ctx);
  let best: WallClimbAccess | null = null;
  const marked = rt.byUnit.get(unit.id) === target.id;
  for (const wall of edgeWalls(rt.ctx)) {
    if (wall.height <= surface) continue;
    const sides: [Hex, Hex][] = [[wall.a, wall.b], [wall.b, wall.a]];
    for (const [nearHex, farHex] of sides) {
      if (surfaceAt(nearHex, rt.ctx) !== surface || surfaceAt(farHex, rt.ctx) !== surface) continue;
      if (ownComplex && !ownComplex.hexes.has(hexKeyOf(farHex))) continue;
      if (isOccupiedAt(rt, farHex, surface, unit.id)) continue;
      if (hexKeyOf(nearHex) !== hexKeyOf(unit.hex) && isOccupiedAt(rt, nearHex, surface, unit.id)) continue;
      const nearKey = hexKeyOf(nearHex);
      if (noStop?.has(nearKey) && hexKeyOf(unit.hex) !== nearKey) continue;
      const nearCost = noClimb.get(nearKey);
      if (nearCost === undefined) continue;
      const upTotal = structureClimbCostBetween(nearHex, farHex, rt.ctx.structures, rt.ctx.structureTemplates, false, false);
      if (upTotal < 0) continue;
      const farUnit = { ...unit, hex: farHex, elevation: surface };
      const complex = structureComplexFor({ hex: farHex }, rt.ctx);
      const movement = movementContextFor(farUnit, rt.working, rt.ctx, 'ground', complex);
      const farMap = distanceMap(farUnit, { ...rt.ctx, units: rt.working }, 'ground', movement);
      const farCost = targetPathCost(farMap, target.hex, movement.passThrough);
      if (!Number.isFinite(farCost)) continue;
      const atBase = hexKeyOf(unit.hex) === hexKeyOf(nearHex) ? -10_000 : 0;
      const score = (marked ? -1_000_000 : 0) + atBase + nearCost + farCost;
      if (!best || score < best.score) {
        best = {
          target,
          nearHex,
          farHex,
          height: wall.height,
          steps: wall.steps,
          perStep: upTotal / wall.steps,
          nearCost,
          score,
        };
      }
    }
  }
  return best;
}

function noClimbMeleeReachable(unit: Unit, target: Unit, map: Map<string, number>, noStop: Set<string> | undefined, rt: Runtime): boolean {
  for (const d of HEX_DIRS) {
    const neighbor: Hex = { q: target.hex.q + d.q, r: target.hex.r + d.r, s: target.hex.s + d.s };
    const key = hexKeyOf(neighbor);
    if (noStop?.has(key)) continue;
    if (!map.has(key)) continue;
    if (isMeleeReachable({ hex: neighbor, elevation: surfaceAt(neighbor, rt.ctx) }, target, rt.ctx.structures, rt.ctx.structureTemplates)) return true;
  }
  return false;
}

function bestWallClimb(unit: Unit, rt: Runtime): WallClimbAccess | null {
  const noClimb = noClimbDistanceMap(unit, rt.working, rt.ctx, 'ground', rt.complexes.get(unit.id) ?? null);
  const noStop = rt.passThroughMaps.get(unit.id);
  let best: WallClimbAccess | null = null;
  for (const target of rt.enemies) {
    if (isUnitRouted(target)) continue;
    if (surfaceAt(target.hex, rt.ctx) !== unitSurface(unit, rt.ctx) || (target.elevation ?? 0) !== unitSurface(unit, rt.ctx)) continue;
    if (noClimbMeleeReachable(unit, target, noClimb, noStop, rt)) continue;
    const access = wallClimbForTarget(unit, target, rt);
    if (access && (!best || access.score < best.score)) best = access;
  }
  return best;
}

function canAffordWallClimb(unit: Unit, access: WallClimbAccess, rt: Runtime): boolean {
  if (unit.mountId || unit.mountName || unit.isCharging) return false;
  if ((unit.actionsAvailable ?? 0) < 1) return false;
  if (rt.working.some(f => f.attachedToUnitId === unit.id && !f.isDeleted)) return false;
  const capacity = computeMoveCapacity(unit, effectiveMax(unit, rt.ctx.formations));
  const atTop = (unit.elevation ?? 0) >= access.height;
  return atTop
    ? capacity >= access.steps * access.perStep
    : capacity >= access.perStep;
}

interface WallClimbState {
  farHex: Hex;
  height: number;
  steps: number;
  perStep: number;
}

function wallClimbState(unit: Unit, rt: Runtime): WallClimbState | null {
  if (!unit.climbTo) return null;
  const [q, r] = unit.climbTo.split(',').map(Number);
  if (!Number.isFinite(q) || !Number.isFinite(r)) return null;
  const farHex = { q, r, s: -q - r };
  const surface = unitSurface(unit, rt.ctx);
  if (surfaceAt(farHex, rt.ctx) !== surface) return null;
  const height = edgeStructureHeightBetween(unit.hex, farHex, rt.ctx.structures, rt.ctx.structureTemplates);
  if (height <= surface) return null;
  const upTotal = structureClimbCostBetween(unit.hex, farHex, rt.ctx.structures, rt.ctx.structureTemplates, false, false);
  if (upTotal < 0) return null;
  return {
    farHex,
    height,
    steps: Math.max(1, Math.round(height / 10)),
    perStep: upTotal / Math.max(1, Math.round(height / 10)),
  };
}

function canAffordWallClimbState(unit: Unit, wall: WallClimbState, rt: Runtime): boolean {
  if (unit.mountId || unit.mountName) return false;
  if ((unit.actionsAvailable ?? 0) < 1) return false;
  const capacity = computeMoveCapacity(unit, effectiveMax(unit, rt.ctx.formations));
  return (unit.elevation ?? 0) >= wall.height
    ? capacity >= wall.steps * wall.perStep
    : capacity >= wall.perStep;
}

interface TopAccess {
  topHex: Hex;
  baseHex: Hex;
  topSurface: number;
  baseSurface: number;
  perStep: number;
  climbSteps: number;
  total: number;
  /** The top hex is the target itself (climb-attack, not landing). */
  enemyAtTop?: boolean;
}

function isOccupiedAt(rt: Runtime, hex: Hex, surface: number, excludeId: string): boolean {
  return rt.working.some(w =>
    w.id !== excludeId && !w.isDeleted && !w.hidden && !w.attachedToUnitId
    && (w.currentUnitHp ?? 0) > 0
    && hexKeyOf(w.hex) === hexKeyOf(hex)
    && (w.elevation ?? 0) >= surface);
}

/**
 * Find the best way for a non-mounted melee unit to reach a target standing on
 * a structure top: a base hex + a free top hex ("gap") to climb into.
 */
function complexForHex(rt: Runtime, hex: Hex): StructureComplex | null {
  const key = hexKeyOf(hex);
  if (rt.complexByHex.has(key)) return rt.complexByHex.get(key) ?? null;
  const complex = structureComplexFor({ hex }, rt.ctx);
  rt.complexByHex.set(key, complex);
  return complex;
}

function isStructureBound(unit: Unit, rt: Runtime): boolean {
  if (canFly(unit)) return false;
  if (isClimbingUnit(unit, rt.ctx.structures, rt.ctx.structureTemplates)) return true;
  if (surfaceAt(unit.hex, rt.ctx) > 0) return true;
  return (rt.complexes.get(unit.id) ?? null) !== null;
}

function topExitsFor(rt: Runtime, unit: Unit): Hex[] {
  const elevation = unit.elevation ?? 0;
  const out = new Map<string, Hex>();
  const add = (hex: Hex) => {
    if (surfaceAt(hex, rt.ctx) > elevation) out.set(hexKeyOf(hex), hex);
  };
  add(unit.hex);
  for (const d of HEX_DIRS) add({ q: unit.hex.q + d.q, r: unit.hex.r + d.r, s: -unit.hex.q - d.q - unit.hex.r - d.r });
  return Array.from(out.values());
}

function unitsAtSurface(rt: Runtime, hex: Hex, surface: number, excludeId: string): Unit[] {
  return rt.working.filter(w =>
    w.id !== excludeId && !w.isDeleted && !w.hidden && !w.attachedToUnitId
    && (w.currentUnitHp ?? 0) > 0
    && hexKeyOf(w.hex) === hexKeyOf(hex)
    && (w.elevation ?? 0) >= surface);
}

function nearestFreeTop(rt: Runtime, unit: Unit, prefer?: Hex | null): Hex | null {
  const candidates = new Map<string, Hex>();
  for (const hex of topExitsFor(rt, unit)) candidates.set(hexKeyOf(hex), hex);
  const complex = prefer ? complexForHex(rt, prefer) : null;
  if (complex) {
    for (const key of Array.from(complex.hexes)) {
      const [q, r] = key.split(',').map(Number);
      const hex: Hex = { q, r, s: -q - r };
      const surface = surfaceAt(hex, rt.ctx);
      if (surface > (unit.elevation ?? 0)) candidates.set(key, hex);
    }
  }
  const free = Array.from(candidates.values())
    .filter(hex => !isOccupiedAt(rt, hex, surfaceAt(hex, rt.ctx), unit.id))
    .sort((a, b) => hexDistance(unit.hex, a) - hexDistance(unit.hex, b) || hexKeyOf(a).localeCompare(hexKeyOf(b)));
  return free[0] ?? null;
}

interface HangingExit {
  topHex: Hex;
  enemy: Unit | null;
}

function hangingExitFor(rt: Runtime, unit: Unit): HangingExit | null {
  const elevation = unit.elevation ?? 0;
  let climbHex: Hex | null = null;
  if (unit.climbTo) {
    const [q, r] = unit.climbTo.split(',').map(Number);
    climbHex = { q, r, s: -q - r };
  }

  if (climbHex) {
    const surface = surfaceAt(climbHex, rt.ctx);
    if (surface > elevation) {
      const groups = enemyGroupsOf(allianceOf(unit, rt.ctx.alliances));
      const hostiles = unitsAtSurface(rt, climbHex, surface, unit.id)
        .filter(o => groups.has(allianceOf(o, rt.ctx.alliances)))
        .sort((a, b) => computeThreatRating(a) - computeThreatRating(b) || a.id.localeCompare(b.id));
      if (hostiles.length > 0) return { topHex: climbHex, enemy: hostiles[0] };
      if (!isOccupiedAt(rt, climbHex, surface, unit.id)) return { topHex: climbHex, enemy: null };
      const free = nearestFreeTop(rt, unit, climbHex);
      return free ? { topHex: free, enemy: null } : null;
    }
  }

  const candidates = topExitsFor(rt, unit);
  const free = candidates
    .filter(hex => !isOccupiedAt(rt, hex, surfaceAt(hex, rt.ctx), unit.id))
    .sort((a, b) => hexDistance(unit.hex, a) - hexDistance(unit.hex, b) || hexKeyOf(a).localeCompare(hexKeyOf(b)))[0];
  if (free) return { topHex: free, enemy: null };

  const groups = enemyGroupsOf(allianceOf(unit, rt.ctx.alliances));
  let best: HangingExit | null = null;
  for (const hex of candidates) {
    const surface = surfaceAt(hex, rt.ctx);
    const hostiles = unitsAtSurface(rt, hex, surface, unit.id)
      .filter(o => groups.has(allianceOf(o, rt.ctx.alliances)))
      .sort((a, b) => computeThreatRating(a) - computeThreatRating(b) || a.id.localeCompare(b.id));
    if (hostiles.length > 0) {
      const weakest = hostiles[0];
      if (!best || !best.enemy || computeThreatRating(weakest) < computeThreatRating(best.enemy)) {
        best = { topHex: hex, enemy: weakest };
      }
    }
  }
  return best;
}

function topAccessToHex(unit: Unit, topHex: Hex, rt: Runtime): TopAccess | null {
  if (unit.mountId || unit.mountName || unit.isCharging) return null;
  const topSurface = surfaceAt(topHex, rt.ctx);
  if (topSurface <= unitSurface(unit, rt.ctx)) return null;
  const map = rt.groundMaps.get(unit.id);
  if (!map) return null;
  const key = hexKeyOf(topHex);
  const inst = rt.ctx.structures?.[key];
  const template = inst ? rt.ctx.structureTemplates?.[inst.templateId] : undefined;
  const perStep = structureClimbPerStep10(template, inst, { isMounted: false });
  if (perStep < 0) return null;

  let best: TopAccess | null = null;
  for (const d of HEX_DIRS) {
    const baseHex: Hex = { q: topHex.q + d.q, r: topHex.r + d.r, s: -topHex.q - d.q - topHex.r - d.r };
    const baseSurface = surfaceAt(baseHex, rt.ctx);
    if (baseSurface >= topSurface) continue;
    if (isOccupiedAt(rt, baseHex, baseSurface, unit.id)) continue;
    const baseCost = map.get(hexKeyOf(baseHex)) ?? Infinity;
    if (!Number.isFinite(baseCost)) continue;
    const climbSteps = Math.max(1, Math.ceil((topSurface - baseSurface) / 10));
    const total = baseCost + climbSteps * Math.max(0, perStep);
    if (!best || total < best.total) {
      best = { topHex, baseHex, topSurface, baseSurface, perStep, climbSteps, total };
    }
  }
  return best;
}

/**
 * Vacant structure tops are the preferred takeover path. While a complex has any
 * free top hex, melee units are assigned there (one unit per hex, quickest
 * access). Only leftover melee units mark structure defenders.
 */
function assignStructureTakeover(rt: Runtime, units: Unit[]): void {
  const melee = units.filter(u =>
    archetypeOf(u) === 'melee'
    && !isUnitRouted(u)
    && !u.mountId && !u.mountName
    && !isClimbingUnit(u, rt.ctx.structures, rt.ctx.structureTemplates));
  if (melee.length === 0) return;

  const defenders = rt.enemies.filter(e =>
    surfaceAt(e.hex, rt.ctx) > 0 && isGroundTarget(e, rt.ctx));
  if (defenders.length === 0) return;

  const vacant = new Map<string, Hex>();
  for (const defender of defenders) {
    const complex = complexForHex(rt, defender.hex);
    if (!complex) continue;
    for (const key of Array.from(complex.hexes)) {
      if (vacant.has(key)) continue;
      const [q, r] = key.split(',').map(Number);
      const hex: Hex = { q, r, s: -q - r };
      const surface = surfaceAt(hex, rt.ctx);
      if (surface <= 0) continue;
      if (isOccupiedAt(rt, hex, surface, '')) continue;
      vacant.set(key, hex);
    }
  }
  if (vacant.size === 0) return;

  const candidates: { unit: Unit; topHex: Hex; cost: number }[] = [];
  for (const topHex of Array.from(vacant.values())) {
    for (const unit of melee) {
      const access = topAccessToHex(unit, topHex, rt);
      if (access) candidates.push({ unit, topHex, cost: access.total });
    }
  }
  candidates.sort((a, b) => a.cost - b.cost
    || hexKeyOf(a.topHex).localeCompare(hexKeyOf(b.topHex))
    || a.unit.id.localeCompare(b.unit.id));

  const usedUnits = new Set<string>();
  const usedTops = new Set<string>();
  for (const candidate of candidates) {
    if (usedUnits.has(candidate.unit.id) || usedTops.has(hexKeyOf(candidate.topHex))) continue;
    usedUnits.add(candidate.unit.id);
    usedTops.add(hexKeyOf(candidate.topHex));
    rt.climbObjectives.set(candidate.unit.id, candidate.topHex);
  }
}

function planClimbObjective(
  unit: Unit,
  plan: AiUnitPlan,
  rt: Runtime,
  objectiveHex: Hex,
): { unit: Unit; landed: boolean; stop: boolean } {
  const surface = surfaceAt(objectiveHex, rt.ctx);
  if (unitSurface(unit, rt.ctx) >= surface) {
    rt.climbObjectives.delete(unit.id);
    return { unit, landed: true, stop: false };
  }

  const occupants = unitsAtSurface(rt, objectiveHex, surface, unit.id);
  const groups = enemyGroupsOf(allianceOf(unit, rt.ctx.alliances));
  const hostiles = occupants
    .filter(o => groups.has(allianceOf(o, rt.ctx.alliances)))
    .sort((a, b) => computeThreatRating(a) - computeThreatRating(b) || a.id.localeCompare(b.id));
  if (hostiles.length > 0) {
    if (canAffordClimbTo(unit, objectiveHex, rt)) {
      plan.steps.push({ kind: 'climbAttack', unitId: unit.id, from: unit.hex, targetId: hostiles[0].id, target: hostiles[0].hex });
    }
    return { unit, landed: false, stop: true };
  }
  if (occupants.length > 0) {
    // Friendly-occupied: switch to the nearest free top in the same structure.
    const free = nearestFreeTop(rt, unit, objectiveHex);
    if (free) rt.climbObjectives.set(unit.id, free);
    else rt.climbObjectives.delete(unit.id);
    return { unit, landed: !free, stop: !!free };
  }

  const access = topAccessToHex(unit, objectiveHex, rt);
  if (!access) {
    rt.climbObjectives.delete(unit.id);
    return { unit, landed: true, stop: false };
  }

  if (hexKeyOf(unit.hex) !== hexKeyOf(access.baseHex)) {
    const reverse = reverseHexMapFor(rt, unit, access.baseHex);
    const m = bestManeuver(unit, rt, 'ground', (man) => {
      if (man.path.length === 0) return -Infinity;
      if (isFlankedAt(man.dest, man.facing, rt.enemies, null)) return -Infinity;
      const remaining = reverse.get(hexKeyOf(man.dest)) ?? Infinity;
      if (!Number.isFinite(remaining)) return -Infinity;
      return -remaining * 100 - man.cost * 2 - man.turns.length * 2;
    });
    if (!m) return { unit, landed: false, stop: true };
    return { unit: pushMove(plan, unit, m, rt.ctx), landed: false, stop: true };
  }

  if (!canAffordClimbTo(unit, objectiveHex, rt)) {
    return { unit, landed: false, stop: true };
  }
  const budget = computeMoveCapacity(unit, effectiveMax(unit, rt.ctx.formations));
  const planClimb = climbPlan(surface - access.baseSurface, budget, 0, false, access.perStep);
  if (planClimb.steps <= 0) return { unit, landed: false, stop: true };
  const applied = applyMoveCost(unit, planClimb.cost, effectiveMax(unit, rt.ctx.formations));
  plan.steps.push({ kind: 'climb', unitId: unit.id, from: unit.hex, to: objectiveHex });
  if (planClimb.complete) {
    const updated: Unit = {
      ...unit,
      hex: objectiveHex,
      elevation: surface,
      climbTo: null,
      movementPointsAvailable: applied.movementPointsAvailable,
      actionsAvailable: applied.actionsAvailable,
    };
    const complex = complexForHex(rt, objectiveHex);
    if (complex) rt.complexes.set(unit.id, complex);
    rt.climbObjectives.delete(unit.id);
    return { unit: updated, landed: true, stop: false };
  }
  const updated: Unit = {
    ...unit,
    elevation: access.baseSurface + planClimb.steps * 10,
    climbTo: hexKeyOf(objectiveHex),
    movementPointsAvailable: applied.movementPointsAvailable,
    actionsAvailable: applied.actionsAvailable,
  };
  return { unit: updated, landed: false, stop: true };
}

function topAccessFor(unit: Unit, target: Unit, rt: Runtime): TopAccess | null {
  const cacheKey = `${unit.id}|${target.id}|${hexKeyOf(unit.hex)}`;
  if (rt.topAccessCache.has(cacheKey)) return rt.topAccessCache.get(cacheKey) ?? null;
  const topSurface = surfaceAt(target.hex, rt.ctx);
  if (topSurface <= unitSurface(unit, rt.ctx)
    || unit.mountId || unit.mountName || unit.isCharging) {
    rt.topAccessCache.set(cacheKey, null);
    return null;
  }
  const complex = complexForHex(rt, target.hex);
  if (!complex) {
    rt.topAccessCache.set(cacheKey, null);
    return null;
  }

  let best: TopAccess | null = null;
  for (const key of Array.from(complex.hexes)) {
    const [q, r] = key.split(',').map(Number);
    const topHex: Hex = { q, r, s: -q - r };
    const surface = surfaceAt(topHex, rt.ctx);
    if (surface <= unitSurface(unit, rt.ctx)) continue;
    if (isOccupiedAt(rt, topHex, surface, unit.id)) continue;
    const access = topAccessToHex(unit, topHex, rt);
    if (!access) continue;
    const atBase = hexKeyOf(access.baseHex) === hexKeyOf(unit.hex) ? -1_000 : 0;
    const total = access.total + hexDistance(topHex, target.hex) + atBase;
    if (!best || total < best.total) best = { ...access, total };
  }
  // No free top: when the only way up is the defender's own top, climb-attack it.
  if (!best) {
    const direct = topAccessToHex(unit, target.hex, rt);
    if (direct) best = { ...direct, enemyAtTop: true };
  }
  rt.topAccessCache.set(cacheKey, best);
  return best;
}

function planMelee(unit: Unit, plan: AiUnitPlan, rt: Runtime): Unit {
  if (isUnitRouted(unit)) return planRouted(unit, plan, rt);
  let u = unit;
  const objective = rt.climbObjectives.get(u.id);
  if (objective) {
    const result = planClimbObjective(u, plan, rt, objective);
    if (result.stop || !result.landed) return result.unit;
    u = result.unit;
  }
  const markedId = rt.byUnit.get(unit.id) ?? null;
  const candidates = rt.candidates(u, 'melee');
  let lockedTarget: Unit | null = null;
  let hasAttacked = false;

  // Climb lock: a hanging unit commits to the target at climbTo. No moves,
  // formation changes, retargeting or escape while it is on the wall.
  if (u.climbTo) {
    const target = rt.enemies.find(e => hexKeyOf(e.hex) === u.climbTo);
    if (!target) return u;
    if (!canAffordClimb(u, target, rt)) return u;
    plan.steps.push({ kind: 'climbAttack', unitId: u.id, from: u.hex, targetId: target.id, target: target.hex });
    return u;
  }

  // An enemy walled away from the unit is unreachable by the ground map. Move to
  // the wall base, then climb over on the next activation (or climb now when
  // already there). Never drop; a partial/hanging climb is completed later.
  const adjacentNow = adjacentFoes(u, rt);
  const canActAdjacent = adjacentNow.some(t => {
    const targetSurface = surfaceAt(t.hex, rt.ctx);
    if (targetSurface <= unitSurface(u, rt.ctx)) {
      return isMeleeReachable(u, t, rt.ctx.structures, rt.ctx.structureTemplates);
    }
    const complex = rt.complexes.get(u.id) ?? null;
    return !complex || complex.hexes.has(hexKeyOf(t.hex));
  });
  if (!canActAdjacent) {
    const wall = bestWallClimb(u, rt);
    if (wall) {
      if (hexKeyOf(u.hex) === hexKeyOf(wall.nearHex)) {
        if (canAffordWallClimb(u, wall, rt)) {
          if (wall.target.id !== markedId) rt.setTarget(u.id, wall.target.id);
          plan.steps.push({ kind: 'climbOver', unitId: u.id, from: u.hex, to: wall.farHex, descent: 'climb' });
        } else {
          u = faceAdjacentHostiles(u, plan, rt);
        }
        return u;
      }
      const reverse = reverseHexMapFor(rt, u, wall.nearHex);
      const m = bestManeuver(u, rt, 'ground', (candidate, threat) => {
        if (candidate.path.length === 0) return -Infinity;
        if (isFlankedAt(candidate.dest, candidate.facing, rt.enemies, wall.target.id)) return -Infinity;
        if (threat.has(hexKeyOf(candidate.dest))) return -Infinity;
        const remaining = reverse.get(hexKeyOf(candidate.dest)) ?? Infinity;
        if (!Number.isFinite(remaining)) return -Infinity;
        return -remaining * 100 - candidate.cost * 2 - candidate.turns.length * 2;
      });
      if (m) {
        if (wall.target.id !== markedId) rt.setTarget(u.id, wall.target.id);
        return pushMove(plan, u, m, rt.ctx);
      }
      return u;
    }
  }

  for (let guard = 0; guard < 8; guard++) {
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
      hasAttacked = true;
      rt.commit(u);
      continue;
    }

    // Never reposition after an attack: hold the ground you attacked from.
    if (hasAttacked) break;

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

    // Adjacent but not attackable/climbable (wall, elevation, etc.): hold/face
    // rather than walking away from the enemy.
    if (adjacent.length > 0) {
      u = faceAdjacentHostiles(u, plan, rt);
      break;
    }

    if (isStructureBound(u, rt)) {
      const sameTop = candidates.some(t => surfaceAt(t.hex, rt.ctx) === unitSurface(u, rt.ctx));
      if (!sameTop) {
        u = faceAdjacentHostiles(u, plan, rt);
        break;
      }
    }

    // No adjacent target: try every candidate in path order. A blocked marked
    // target must not stop the unit from finding an alternate one.
    const map = rt.groundMaps.get(u.id) ?? new Map<string, number>();
    const noStop = rt.passThroughMaps.get(u.id);
    const printed = Math.max(1, u.movementPoints ?? 1);
    const topAccess = new Map<string, TopAccess>();
    const ordered = candidates
      .map(t => {
        const normal = targetPathCost(map, t.hex, noStop);
        const onTop = surfaceAt(t.hex, rt.ctx) > unitSurface(u, rt.ctx);
        const access = onTop ? topAccessFor(u, t, rt) : null;
        if (access) topAccess.set(t.id, access);
        return { t, cost: access ? Math.min(normal, access.total) : normal };
      })
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
      const complex = rt.complexes.get(u.id) ?? null;
      const movement = movementContextFor(u, rt.working, rt.ctx, 'ground', complex);
      const list = maneuversFor(u, rt.working, rt.ctx, 'ground', complex);
      type Pick = { maneuver: Maneuver; score: number };
      let engage: Pick | null = null;
      let stage: Pick | null = null;
      let progress: Pick | null = null;
      for (const man of list) {
        if (man.path.length === 0) continue;
        if (isFlankedAt(man.dest, man.facing, rt.enemies, candidate.id)) continue;
        const remaining = reverse.get(hexKeyOf(man.dest)) ?? Infinity;
        if (!Number.isFinite(remaining)) continue;
        const d = hexDistance(man.dest, candidate.hex);
        const baseScore = -man.cost * 2 - man.turns.length * 2;
        const inZoc = movement.threat.has(hexKeyOf(man.dest));
        if (d === 1) {
          const score = -remaining * 100 + baseScore;
          if (!engage || score > engage.score) engage = { maneuver: man, score };
        }
        if (!inZoc) {
          const score = -Math.abs(remaining - 3) * 100 + baseScore;
          if (!stage || score > stage.score) stage = { maneuver: man, score };
        }
        const pScore = -remaining * 100 + baseScore - (inZoc ? 20 : 0);
        if (!progress || pScore > progress.score) progress = { maneuver: man, score: pScore };
      }
      const best = engage ?? stage ?? progress;
      if (!best) return null;
      if (candidate.id !== (rt.byUnit.get(u.id) ?? null)) rt.setTarget(u.id, candidate.id);
      return pushMove(plan, u, best.maneuver, rt.ctx);
    };

    const planTop = (target: Unit, access: TopAccess): { unit: Unit; stop: boolean } | null => {
      if (hexKeyOf(u.hex) === hexKeyOf(access.baseHex)) {
        if (!canAffordClimbTo(u, access.topHex, rt)) return null;
        if (access.enemyAtTop) {
          // No free top: climb-attack the defender on its own top.
          plan.steps.push({ kind: 'climbAttack', unitId: u.id, from: u.hex, targetId: target.id, target: target.hex });
          return { unit: u, stop: true };
        }
        const budget = computeMoveCapacity(u, effectiveMax(u, rt.ctx.formations));
        const planClimb = climbPlan(access.topSurface - access.baseSurface, budget, 0, false, access.perStep);
        if (planClimb.steps <= 0) return null;
        const applied = applyMoveCost(u, planClimb.cost, effectiveMax(u, rt.ctx.formations));
        plan.steps.push({ kind: 'climb', unitId: u.id, from: u.hex, to: access.topHex });
        if (planClimb.complete) {
          const updated: Unit = {
            ...u,
            hex: access.topHex,
            elevation: access.topSurface,
            climbTo: null,
            movementPointsAvailable: applied.movementPointsAvailable,
            actionsAvailable: applied.actionsAvailable,
          };
          const c = complexForHex(rt, target.hex);
          if (c) rt.complexes.set(u.id, c);
          return { unit: updated, stop: false };
        }
        const updated: Unit = {
          ...u,
          elevation: access.baseSurface + planClimb.steps * 10,
          climbTo: hexKeyOf(access.topHex),
          movementPointsAvailable: applied.movementPointsAvailable,
          actionsAvailable: applied.actionsAvailable,
        };
        return { unit: updated, stop: true };
      }

      // Move toward the chosen base hex.
      const reverse = reverseHexMapFor(rt, u, access.baseHex);
      const m = bestManeuver(u, rt, 'ground', (man) => {
        if (man.path.length === 0) return -Infinity;
        if (isFlankedAt(man.dest, man.facing, rt.enemies, null)) return -Infinity;
        const remaining = reverse.get(hexKeyOf(man.dest)) ?? Infinity;
        if (!Number.isFinite(remaining)) return -Infinity;
        return -remaining * 100 - man.cost * 2 - man.turns.length * 2;
      });
      if (!m) return null;
      return { unit: pushMove(plan, u, m, rt.ctx), stop: false };
    };

    // Plan against one locked target. Retarget only when it has no legal move.
    let moved: Unit | null = null;
    let stopAfter = false;
    if (lockedTarget) {
      const access = topAccess.get(lockedTarget.id);
      if (access) {
        const top = planTop(lockedTarget, access);
        if (top) { moved = top.unit; stopAfter = top.stop; }
      } else {
        moved = tryTarget(lockedTarget);
      }
    }
    if (!moved) {
      const pool: { t: Unit; cost: number }[] = lockedTarget
        ? ordered.filter(o => o.t.id !== lockedTarget!.id)
        : ordered;
      for (const entry of pool) {
        const t = entry.t;
        const access = topAccess.get(t.id);
        if (access) {
          const top = planTop(t, access);
          if (top) {
            moved = top.unit;
            stopAfter = top.stop;
            lockedTarget = t;
            if (t.id !== (rt.byUnit.get(u.id) ?? null)) rt.setTarget(u.id, t.id);
            break;
          }
        } else {
          moved = tryTarget(t);
          if (moved) { lockedTarget = t; break; }
        }
      }
      if (!moved) lockedTarget = null;
    }
    if (!moved) break;
    // A zero-cost move can loop; require the manoeuvre to change hex.
    if (moved.hex.q === u.hex.q && moved.hex.r === u.hex.r) break;
    u = moved;
    rt.commit(u);
    if (stopAfter) break;
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

    // Structure defenders hold the wall and keep shooting; they never reposition
    // off the structure or kite backward.
    if (isStructureBound(u, rt)) {
      const nearest = candidates[0] ?? target;
      if (nearest) {
        const turns = turnsTo(u.facing, facingToward(u.hex, nearest.hex));
        if (turns.length > 0) {
          const turned = pushTurns(plan, u, turns, rt.ctx);
          if (turned) u = turned;
        }
      }
      break;
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
  if (isStructureBound(unit, rt)) return faceAdjacentHostiles(unit, plan, rt);
  let u = unit;
  const markedId = rt.byUnit.get(u.id) ?? null;
  const movement = movementContextFor(u, rt.working, rt.ctx, 'ground', rt.complexes.get(u.id) ?? null);
  const ordered = rt.candidates(u, 'mounted')
    .filter(t => isOuterRimTarget(t, movement.occupied, rt.enemies))
    .slice()
    .sort((a, b) => (a.id === markedId ? 0 : 1) - (b.id === markedId ? 0 : 1) || a.id.localeCompare(b.id));
  const pool = effectiveMax(u, rt.ctx.formations);
  const chargeEnabled = rt.ctx.chargeEnabled !== false;
  const chargeFull = getSetting('charge_full_distance', 2);
  // The farthest ring from which a full charge can reach an adjacent target in
  // one charge move: one action's pool plus the target's own ring.
  const maxRadius = pool + 1;
  // A hostile inside any friendly kill zone is unlikely to move; allow the
  // mounted unit to stage at 3 hexes instead of 5. Otherwise keep the full
  // safety radius. This is the SAME kill-zone predicate used by ZoC/morale.
  const safetyRules = rt.enemies.map(e => ({
    id: e.id,
    hex: e.hex,
    radius: isInFriendlyKillZone(e, u, rt.working, rt.ctx) ? 3 : 5,
  }));
  const safetyMargin = (hex: Hex, excludeId?: string): number => {
    const rules = excludeId ? safetyRules.filter(r => r.id !== excludeId) : safetyRules;
    return rules.length === 0
      ? Infinity
      : Math.min(...rules.map(r => hexDistance(hex, r.hex) - r.radius));
  };
  const nearestHostile = (hex: Hex): number => rt.enemies.length === 0
    ? Infinity
    : Math.min(...rt.enemies.map(e => hexDistance(hex, e.hex)));

  // With no rim target, hold when safe; otherwise move to the hex with the
  // greatest safety margin. Mounted units never chase into a formation.
  const safestMove = (): Unit => {
    if (rt.enemies.length === 0 || safetyMargin(u.hex) >= 0) return u;
    const m = bestManeuver(u, rt, 'ground', (candidate, threat) => {
      if (candidate.path.length === 0) return -Infinity;
      if (threat.has(hexKeyOf(candidate.dest))) return -Infinity;
      return safetyMargin(candidate.dest) * 100 - candidate.cost * 2 - candidate.turns.length * 2;
    });
    if (!m) return u;
    u = pushMove(plan, u, m, rt.ctx);
    rt.commit(u);
    return u;
  };
  if (ordered.length === 0) return safestMove();

  const chargeDestination = (
    state: Unit,
    target: Unit,
    allowTurns = true,
  ): { hex: Hex; cost: number; turns: { dir: 'left' | 'right' }[] } | null => {
    const dests: { hex: Hex; cost: number; arc: string; turns: { dir: 'left' | 'right' }[] }[] = [];
    // A mounted charge may turn first, then charge with a later action.
    const tries: { turns: { dir: 'left' | 'right' }[]; unit: Unit }[] = [{ turns: [], unit: state }];
    for (let i = 1; allowTurns && i <= 2; i++) {
      const seq: { dir: 'left' | 'right' }[] = Array.from({ length: i }, () => ({ dir: 'left' as const }));
      const l = applyTurns(state, seq, rt.ctx);
      if (l) tries.push({ turns: seq, unit: l });
      const rseq: { dir: 'left' | 'right' }[] = Array.from({ length: i }, () => ({ dir: 'right' as const }));
      const r = applyTurns(state, rseq, rt.ctx);
      if (r) tries.push({ turns: rseq, unit: r });
    }
    for (const { turns, unit: candidate } of tries) {
      // Re-check AFTER the turn: the turn may have spent the action or MP needed
      // to enter the charge. Charge entry consumes one action and converts it
      // into a full movement pool (added to the current MP).
      if (chargeStanceFor({
        unit: candidate,
        airborne: false,
        form: rt.ctx.formations[candidate.currentFormation],
        chargeEnabled,
      }) !== 'charge') continue;
      const charged: Unit = {
        ...candidate,
        isCharging: true,
        chargeDistance: 0,
        actionsAvailable: (candidate.actionsAvailable ?? 0) - 1,
        movementPointsAvailable: (candidate.movementPointsAvailable ?? 0) + pool,
      };
      const capacity = computeMoveCapacity({
        movementPointsAvailable: charged.movementPointsAvailable,
        actionsAvailable: charged.actionsAvailable,
      }, pool);
      if (capacity <= 0) continue;
      const charge = computeChargeHexes(candidate, rt, pool);
      charge.forEach((cost, key) => {
        if (cost > capacity || cost < chargeFull) return;
        const hex = parseKey(key);
        if (!isAdjacent(hex, target.hex)) return;
        // Mounted: rear only, outside the enemy formation's middle.
        if (arcOfTarget(target.hex, target.facing, hex) !== 'rear') return;
        if (movement.threat.has(key)) return;
        if (!isOuterApproachHex(hex, target, movement.occupied, rt.enemies)) return;
        // The target must be attackable from the landing hex with the final facing.
        const landing = { ...candidate, hex };
        if (!legalTargets(landing, rt.enemies, rt.ctx).some(t => t.unit.id === target.id && !t.isRanged)) return;
        dests.push({ hex, cost, arc: 'rear', turns });
      });
    }
    dests.sort((a, b) => a.cost - b.cost);
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
    u = {
      ...u,
      isCharging: true,
      chargeDistance: 0,
      actionsAvailable: (u.actionsAvailable ?? 0) - 1,
      movementPointsAvailable: (u.movementPointsAvailable ?? 0) + pool,
    };
    rt.commit(u);
    plan.steps.push({ kind: 'move', unitId: u.id, from: u.hex, to: charge.hex, path: [charge.hex], cost: charge.cost });
    const spent = applyManeuver(u, {
      mode: 'ground', turns: [], unit: u, dest: charge.hex, path: [charge.hex], cost: charge.cost, facing: u.facing,
    }, rt.ctx);
    u = { ...spent, chargeDistance: charge.cost };
    rt.commit(u);
    // The free charge attack. The destination filter guarantees this is legal;
    // keep the check as a defensive guard against no-attack charges.
    const legal = legalTargets(u, rt.enemies, rt.ctx).filter(t => t.unit.id === target.id && !t.isRanged);
    if (legal.length > 0) u = pushAttack(plan, u, target, true);
    plan.steps.push({ kind: 'chargeEnd', unitId: u.id, from: u.hex });
    u = { ...u, isCharging: false, chargeDistance: 0 };
    rt.commit(u);
    // Evade with any remaining actions / MP after the charge, preferring the
    // greatest safety margin (3 near locked hostiles, otherwise 5).
    const retreat = bestManeuver(u, rt, 'ground', (candidate, threat) => {
      if (candidate.path.length === 0) return -Infinity;
      if (threat.has(hexKeyOf(candidate.dest))) return -Infinity;
      return safetyMargin(candidate.dest) * 100 + nearestHostile(candidate.dest) - candidate.cost * 2 - candidate.turns.length * 2;
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

  // Try a legal rear charge against any engaged rim candidate. A charge may be
  // declared on a later action, so re-evaluate after each candidate's turns.
  for (const target of ordered) {
    if (!isEngagedByFriendly(target, u, rt)) continue;
    const charge = chargeDestination(u, target);
    if (!charge) continue;
    if (target.id !== markedId) rt.setTarget(u.id, target.id);
    return applyCharge(target, charge);
  }

  // No charge: find a valid charge-start point. The START itself need not be in
  // the target rear arc; only the landing must be rear-adjacent. Prefer the
  // closest valid start and face its future charge lane.
  interface StageCandidate {
    target: Unit;
    move: Maneuver;
    endTurns: { dir: 'left' | 'right' }[];
    score: number;
  }
  let bestStage: StageCandidate | null = null;
  const complex = rt.complexes.get(u.id) ?? null;
  const maneuvers = maneuversFor(u, rt.working, rt.ctx, 'ground', complex);
  for (const target of ordered) {
    for (const move of maneuvers) {
      // A pure turn in place is handled by the end-of-move turns below.
      if (move.path.length === 0 && move.turns.length > 0) continue;
      const dest = move.dest;
      if (movement.threat.has(hexKeyOf(dest))) continue;
      const inspected = move.path.length > 0 ? move.path : [dest];
      // Hard safety: every staged/path hex must satisfy each hostile's radius.
      // The intended charge target is excluded; only the landing needs its rear.
      if (safetyMargin(dest, target.id) < 0) continue;
      if (inspected.some(p => safetyMargin(p, target.id) < 0)) continue;
      const post = applyManeuver(move.unit, move, rt.ctx);
      let bestFace: { endTurns: { dir: 'left' | 'right' }[]; facing: number } | null = null;
      for (let facing = 0; facing < 6; facing++) {
        const endTurns = turnsTo(post.facing, facing);
        const faced = applyTurns(post, endTurns, rt.ctx);
        if (!faced) continue;
        // Next activation starts at 0 MP / 2 actions. Require a no-turn charge
        // lane into the target from this staging hex and final facing.
        const next = {
          ...faced,
          movementPointsAvailable: 0,
          actionsAvailable: 2,
          isCharging: false,
          chargeDistance: 0,
        };
        if (!chargeDestination(next, target, false)) continue;
        if (isFlankedAt(dest, facing, rt.enemies, target.id)) continue;
        if (!bestFace || endTurns.length < bestFace.endTurns.length) {
          bestFace = { endTurns, facing };
        }
      }
      if (!bestFace) continue;
      const d = hexDistance(dest, target.hex);
      const minTarget = Math.min(...inspected.map(p => hexDistance(p, target.hex)));
      const minMargin = Math.min(...inspected.map(p => safetyMargin(p, target.id)));
      // Prefer the radius circle, greater safety margin and cheaper movement.
      // Paths that cut inside the circle are penalised.
      let score = 1_000_000;
      // Closest valid start first; holding at the current valid start wins.
      score -= move.cost * 10_000;
      if (move.path.length === 0) score += 1_000_000;
      score += Math.min(safetyMargin(dest, target.id), 4) * 10_000;
      score += Math.min(minMargin, 4) * 2_000;
      score -= Math.abs(d - maxRadius) * 10;
      if (minTarget < maxRadius) score -= (maxRadius - minTarget) * 5;
      score -= move.cost * 2 + move.turns.length * 2 + bestFace.endTurns.length * 30;
      if (target.id === markedId) score += 1;
      if (!bestStage || score > bestStage.score) {
        bestStage = { target, move, endTurns: bestFace.endTurns, score };
      }
    }
  }

  if (!bestStage) {
    // Nothing is reachable this activation. Find the closest valid charge-start
    // point around any target and pathfind toward it over multiple turns.
    interface StartGoal { target: Unit; hex: Hex; facing: number; cost: number }
    let bestGoal: StartGoal | null = null;
    const startCosts = distanceMap(u, { ...rt.ctx, units: rt.working }, 'ground', movement);
    for (const target of ordered) {
      for (let dq = -maxRadius; dq <= maxRadius; dq++) {
        for (let dr = -maxRadius; dr <= maxRadius; dr++) {
          const hex = { q: target.hex.q + dq, r: target.hex.r + dr, s: -target.hex.q - dq - target.hex.r - dr };
          const dist = hexDistance(hex, target.hex);
          if (dist < 1 || dist > maxRadius) continue;
          const key = hexKeyOf(hex);
          if (movement.occupied.has(key) || movement.threat.has(key)) continue;
          if (safetyMargin(hex, target.id) < 0) continue;
          const mapCost = startCosts.get(key);
          if (mapCost === undefined || !Number.isFinite(mapCost)) continue;
          let facing = -1;
          for (let f = 0; f < 6; f++) {
            const next: Unit = {
              ...u,
              hex,
              facing: f,
              movementPointsAvailable: 0,
              actionsAvailable: 2,
              isCharging: false,
              chargeDistance: 0,
            };
            if (chargeDestination(next, target, false)) { facing = f; break; }
          }
          if (facing < 0) continue;
          const better = !bestGoal
            || mapCost < bestGoal.cost
            || (mapCost === bestGoal.cost && target.id === markedId && bestGoal.target.id !== markedId);
          if (better) bestGoal = { target, hex, facing, cost: mapCost };
        }
      }
    }
    if (bestGoal) {
      // Already at a valid start: hold.
      if (bestGoal.cost === 0) return u;
      const reverse = reverseDistanceMap(
        bestGoal.hex, u, { ...rt.ctx, units: rt.working }, 'ground', movement,
      );
      const currentRemaining = reverse.get(hexKeyOf(u.hex)) ?? Infinity;
      let bestRoute: { move: Maneuver; endTurns: { dir: 'left' | 'right' }[]; score: number } | null = null;
      for (const move of maneuvers) {
        if (move.path.length === 0 && move.turns.length > 0) continue;
        const dest = move.dest;
        if (movement.threat.has(hexKeyOf(dest))) continue;
        const inspected = move.path.length > 0 ? move.path : [dest];
        if (safetyMargin(dest, bestGoal.target.id) < 0) continue;
        if (inspected.some(p => safetyMargin(p, bestGoal.target!.id) < 0)) continue;
        const remaining = reverse.get(hexKeyOf(dest)) ?? Infinity;
        if (!Number.isFinite(remaining)) continue;
        if (Number.isFinite(currentRemaining) && remaining >= currentRemaining) continue;
        const post = applyManeuver(move.unit, move, rt.ctx);
        const facing = facingToward(dest, bestGoal.hex);
        const endTurns = turnsTo(post.facing, facing);
        const faced = applyTurns(post, endTurns, rt.ctx);
        if (!faced) continue;
        const score = -remaining * 1_000
          + Math.min(safetyMargin(dest, bestGoal.target.id), 4) * 1_000
          - move.cost * 2 - move.turns.length * 2 - endTurns.length * 30;
        if (!bestRoute || score > bestRoute.score) {
          bestRoute = { move, endTurns, score };
        }
      }
      if (bestRoute) {
        if (bestGoal.target.id !== markedId) rt.setTarget(u.id, bestGoal.target.id);
        u = pushMove(plan, u, bestRoute.move, rt.ctx);
        rt.commit(u);
        if (bestRoute.endTurns.length > 0) {
          const faced = pushTurns(plan, u, bestRoute.endTurns, rt.ctx);
          if (faced) {
            u = faced;
            rt.commit(u);
          }
        }
        const upgrade = nextFormationUpgrade(u, rt.ctx);
        if (upgrade) {
          plan.steps.push({ kind: 'formation', unitId: u.id, from: u.hex, formation: upgrade.formation });
          u = upgrade.updated;
          rt.commit(u);
        }
        return u;
      }
    }
    return safestMove();
  }
  if (bestStage.target.id !== markedId) rt.setTarget(u.id, bestStage.target.id);
  u = pushMove(plan, u, bestStage.move, rt.ctx);
  rt.commit(u);
  if (bestStage.endTurns.length > 0) {
    const faced = pushTurns(plan, u, bestStage.endTurns, rt.ctx);
    if (faced) {
      u = faced;
      rt.commit(u);
    }
  }
  const upgrade = nextFormationUpgrade(u, rt.ctx);
  if (upgrade) {
    plan.steps.push({ kind: 'formation', unitId: u.id, from: u.hex, formation: upgrade.formation });
    u = upgrade.updated;
    rt.commit(u);
  }
  return u;
}

function planFlying(unit: Unit, plan: AiUnitPlan, rt: Runtime): Unit {
  if (isUnitRouted(unit)) return planRouted(unit, plan, rt);
  let u = unit;
  const markedId = rt.byUnit.get(u.id) ?? null;
  const candidates = rt
    .candidates(u, 'flying')
    .slice()
    .sort((a, b) => (a.id === markedId ? 0 : 1) - (b.id === markedId ? 0 : 1) || a.id.localeCompare(b.id));
  // Air superiority first: the marked airborne target, else the nearest one.
  const airTarget =
    candidates.find(c => c.id === markedId && !isGroundTarget(c, rt.ctx))
    ?? candidates.find(c => !isGroundTarget(c, rt.ctx))
    ?? null;
  // Otherwise prefer a grounded target we can swoop.
  let target: Unit | null =
    airTarget ?? candidates.find(c => isGroundTarget(c, rt.ctx)) ?? candidates[0] ?? null;
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

  if (airTarget) {
    // No air charge/swoop by design: fire at range if possible, otherwise melee.
    if (primaryMaxRange(u) > 1 && (u.activeWeaponIndex ?? 0) !== 0) {
      plan.steps.push({ kind: 'weapon', unitId: u.id, from: u.hex, weaponIndex: 0 });
      u = { ...u, activeWeaponIndex: 0 };
      rt.commit(u);
    }
    const primaryRanged = primaryMaxRange(u) > 1;
    const maxRange = Math.max(1, primaryMaxRange(u));
    const targetElev = airTarget.elevation ?? 0;
    const legalNow = legalTargets(u, [airTarget], rt.ctx);
    if (canAct(u) && legalNow.length > 0) {
      u = pushAttack(plan, u, airTarget);
      rt.commit(u);
      return u;
    }

    // In range but facing the wrong way: turn, then attack.
    if (canAct(u) && hexDistance(u.hex, airTarget.hex) <= maxRange) {
      const turns = turnsTo(u.facing, facingToward(u.hex, airTarget.hex));
      if (turns.length > 0) {
        const turned = pushTurns(plan, u, turns, rt.ctx);
        if (turned) {
          u = turned;
          rt.commit(u);
          if (legalTargets(u, [airTarget], rt.ctx).length > 0 && canAct(u)) {
            u = pushAttack(plan, u, airTarget);
            rt.commit(u);
            return u;
          }
        }
      }
    }

    // Find a fly destination that makes the target attackable. Set elevation to
    // the target altitude so adjacent melee satisfies the same-elevation rule.
    const desiredRange = primaryRanged ? maxRange : 1;
    let best: { move: Maneuver; score: number } | null = null;
    for (const move of maneuversFor(u, rt.working, rt.ctx, 'fly', rt.complexes.get(u.id) ?? null)) {
      if (move.path.length === 0) continue;
      const sim = { ...u, hex: move.dest, elevation: targetElev };
      if (legalTargets(sim, [airTarget], rt.ctx).length === 0) continue;
      const post = applyManeuver(move.unit, move, rt.ctx);
      if ((post.actionsAvailable ?? 0) < 1) continue; // need an action for the attack
      const d = hexDistance(move.dest, airTarget.hex);
      const score = -Math.abs(d - desiredRange) * 100 - move.cost * 2 - move.turns.length * 2;
      if (!best || score > best.score) best = { move, score };
    }
    if (best) {
      u = pushMove(plan, u, best.move, rt.ctx, targetElev);
      rt.commit(u);
      if (legalTargets(u, [airTarget], rt.ctx).length > 0 && canAct(u)) {
        u = pushAttack(plan, u, airTarget);
        rt.commit(u);
      }
      return u;
    }

    // No reachable attack: close at the target altitude instead of falling
    // through to a ground swoop/retreat.
    const approach = bestManeuver(u, rt, 'fly', (move) => {
      if (move.path.length === 0) return -Infinity;
      const d = hexDistance(move.dest, airTarget.hex);
      return -Math.abs(d - desiredRange) * 100 - move.cost * 2 - move.turns.length * 2;
    });
    if (approach) {
      u = pushMove(plan, u, approach, rt.ctx, targetElev);
      rt.commit(u);
    }
    return u;
  }

  // One swoop per activation (one charge). A swoop may be declared on the first
  // or a later action; re-check the gate AFTER any facing turn, because the turn
  // may spend the action/flight points needed to charge. The charge-move
  // affordability is validated target-specifically by buildSwoopDropPlan.
  const chargeEnabled = rt.ctx.chargeEnabled !== false;
  const swoopContext = {
    units: rt.working,
    alliances: rt.ctx.alliances,
    formations: rt.ctx.formations,
    structures: rt.ctx.structures,
    structureTemplates: rt.ctx.structureTemplates,
    archerReactionEnabled: rt.ctx.reactiveArchery,
  };
  const trySwoop = (): boolean => {
    for (const candidate of candidates) {
      if (candidate.isDeleted || !isGroundTarget(candidate, rt.ctx)) continue;
      if (chargeStanceFor({
        unit: u,
        airborne: unitIsAirborne(u, rt.ctx),
        form: rt.ctx.formations[u.currentFormation],
        chargeEnabled,
      }) !== 'swoop') return false;
      const faceTurns = turnsTo(u.facing, facingToward(u.hex, candidate.hex));
      const faced = faceTurns.length > 0 ? applyTurns(u, faceTurns, rt.ctx) : u;
      if (!faced) continue;
      if (chargeStanceFor({
        unit: faced,
        airborne: unitIsAirborne(faced, rt.ctx),
        form: rt.ctx.formations[faced.currentFormation],
        chargeEnabled,
      }) !== 'swoop') continue;
      const charged: Unit = {
        ...faced,
        isCharging: true,
        chargeDistance: 0,
        actionsAvailable: (faced.actionsAvailable ?? 0) - 1,
        flySpeedAvailable: (faced.flySpeedAvailable ?? 0) + flyMax(faced),
      };
      const swoopPlan = buildSwoopDropPlan(charged, candidate, swoopContext);
      if (!swoopPlan || swoopPlan.overBudget) continue;
      const spend = applyMoveCost(
        moveBudgetUnit(charged, 'fly'),
        swoopPlan.cost,
        swoopPlan.maxMP,
      );
      let next = u;
      if (faceTurns.length > 0) {
        const turned = pushTurns(plan, next, faceTurns, rt.ctx);
        if (!turned) continue;
        next = turned;
      }
      plan.steps.push({ kind: 'charge', unitId: next.id, from: next.hex });
      plan.steps.push({ kind: 'swoop', unitId: next.id, from: next.hex, targetId: candidate.id, target: candidate.hex });
      u = {
        ...next,
        hex: swoopPlan.landHex,
        elevation: swoopPlan.elevation,
        flySpeedAvailable: spend.movementPointsAvailable,
        actionsAvailable: spend.actionsAvailable,
        isCharging: false,
        chargeDistance: 0,
      };
      rt.commit(u);
      target = candidate;
      return true;
    }
    return false;
  };
  trySwoop();

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
  const allEnemies = enemyPool(ctx, working)
    .filter(e => ctx.gridRadius == null || isHexOnGrid(e.hex, ctx.gridRadius));
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
    mountedEligible: (target) => isOuterRimTarget(target, groundOccupied, enemies),
    flyingAirborne: (target) => !isGroundTarget(target, ctx),
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
    reverseHexMaps: new Map(),
    complexByHex: new Map(),
    topAccessCache: new Map(),
    climbObjectives: new Map(),
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

  // Vacant structure tops are taken first; those units get a climb objective
  // instead of a defender mark.
  assignStructureTakeover(rt, controllable);
  for (const unitId of Array.from(rt.climbObjectives.keys())) rt.byUnit.delete(unitId);

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
    // Hanging is a hard lock: climb to the chosen top exit and land, or (routed)
    // drop down. No other moves, formations, targets or escapes.
    if (isClimbingUnit(live, ctx.structures, ctx.structureTemplates)) {
      if (isUnitRouted(live)) {
        const originSurface = surfaceAt(live.hex, rt.ctx);
        const feet = Math.max(0, (live.elevation ?? 0) - originSurface);
        const occupied = isOccupiedAt(rt, live.hex, originSurface, live.id);
        if (feet > 0 && !occupied) {
          plan.steps.push({ kind: 'drop', unitId: live.id, from: live.hex, to: live.hex });
        } else if ((live.actionsAvailable ?? 0) >= 1
          && computeMoveCapacity(live, effectiveMax(live, ctx.formations)) > 0) {
          plan.steps.push({ kind: 'climb', unitId: live.id, from: live.hex, to: live.hex });
        }
      } else {
        const wall = wallClimbState(live, rt);
        if (wall) {
          if (canAffordWallClimbState(live, wall, rt)) {
            plan.steps.push({ kind: 'climbOver', unitId: live.id, from: live.hex, to: wall.farHex, descent: 'climb' });
          }
        } else {
          const exit = hangingExitFor(rt, live);
          if (exit && canAffordClimbTo(live, exit.topHex, rt)) {
            if (exit.enemy) {
              plan.steps.push({ kind: 'climbAttack', unitId: live.id, from: live.hex, targetId: exit.enemy.id, target: exit.enemy.hex });
            } else {
              plan.steps.push({ kind: 'climb', unitId: live.id, from: live.hex, to: exit.topHex });
            }
          }
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
