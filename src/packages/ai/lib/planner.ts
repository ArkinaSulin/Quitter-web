// src/packages/ai/lib/planner.ts
// Pure "enemy AI assist" decision layer. Given a snapshot of the board and the
// teams handed to the AI, produce an ordered plot (per-unit move/attack/
// turn/formation steps) that the GM can preview and then execute through the
// NORMAL action path.
//
// Design rules (v4 — safety + formations):
//  - Gated out of AI control: deleted, killed (HP <= 0), hidden units, hero-
//    hosted/attached units, and units whose alliance is not the active turn.
//    Routed units ARE plotted — they flee as far from hostiles as possible,
//    stopping at the map rim (gridRadius).
//  - A unit only ever attacks adversarial alliances (friendly<->enemy; neutral
//    is never auto-attacked or auto-driven). No friendly fire by construction.
//  - Self-preservation (both brains): destinations are penalized for other live
//    enemies in the mover's flank/rear arcs (the intended melee target is
//    excluded), paths that pass adjacent to non-target enemies are penalized,
//    and turns carry a real score cost so a straight advance wins unless a turn
//    is clearly better.
//  - Formation-aware retaliation (both brains): the defender's retaliate_arcs
//    decide none / rows (defensive count) / full, plus retaliate_vs_ranged and
//    the attacker's be_attacked vulnerability.
//  - Plans stay strictly within budget (never a soft-enforcement prompt): moves
//    use the reachable map + real MP accounting; rotations cost 1 MP/60° for
//    formed units (free for Hero/Scattered/Routed) via applyMpSpend; attacks
//    require an action and stay under the attack cap. No about-turns (org loss).
//  - Doctrine is automatic by weapon type: ranged-only units stand off (keep
//    distance, adopt Scattered near contact); melee/hybrid units engage.
//  - Advanced adds expected-retaliation trade value, a finishing/overkill bonus,
//    target reservation, and (in/near a hostile ZoC) formation changes scored by
//    net damage dealt − received minus the change cost.
//  - Ranged targets pick the biggest threat first: an enemy within 2 hexes,
//    else a Phalanx, else a Close Order unit; value breaks ties.
//  - Melee prefers the best attack arc (rear > flank > front) and tries cheap
//    flanking approaches (up to a few 60° turns) instead of frontal rushes.
//  - Fog is respected: targets must lie in the AI side's visible hexes.
//  - Everything is deterministic (tie-breaks by unit id / hex distance).
import { Unit, Hex, AllianceGroup, Formation, GroundEffect, hexDistance } from '@/types/gameProtocol';
import { parseWeapons, isAreaWeapon } from '@/packages/units';
import { isUnitRouted, calcIsolation, computeThreatRating } from '@/packages/morale';
import { rotateLeft, rotateRight, HEX_DIRS, facingToward } from '@/packages/primitives';
import { allianceOf as teamAllianceOf } from '@/packages/primitives';
import { isProtectedHero } from '@/packages/units';
import { arcsContain, beAttackedModifier, isLooseUnit } from '@/packages/movement';
import { getRowCapacityBase, getVisualDotsPerRow, effectiveAc, acVsWarMachine, heroAuraBonus } from '@/packages/units';
import { attackDirection, arcOfTarget } from '@/packages/primitives';
import { unitAttackCap } from '@/packages/combat';
import { computeReachableMap, computeMovePool, computeMoveBudget, applyMoveCost, applyMpSpend, canAdoptFormation, getFormationChangeMpCost, MapStructures, OrgMoveOpts, CostOfHexFn, doorPassThroughHexes, entryBreakFormation, formationOrgLevels, loosePassThroughHexes, unitStandingSurface, hexStructureAt, structureDoorState, structureDoorHex, isHexStructureKey } from '@/packages/movement';
import { StructureTemplate } from '@/types/structure';
import { isMeleeWeapon } from '@/packages/combat';
import { TerrainCosts, computeThreatHexes, computeOccupiedHexes, makeCostOfHex, makeBlockedEdge } from '@/packages/world';
import { Walls } from '@/packages/movement';
import type { BlockedEdgeFn } from '@/packages/movement';
import { determineCombatPosition, combatRollMode, resolveRetaliationPosition, RollMode } from '@/packages/combat';
import { clampDamage } from '@/packages/primitives';
import { attackRollFlags, effectAttackBonus, effectDamageBonus, unitIgnoresClimb } from '@/packages/effects';
import { applyFormationChange, isFormationChangeAffordable } from '@/packages/movement';
import { hasLineOfSight } from '@/packages/combat';
import { BattleLine, computeBattleLine, isFlankOrRearThreat, leadingRank, findLineGaps, projectPoint } from './battleLine';
import { ReservePlacement, assignReservePlacements, sectorOfProjection } from './reserve';

export type AiStep =
  | { kind: 'move'; unitId: string; from: Hex; to: Hex; path: Hex[]; cost: number }
  | { kind: 'attack'; unitId: string; from: Hex; targetId: string; target: Hex }
  | { kind: 'turn'; unitId: string; from: Hex; dir: 'left' | 'right' }
  | { kind: 'formation'; unitId: string; from: Hex; formation: string };

export interface AiUnitPlan {
  unitId: string;
  steps: AiStep[];
}

export interface AiPlanContext {
  units: Unit[];
  alliances: Record<string, AllianceGroup>;
  formations: Record<string, Formation>;
  /** Teams handed to the AI for this plot. */
  teams: string[];
  /** Units the DM opted out of AI control (kept on the board, never plotted). */
  excludeUnitIds?: string[];
  /** Current turn's alliance (null = free play — never plot). */
  activeAlliance: AllianceGroup | null;
  /** Fog reveal for the AI side (hex keys). null/undefined = no fog. */
  visibleHexes?: Set<string> | null;
  terrainCosts?: TerrainCosts;
  /** Edge walls (per-edge move cost / block / AC). */
  walls?: Walls;
  /** Placed structures (hex/edge instances) — dynamic ground, doors, climb. */
  structures?: MapStructures;
  structureTemplates?: Record<string, StructureTemplate>;
  /** Painted + structure-derived ground zones (org gates, mp_cost, auras). */
  groundZones?: GroundEffect[];
  /** Tuned brain: retaliation-aware melee, finish/overkill value, zone-aware
   *  positioning, and light target reservation. OFF = green-friendly greedy. */
  advanced?: boolean;
  /** Aggressive (default) pursues damage; defensive prioritizes self-protection,
   *  line cohesion and exposure avoidance. Per-preview AI-tab toggle. */
  stance?: 'aggressive' | 'defensive';
  /** Grid radius (axial ring). When set, routed flee stops at the outer rim. */
  gridRadius?: number;
  /** Max plot steps per unit (default 5 — enough for turn + move + attack). */
  maxStepsPerUnit?: number;
  /** Max 60° turns per approach (default 3 — a full 180°, never about-turn). */
  maxTurns?: number;
  /** Reactive archery: a threat/ZoC hex is a valid destination only as a move's
   *  first step (the AI stops before it, like the human rule). */
  reactiveArchery?: boolean;
}

export function hexKeyOf(hex: { q: number; r: number }): string {
  return `${hex.q},${hex.r}`;
}

/** Team -> alliance group (unit-taking convenience over `alliances.allianceOf`). */
export function allianceOf(unit: Pick<Unit, 'team'>, alliances: Record<string, AllianceGroup>): AllianceGroup {
  return teamAllianceOf(unit.team, alliances);
}

/** Which alliances a given alliance treats as adversarial. Neutral is never attacked. */
export function enemyGroupsOf(group: AllianceGroup): Set<AllianceGroup> {
  if (group === 'friendly') return new Set<AllianceGroup>(['enemy']);
  if (group === 'enemy') return new Set<AllianceGroup>(['friendly']);
  return new Set<AllianceGroup>();
}

function frontageSort<T extends { hex: Hex; id: string }>(a: T, b: T): number {
  return a.hex.q - b.hex.q || a.hex.r - b.hex.r || a.id.localeCompare(b.id);
}

/** Deterministic, direction-neutral tie-break (no BFS-east bias). */
function hexTieHash(h: Hex): number {
  return (((h.q * 73856093) ^ (h.r * 19349663)) >>> 0);
}

function assignmentTargetValue(
  target: Unit,
  units: Unit[],
  alliances: Record<string, AllianceGroup>,
  advanced: boolean,
): number {
  const ac = target.currentAc ?? target.baselineAc ?? 14;
  const hpFrac = (target.maxUnitHp ?? 0) > 0
    ? Math.max(0, Math.min(1, (target.currentUnitHp ?? 0) / Math.max(1, target.maxUnitHp)))
    : 1;
  let value = Math.max(0, (20 - ac) * 0.4) + (1 - hpFrac) * 8;
  if (advanced && calcIsolation(target, units, alliances)) value += 8;
  return value;
}

function assignmentPairCost(
  unit: Unit,
  target: Unit,
  units: Unit[],
  alliances: Record<string, AllianceGroup>,
  advanced: boolean,
): number {
  return hexDistance(unit.hex, target.hex) * 10 - assignmentTargetValue(target, units, alliances, advanced);
}

/**
 * Line-order target assignment: sort both sides by frontage (q), pair
 * left-to-right, then allow adjacent value swaps. This is a *preference*; the
 * per-unit planner may still retarget when the board changes.
 */
export function assignTargets(
  units: Unit[],
  enemies: Unit[],
  alliances: Record<string, AllianceGroup>,
  advanced = false,
): Map<string, string> {
  const out = new Map<string, string>();
  const foes = enemies.filter(e => !e.isDeleted && !e.hidden && (e.currentUnitHp ?? 0) > 0 && !isProtectedHero(e));
  if (units.length === 0 || foes.length === 0) return out;
  const sortedUnits = [...units].sort(frontageSort);
  const sortedFoes = [...foes].sort(frontageSort);

  if (sortedUnits.length <= sortedFoes.length) {
    const offset = Math.floor((sortedFoes.length - sortedUnits.length) / 2);
    sortedUnits.forEach((u, i) => out.set(u.id, sortedFoes[offset + i].id));
  } else {
    sortedFoes.forEach((f, i) => out.set(sortedUnits[i].id, f.id));
    // Extra units double up on the nearest assigned target (by q).
    for (let i = sortedFoes.length; i < sortedUnits.length; i++) {
      const u = sortedUnits[i];
      let best = sortedFoes[0];
      for (const f of sortedFoes) if (Math.abs(f.hex.q - u.hex.q) < Math.abs(best.hex.q - u.hex.q)) best = f;
      out.set(u.id, best.id);
    }
  }

  // Adjacent local swaps for value (never leaves the line uncovered).
  const byId = new Map(foes.map(f => [f.id, f]));
  for (let i = 0; i < sortedUnits.length - 1; i++) {
    const u1 = sortedUnits[i];
    const u2 = sortedUnits[i + 1];
    const t1 = byId.get(out.get(u1.id) ?? '');
    const t2 = byId.get(out.get(u2.id) ?? '');
    if (!t1 || !t2 || t1.id === t2.id) continue;
    const current = assignmentPairCost(u1, t1, units, alliances, advanced) + assignmentPairCost(u2, t2, units, alliances, advanced);
    const swapped = assignmentPairCost(u1, t2, units, alliances, advanced) + assignmentPairCost(u2, t1, units, alliances, advanced);
    if (swapped < current - 12) {
      out.set(u1.id, t2.id);
      out.set(u2.id, t1.id);
    }
  }
  return out;
}

export type AiBattleRole =
  | { kind: 'frontage'; targetId: string }
  | { kind: 'flank'; targetId: string; side: 'left' | 'right' }
  | { kind: 'rear'; targetId: string; side: 'left' | 'right' }
  | { kind: 'reserve'; targetId: string; behindUnitId: string }
  | { kind: 'ranged' }
  | { kind: 'structure'; structureKey: string; holdHex: Hex };

export interface BattleAssignment {
  roles: Map<string, AiBattleRole>;
  frontageIds: Set<string>;
  /** Enemies in the hostile forward band that are paired with a frontage unit. */
  frontFoeIds: Set<string>;
  /** Hostile forward-band units with no frontage pairing. */
  unpairedFoeIds: Set<string>;
  ownFrontCount: number;
  enemyFrontCount: number;
}

/** The standing structure a unit is defending, if any. A hex structure uses its
 *  own hex; an edge structure protects the INSIDE hex. Open doors do not release
 *  the hold while the structure still stands. */
function structureHoldFor(u: Unit, ctx: AiPlanContext): { key: string; hex: Hex } | null {
  const structures = ctx.structures;
  const templates = ctx.structureTemplates;
  if (!structures || !templates) return null;
  const own = hexStructureAt(structures, u.hex);
  if (own) {
    const t = templates[own.templateId];
    if (t && structureDoorState(own, t).hpNow > 0) {
      return { key: `${u.hex.q},${u.hex.r}`, hex: { ...u.hex } };
    }
  }
  for (const [key, inst] of Object.entries(structures)) {
    if (isHexStructureKey(key)) continue;
    const t = templates[inst.templateId];
    if (!t || structureDoorState(inst, t).hpNow <= 0) continue;
    const inside = structureDoorHex(key, inst);
    if (inside && inside.q === u.hex.q && inside.r === u.hex.r) {
      return { key, hex: { ...u.hex } };
    }
  }
  return null;
}

/**
 * Pick frontage and surplus roles. Surplus units are the outer units of a
 * candidate contiguous frontage window; the window can shift left/right so the
 * whole line can cover one end and send two adjacent units around the other.
 * Ranged-only units and structure defenders never become frontage/flankers.
 */
export function assignBattleRoles(
  units: Unit[],
  enemies: Unit[],
  ctx: AiPlanContext,
  advanced = false,
): BattleAssignment {
  const roles = new Map<string, AiBattleRole>();
  const frontageIds = new Set<string>();
  const allFoes = enemies
    .filter(e => !e.isDeleted && !e.hidden && (e.currentUnitHp ?? 0) > 0 && !isProtectedHero(e))
    .sort(frontageSort);
  // Pair only the enemies in the forward band. A second-rank reserve does not
  // consume a frontage slot (and must not hide a real surplus/flanker).
  let foes = allFoes;
  if (allFoes.length > 1 && units.length > 0) {
    const nearestToOwn = allFoes.map(e =>
      Math.min(...units.map(u => hexDistance(e.hex, u.hex))),
    );
    const closest = Math.min(...nearestToOwn);
    const front = allFoes.filter((_, i) => nearestToOwn[i] <= closest + 1);
    if (front.length > 0) foes = front;
  }
  const stance = ctx.stance ?? 'aggressive';

  for (const u of units) {
    if (u.isDeleted || u.hidden || (u.currentUnitHp ?? 0) <= 0) continue;
    const hold = structureHoldFor(u, ctx);
    if (hold) roles.set(u.id, { kind: 'structure', structureKey: hold.key, holdHex: hold.hex });
    else if (unitDoctrine(u) === 'ranged') roles.set(u.id, { kind: 'ranged' });
  }

  const melee = units.filter(u =>
    !roles.has(u.id)
    && !u.isDeleted && !u.hidden && (u.currentUnitHp ?? 0) > 0
  ).sort(frontageSort);

  if (melee.length === 0 || foes.length === 0) {
    return {
      roles,
      frontageIds,
      frontFoeIds: new Set(),
      unpairedFoeIds: new Set(foes.map(f => f.id)),
      ownFrontCount: 0,
      enemyFrontCount: foes.length,
    };
  }

  // Defensive doctrine pairs the whole enemy front line first: use the leading
  // rank, and only promote rear-rank units when the leading rank is short of
  // the enemy front count. Roles are not permanent — a unit not paired and not
  // engaged is a reserve, and an engaged reserve fights as front line until
  // freed. True surplus after full coverage becomes reserves.
  const nearestFoeDist = (u: Unit): number =>
    Math.min(...foes.map(f => hexDistance(u.hex, f.hex)));
  const leading = stance === 'defensive' ? leadingRank(melee, foes) : melee;
  let frontagePool = leading;
  if (stance === 'defensive' && leading.length < foes.length) {
    const leadingIds = new Set(leading.map(u => u.id));
    const rear = melee
      .filter(u => !leadingIds.has(u.id))
      .sort((a, b) =>
        nearestFoeDist(a) - nearestFoeDist(b)
        || a.hex.q - b.hex.q
        || a.id.localeCompare(b.id));
    frontagePool = [...leading, ...rear]
      .slice(0, Math.min(melee.length, foes.length))
      .sort(frontageSort);
  }
  const count = Math.min(frontagePool.length, foes.length);
  const foeCentreQ = foes.reduce((sum, f) => sum + f.hex.q, 0) / foes.length;
  const foeSpan = foes[foes.length - 1].hex.q - foes[0].hex.q;
  let best: { score: number; roles: Map<string, AiBattleRole>; frontageIds: Set<string> } | null = null;

  for (let start = 0; start + count <= frontagePool.length; start++) {
    const main = frontagePool.slice(start, start + count);
    const mainIds = new Set(main.map(m => m.id));
    const extras = melee.filter(m => !mainIds.has(m.id));
    const candidate = new Map<string, AiBattleRole>();
    const candidateFrontage = new Set<string>();
    main.forEach((u, i) => {
      candidate.set(u.id, { kind: 'frontage', targetId: foes[i].id });
      candidateFrontage.add(u.id);
    });

    let score = 100 + count * 20;
    const centre = (frontagePool.length - count) / 2;
    score -= Math.abs(start - centre) * 3;
    // Shift the whole line laterally to align with the enemy front span.
    const mainCentreQ = main.reduce((sum, u) => sum + u.hex.q, 0) / main.length;
    const mainSpan = main[main.length - 1].hex.q - main[0].hex.q;
    score -= Math.abs(mainCentreQ - foeCentreQ) * 8;
    score -= Math.abs(mainSpan - foeSpan) * 2;

    const seenSide = new Map<'left' | 'right', number>();
    const usedAnchors = new Set<string>();
    for (const extra of extras) {
      const side: 'left' | 'right' = extra.hex.q < main[0].hex.q ? 'left' : 'right';
      const target = side === 'left' ? foes[0] : foes[foes.length - 1];
      const sideIndex = seenSide.get(side) ?? 0;
      seenSide.set(side, sideIndex + 1);

      // Aggressive surplus looks for the rear first; a second unit on the same
      // end covers the flank. Defensive surplus belongs in the second rank,
      // anchored to the closest front-line unit so it keeps a central, mobile
      // position instead of being dragged to a far end.
      let role: AiBattleRole;
      let anchorDistance = 0;
      if (stance === 'aggressive') {
        role = advanced
          ? { kind: sideIndex % 2 === 0 ? 'rear' : 'flank', targetId: target.id, side }
          : { kind: 'flank', targetId: target.id, side };
        anchorDistance = hexDistance(extra.hex, target.hex);
      } else {
        const nearest = main
          .filter(m => !usedAnchors.has(m.id))
          .sort((a, b) =>
            hexDistance(extra.hex, a.hex) - hexDistance(extra.hex, b.hex)
            || a.hex.q - b.hex.q
            || a.id.localeCompare(b.id))[0]
          ?? main.slice().sort((a, b) =>
            hexDistance(extra.hex, a.hex) - hexDistance(extra.hex, b.hex)
            || a.hex.q - b.hex.q
            || a.id.localeCompare(b.id))[0];
        const anchorTarget = candidate.get(nearest.id);
        role = {
          kind: 'reserve',
          targetId: anchorTarget && 'targetId' in anchorTarget ? anchorTarget.targetId : target.id,
          behindUnitId: nearest.id,
        };
        usedAnchors.add(nearest.id);
        anchorDistance = hexDistance(extra.hex, nearest.hex);
      }
      candidate.set(extra.id, role);

      const friends = units
        .filter(f => f.id !== extra.id && !f.isDeleted && !f.hidden && (f.currentUnitHp ?? 0) > 0)
        .map(f => hexDistance(extra.hex, f.hex));
      const connected = friends.length > 0 ? Math.min(...friends) : 99;
      score += Math.max(0, 4 - connected) * 8;
      if (stance === 'defensive' && connected > 2) score -= 50;
      if (calcIsolation(extra, units, ctx.alliances)) score -= stance === 'defensive' ? 80 : 15;
      // Speed is a primary flanker trait: fast riders must not be spent as
      // frontage while slower warriors become surplus.
      score += effMax(extra, ctx.formations) * 8;
      score -= anchorDistance * 2;
      if (stance === 'aggressive') score += 10;
    }
    // Keep a surplus pair on one end when possible; adjacent flankers are less
    // isolated and can support each other.
    if (stance === 'aggressive' && extras.length > 1 && seenSide.size === 1) score += 8;

    // A small random jitter makes near-equal plans vary. The executed plan is
    // logged, so undo/redo remains consistent regardless of the roll.
    score += Math.random() * 4;

    if (!best || score > best.score) best = { score, roles: candidate, frontageIds: candidateFrontage };
  }

  if (best) {
    Array.from(best.roles.entries()).forEach(([id, role]) => roles.set(id, role));
    Array.from(best.frontageIds).forEach(id => frontageIds.add(id));
  }
  return {
    roles,
    frontageIds,
    frontFoeIds: new Set(foes.slice(0, count).map(f => f.id)),
    unpairedFoeIds: new Set(foes.slice(count).map(f => f.id)),
    ownFrontCount: count,
    enemyFrontCount: foes.length,
  };
}

/** True when a unit is eligible to be handed to the AI at this moment.
 *  Heroes (and units with an attached hero) are NEVER AI-controlled — players
 *  and the DM play those. Routed units ARE eligible — the planner flees them. */
export function isAiControllable(
  unit: Unit,
  ctx: Pick<AiPlanContext, 'alliances' | 'teams' | 'activeAlliance'>,
  hostedBy: Set<string>,
): boolean {
  if (unit.isDeleted) return false;
  if (unit.isHero) return false; // heroes are played by people, not the AI
  if (unit.hidden) return false; // hidden units are never AI-controlled
  if ((unit.currentUnitHp ?? 0) <= 0) return false; // killed / downed
  if (unit.attachedToUnitId) return false; // attached hero rides its host
  if (hostedBy.has(unit.id)) return false; // host of an attached hero — people play these too
  if (!ctx.teams.includes(unit.team)) return false;
  if (ctx.activeAlliance === null) return false; // free play — no plotting
  if (allianceOf(unit, ctx.alliances) !== ctx.activeAlliance) return false;
  if ((unit.actionsAvailable ?? 0) < 1 && (unit.movementPointsAvailable ?? 0) < 1) return false;
  return true;
}

function arcBetween(from: Hex, facing: number, to: Hex): 'front' | 'flank' | 'rear' {
  return arcOfTarget(from, facing, to);
}

/** Legal targets of `attacker`, with the basic ranged/melee classification. */
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
    if (ctx.visibleHexes && !ctx.visibleHexes.has(key)) continue; // can't shoot what it can't see
    const targetArc = arcBetween(attacker.hex, attacker.facing, other.hex);
    if (dist > 1) {
      const range = weapon?.range ?? 1;
      const maxRange = Math.max(range, weapon?.maxRange ?? range);
      const isRangedCapable = range > 1 || maxRange > 1;
      if (!weapon || !isRangedCapable || dist > maxRange) continue;
      if (form && !arcsContain(form.ranged_target_arcs, targetArc)) continue;
      out.push({ unit: other, dist, isRanged: true });
    } else {
      // Melee at adjacency: the attacker's formation must allow that arc (fists
      // are always an option if no usable weapon).
      if (form && attacker.currentFormation !== 'Scattered' && !attacker.isHero && attacker.currentFormation !== 'Hero') {
        if (!arcsContain(form.melee_target_arcs, targetArc)) continue;
      }
      out.push({ unit: other, dist, isRanged: false });
    }
  }
  return out;
}

function diceMean(diceStr: string): number {
  const m = diceStr.match(/^(\d*)d(\d+)(?:\+(\d+))?$/i);
  if (!m) return 0;
  const count = parseInt(m[1] || '1');
  const sides = parseInt(m[2]);
  const bonus = parseInt(m[3] || '0');
  return count * ((sides + 1) / 2) + bonus;
}

function hitChance(atkBonus: number, targetAc: number, mode: RollMode): number {
  const need = targetAc - atkBonus;
  let p = (21 - Math.min(20, Math.max(1, need))) / 20;
  p = Math.max(0, Math.min(1, p));
  if (mode === 'advantage') p = 1 - (1 - p) * (1 - p);
  else if (mode === 'disadvantage') p = p * p;
  return p;
}

function expectedAttackerCount(
  attacker: Unit,
  ctx: Pick<AiPlanContext, 'formations' | 'units' | 'alliances'>,
  defenderSide = false,
): number {
  const form = ctx.formations[attacker.currentFormation];
  const weapons = parseWeapons(attacker.weaponString || '');
  const weapon = weapons[attacker.activeWeaponIndex ?? 0] ?? weapons[0];
  const weaponAttacks = weapon?.numberOfAttacks ?? 1;
  if (attacker.isHero || (weapon?.warMachine ?? false)) return weaponAttacks;
  const rowCap = getRowCapacityBase(attacker.sizeCategory);
  if (defenderSide) {
    // Retaliation from a flank/rows arc: one attack per DEFENSIVE row, not the
    // formation's full attack-capacity cap (mirrors computeAttackCount).
    const dpr = getVisualDotsPerRow(ctx.formations, rowCap, attacker.currentFormation);
    const rows = Math.ceil(Math.max(1, attacker.currentTroopCount) / dpr);
    return Math.max(1, rows * weaponAttacks);
  }
  const atkCapMult = form?.attack_capacity_multiplier ?? 1;
  const cap = Math.min(attacker.currentTroopCount, Math.round(rowCap * atkCapMult));
  return Math.max(1, cap * weaponAttacks);
}

/** Expected damage of `attacker` vs `target` this action (0 = pointless). */
export function expectedDamage(
  attacker: Unit,
  target: Unit,
  dist: number,
  isRanged: boolean,
  ctx: Pick<AiPlanContext, 'formations' | 'units' | 'alliances'>,
  /** Retaliation from a flank/rows arc uses the rows-based defensive count. */
  defenderSide = false,
): number {
  // At adjacency a ranged active weapon falls back to a melee weapon / fists,
  // matching the real attack path (never a point-blank bow profile).
  let unit = attacker;
  if (dist === 1 && !isRanged) {
    const weapons = parseWeapons(attacker.weaponString || '');
    const active = weapons[attacker.activeWeaponIndex ?? 0] ?? weapons[0];
    if (!active || !isMeleeWeapon(active)) {
      const meleeIdx = weapons.findIndex(w => isMeleeWeapon(w));
      unit = meleeIdx === -1
        ? { ...attacker, weaponString: '', activeWeaponIndex: 0 }
        : { ...attacker, activeWeaponIndex: meleeIdx };
    }
  }
  const weapons = parseWeapons(unit.weaponString || '');
  const weapon = weapons[unit.activeWeaponIndex ?? 0] ?? weapons[0];
  const targetForm = ctx.formations[target.currentFormation];
  const atkAura = heroAuraBonus(unit, ctx.units, ctx.alliances, isRanged);
  const defAura = heroAuraBonus(target, ctx.units, ctx.alliances, isRanged);
  const targetAc = weapon?.warMachine
    ? acVsWarMachine(target, isRanged, 0)
    : effectiveAc(target, targetForm, attackDirection(attacker.hex, target.hex, target.facing), isRanged, 0, defAura.ac);
  // Roll mode from attack-roll flag effects (any advantage cancels any
  // disadvantage) plus the long-range band.
  const aFlags = attackRollFlags(unit);
  const tFlags = attackRollFlags(target);
  const weaponRange = weapon?.range ?? 1;
  const weaponMax = weapon?.maxRange ?? weaponRange;
  const rollMode = combatRollMode({
    attackerAdvantage: aFlags.advantage,
    attackerDisadvantage: aFlags.disadvantage,
    targetAdvantage: tFlags.grantAdvantage,
    targetDisadvantage: tFlags.grantDisadvantage,
    rangeDisadvantage: !!weapon && isRanged && dist > weaponRange && dist <= weaponMax,
    losDisadvantage: !!weapon && isRanged && !hasLineOfSight(unit.hex, target.hex, ctx.units, new Set([unit.id, target.id]), undefined, undefined, { fromElevation: unit.elevation ?? 0, toElevation: target.elevation ?? 0 }),
  });
  if (weapon?.isHealing || (weapon && isAreaWeapon(weapon))) return 0; // AI doesn't heal/cast in v2
  if (weapon && dist < (weapon.minRange ?? 0)) return 0; // too close for the weapon's minimum range
  if (!weapon) {
    if (dist !== 1) return 0;
    return expectedAttackerCount(unit, ctx, defenderSide) * hitChance(0, targetAc, rollMode.mode) * 1; // fists 1d1
  }
  const effBonus = weapon.attackBonus + (ctx.formations[unit.currentFormation]?.attack_modifier ?? 0) + atkAura.attack + effectAttackBonus(unit, isRanged);
  const mod = beAttackedModifier(targetForm, isRanged) ?? 1;
  const count = Math.round(expectedAttackerCount(unit, ctx, defenderSide) * mod);
  const heroCap = !isRanged && !unit.isHero && target.isHero ? 0.5 : 1;
  const perHit = clampDamage(diceMean(weapon.damageDice) + atkAura.damage + effectDamageBonus(unit, isRanged), target.troopHp);
  return Math.max(0, Math.round(count * heroCap) * hitChance(effBonus, targetAc, rollMode.mode) * perHit);
}

function nearestEnemyDist(hex: Hex, enemies: Unit[]): number {
  let best = Infinity;
  for (const e of enemies) {
    const d = hexDistance(hex, e.hex);
    if (d < best) best = d;
  }
  return best;
}

function activeWeaponOf(u: Unit) {
  const weapons = parseWeapons(u.weaponString || '');
  return weapons[u.activeWeaponIndex ?? 0] ?? weapons[0];
}

/**
 * Expected damage the defender can put back into the attacker this exchange.
 * Routed units cannot retaliate; adjacency uses a personal/melee weapon (or
 * fists), never a ranged weapon's point-blank profile.
 */
export function expectedRetaliation(
  defender: Unit,
  attacker: Unit,
  dist: number,
  ctx: Pick<AiPlanContext, 'formations' | 'units' | 'alliances'>,
): number {
  if (isUnitRouted(defender)) return 0;
  const attackerWeapon = activeWeaponOf(attacker);
  if (attackerWeapon?.noRetaliation) return 0;
  const form = ctx.formations[defender.currentFormation];
  const isRangedAttack = dist > 1;
  // A formation may forbid retaliation against ranged attacks entirely.
  if (isRangedAttack && !form?.retaliate_vs_ranged) return 0;
  // The defender's retaliate_arcs decide full / rows / none for this direction.
  const raw = determineCombatPosition(attacker.hex, defender.hex, defender.facing);
  const retPos = resolveRetaliationPosition(defender, form, raw);
  if (retPos === 'rear') return 0; // no retaliation from that arc
  const defenderSide = retPos === 'flank'; // rows-based defensive count
  const weapons = parseWeapons(defender.weaponString || '');
  if (dist === 1) {
    const meleeIdx = weapons.findIndex(w => isMeleeWeapon(w));
    if (meleeIdx === -1) {
      return expectedDamage({ ...defender, weaponString: '', activeWeaponIndex: 0 }, attacker, 1, false, ctx, defenderSide);
    }
    return expectedDamage({ ...defender, activeWeaponIndex: meleeIdx }, attacker, 1, false, ctx, defenderSide);
  }
  const rangedIdx = weapons.findIndex(w => {
    if (w.isHealing) return false;
    const range = w.range ?? 1;
    const maxRange = Math.max(range, w.maxRange ?? range);
    return (range > 1 || maxRange > 1) && dist >= (w.minRange ?? 0) && dist <= maxRange;
  });
  if (rangedIdx === -1) return 0;
  return expectedDamage({ ...defender, activeWeaponIndex: rangedIdx }, attacker, dist, true, ctx, defenderSide);
}

interface AttackValue {
  dmg: number;
  score: number;
  counter: number;
}

/**
 * Attack value used by target selection.
 * Basic = raw expected damage (the shipped greedy brain).
 * Advanced = marginal damage after prior reservations, a finishing bonus, and
 * the expected counter-damage as a penalty. Aggressive advance also values
 * isolated / low-AC targets and avoids non-lethal melee locks.
 */
/** Approximate chance the AGR check passes for an active melee attack. A rear
 *  attack skips AGR entirely (guaranteed damage). */
function agrPassChance(
  attacker: Unit,
  target: Unit,
  isRanged: boolean,
  isRear: boolean,
  attachedHero: boolean,
): number {
  if (isRanged || isRear || attacker.isHero || isUnitRouted(target) || attachedHero) return 1;
  const weapon = activeWeaponOf(attacker);
  if (!weapon || weapon.noRetaliation || weapon.freeAction) return 1;
  const threat = Math.round(computeThreatRating(target) / Math.max(1, computeThreatRating(attacker)));
  const penalty = Math.max(0, threat - 1);
  const agr = Math.max(1, Math.min(10, attacker.aggressiveness ?? 5));
  return Math.max(0.05, Math.min(1, (agr - penalty) / 10));
}

function attackValue(
  attacker: Unit,
  target: Unit,
  dist: number,
  isRanged: boolean,
  ctx: Pick<AiPlanContext, 'formations' | 'units' | 'alliances'>,
  advanced: boolean,
  stance: 'aggressive' | 'defensive',
  reserved: Map<string, number>,
): AttackValue {
  const isRear = !isRanged && determineCombatPosition(attacker.hex, target.hex, target.facing) === 'rear';
  const attachedHero = false;
  const chance = agrPassChance(attacker, target, isRanged, isRear, attachedHero);
  const dmg = expectedDamage(attacker, target, dist, isRanged, ctx);
  if (dmg <= 0) return { dmg: 0, score: 0, counter: 0 };
  const counter = expectedRetaliation(target, attacker, dist, ctx);
  if (!advanced) return { dmg, score: dmg, counter };
  const already = reserved.get(target.id) ?? 0;
  const remaining = Math.max(0, (target.currentUnitHp ?? 0) - already);
  if (remaining <= 0) return { dmg: 0, score: 0, counter };
  const effective = Math.min(dmg, remaining);
  let score = effective;
  if (effective >= remaining) score += Math.min(15, Math.max(1, remaining * 0.25));
  score -= counter * 0.8;
  if (stance === 'aggressive') {
    if (calcIsolation(target, ctx.units, ctx.alliances)) score += 6;
    const ac = target.currentAc ?? target.baselineAc ?? 14;
    score += Math.max(0, (16 - ac) * 0.5);
    // Rear = no AGR, no retaliation and doubled threat pressure: high reward.
    if (isRear) score += Math.min(20, Math.max(4, computeThreatRating(attacker)));
    // Don't lock into a melee the target is expected to survive and answer.
    if (!isRanged && dist === 1 && effective < remaining && counter > 0) score -= 10;
  }
  // Front/flank attacks risk an AGR failure; rear/ranged do not. Keep the raw
  // damage for overkill/reservation, but discount the prioritisation score.
  score *= 0.65 + 0.35 * chance;
  return { dmg, score, counter };
}

/** Net expected exchange at adjacency under a candidate formation. */
function formationExchangeScore(
  u: Unit,
  formation: string,
  target: Unit,
  ctx: Pick<AiPlanContext, 'formations' | 'units' | 'alliances'>,
): number {
  const candidate = { ...u, currentFormation: formation };
  const dealt = expectedDamage(candidate, target, 1, false, ctx);
  const received = expectedRetaliation(target, candidate, 1, ctx);
  return dealt - received;
}

/** Expected incoming ranged damage against `unit` from every visible shooter. */
function incomingRangedDamage(
  unit: Unit,
  enemies: Unit[],
  ctx: Pick<AiPlanContext, 'formations' | 'units' | 'alliances'>,
): number {
  let total = 0;
  for (const e of enemies) {
    if (e.isDeleted || e.hidden || (e.currentUnitHp ?? 0) <= 0 || isProtectedHero(e)) continue;
    const w = activeWeaponOf(e);
    if (!w || w.isHealing) continue;
    const range = w.range ?? 1;
    const maxRange = Math.max(range, w.maxRange ?? range);
    if (!(range > 1 || maxRange > 1)) continue;
    const d = hexDistance(unit.hex, e.hex);
    if (d < (w.minRange ?? 0) || d > maxRange) continue;
    total += expectedDamage(e, unit, d, true, ctx);
  }
  return total;
}

/** Defensive ranged posture: close when safe/far, open/scattered under fire,
 *  scattered when melee is imminent. */
function formationRangedScore(
  u: Unit,
  formation: string,
  target: Unit,
  dist: number,
  enemies: Unit[],
  ctx: Pick<AiPlanContext, 'formations' | 'units' | 'alliances'>,
  stance: 'aggressive' | 'defensive',
): number {
  const candidate = { ...u, currentFormation: formation };
  const dealt = expectedDamage(candidate, target, dist, true, ctx);
  const incoming = incomingRangedDamage(candidate, enemies, ctx);
  const nearMelee = nearestEnemyDist(candidate.hex, enemies) <= 2;
  const cap = ctx.formations[formation]?.attack_capacity_multiplier ?? 1;
  const rangedVulnerability = ctx.formations[formation]?.be_attacked_range_modifier ?? 1;
  let score = dealt * 0.4 - incoming * 1.1;
  if (stance === 'defensive') {
    if (nearMelee) {
      score += formation === 'Scattered' ? 25 : formation === 'Open Order' ? 10 : -8;
    } else if (incoming > 0) {
      score += (1 - rangedVulnerability) * 30;
    } else {
      score += (cap - 1) * 20;
    }
  }
  return score;
}

/** Rough danger of ending on `dest`: extra adjacent enemies + shooters. */
function dangerAt(dest: Hex, foes: Unit[], doctrine: Doctrine): number {
  let adjacent = 0;
  let ranged = 0;
  for (const e of foes) {
    const d = hexDistance(dest, e.hex);
    if (d <= 1) {
      adjacent++;
      continue;
    }
    const w = activeWeaponOf(e);
    if (!w || w.isHealing) continue;
    const range = w.range ?? 1;
    const maxRange = Math.max(range, w.maxRange ?? range);
    if ((range > 1 || maxRange > 1) && d >= (w.minRange ?? 0) && d <= maxRange) ranged++;
  }
  if (doctrine === 'ranged') return adjacent * 12 + ranged * 5;
  // Melee: one adjacent enemy is the target; only a crowd is a problem.
  return Math.max(0, adjacent - 1) * 10 + ranged * 3;
}

/** Extra friendly units adjacent to `dest` (spacing penalty). */
function crowdingAt(dest: Hex, tuning: DestTuning): number {
  const group = allianceOf(tuning.mover, tuning.alliances);
  let friends = 0;
  for (const f of tuning.working) {
    if (f.id === tuning.mover.id) continue;
    if (f.isDeleted || f.hidden || (f.currentUnitHp ?? 0) <= 0) continue;
    if (allianceOf(f, tuning.alliances) !== group) continue;
    if (hexDistance(dest, f.hex) <= 1) friends++;
  }
  return Math.max(0, friends - 1);
}

interface DestTuning {
  advanced: boolean;
  working: Unit[];
  mover: Unit;
  alliances: Record<string, AllianceGroup>;
  assignedTarget: Unit | null;
  stance: 'aggressive' | 'defensive';
  /** Role-specific approach lane (flank/rear/frontage/reserve). */
  lane?: Hex | null;
  role?: AiBattleRole;
  /** Reaction-aware ranged hold scoring. */
  reactionEnabled?: boolean;
  formations?: Record<string, Formation>;
  structures?: MapStructures;
  structureTemplates?: Record<string, StructureTemplate>;
}

/** Loose (aggressive) / tight (defensive) line cohesion, scaled by AGR. */
function cohesionAt(dest: Hex, tuning: DestTuning): number {
  const mover = tuning.mover;
  const group = allianceOf(mover, tuning.alliances);
  let nearest = Infinity;
  for (const f of tuning.working) {
    if (f.id === mover.id || f.isDeleted || f.hidden || (f.currentUnitHp ?? 0) <= 0) continue;
    if (allianceOf(f, tuning.alliances) !== group) continue;
    const d = hexDistance(dest, f.hex);
    if (d < nearest) nearest = d;
  }
  if (!Number.isFinite(nearest)) return 0;
  const moved = { ...mover, hex: dest };
  const units = tuning.working.map(w => (w.id === mover.id ? moved : w));
  const isolated = calcIsolation(moved, units, tuning.alliances);
  let raw = nearest <= 2 ? 1 : nearest <= 3 ? -0.5 : -1;
  if (isolated) raw -= 1;
  const base = tuning.stance === 'defensive' ? 18 : 6;
  const agr = Math.max(1, Math.min(10, mover.aggressiveness ?? 5));
  const factor = 1 - 0.75 * (agr - 1) / 9;
  return raw * base * factor;
}

/** Bonus for acting on the line-assigned target/lane. */
const ASSIGNMENT_BONUS = 12;

/** The lane hex in front of the assigned target, on the mover's side. */
function assignedLaneHex(target: Unit, mover: Unit): Hex {
  const rowDir = target.hex.r > mover.hex.r ? -1 : target.hex.r < mover.hex.r ? 1 : 0;
  const r = target.hex.r + rowDir;
  return { q: target.hex.q, r, s: -target.hex.q - r };
}

function adjacentHexes(hex: Hex): Hex[] {
  return HEX_DIRS.map(d => ({ q: hex.q + d.q, r: hex.r + d.r, s: -hex.q - d.q - hex.r - d.r }));
}

/** Adjacent hexes on one side of the target, falling back to the nearest. */
function sideHexes(target: Unit, side: 'left' | 'right', arc: 'flank' | 'rear'): Hex[] {
  const pool = adjacentHexes(target.hex).filter(h => arcOfTarget(target.hex, target.facing, h) === arc);
  const preferred = pool.filter(h => side === 'left' ? h.q < target.hex.q : h.q > target.hex.q);
  return preferred.length > 0 ? preferred : pool;
}

/** Approach lane for a battle role. Structure/reserve keep their own lane. */
function roleLaneHex(
  role: AiBattleRole,
  target: Unit | null,
  mover: Unit,
  locked = true,
): Hex | null {
  if (!target) return null;
  if (role.kind === 'frontage') return assignedLaneHex(target, mover);
  if (role.kind === 'flank' || role.kind === 'rear') {
    const sides = sideHexes(target, role.side, role.kind === 'rear' ? 'rear' : 'flank');
    const final = sides.length > 0
      ? sides.sort((a, b) => hexDistance(mover.hex, a) - hexDistance(mover.hex, b))[0]
      : assignedLaneHex(target, mover);
    if (locked) return final;
    // Stage three rings outside the target until the frontage locks: the
    // flanker must stay farther back than the main body. Pick the ring-3 hex on
    // the correct side closest to the mover so it can keep MP for facing.
    const ring3 = new Map<string, Hex>();
    for (const a of adjacentHexes(target.hex)) {
      for (const b of adjacentHexes(a)) {
        for (const c of adjacentHexes(b)) {
          if (hexDistance(target.hex, c) !== 3) continue;
          if (role.side === 'left' ? c.q >= target.hex.q : c.q <= target.hex.q) continue;
          ring3.set(`${c.q},${c.r}`, c);
        }
      }
    }
    const candidates = Array.from(ring3.values());
    if (candidates.length > 0) {
      const ringRank = (h: Hex): number => {
        const arc = arcOfTarget(target.hex, target.facing, h);
        return arc === 'rear' ? 0 : arc === 'flank' ? 1 : 2;
      };
      candidates.sort((a, b) =>
        ringRank(a) - ringRank(b)
        || hexDistance(mover.hex, a) - hexDistance(mover.hex, b));
      return candidates[0];
    }
    const dq = final.q - target.hex.q;
    const dr = final.r - target.hex.r;
    return { q: target.hex.q + dq * 2, r: target.hex.r + dr * 2, s: -(target.hex.q + dq * 2) - (target.hex.r + dr * 2) };
  }
  if (role.kind === 'reserve') {
    const lane = assignedLaneHex(target, mover);
    const rowDir = target.hex.r > mover.hex.r ? -1 : target.hex.r < mover.hex.r ? 1 : 0;
    const r = lane.r + rowDir;
    return { q: lane.q, r, s: -lane.q - r };
  }
  return null;
}

/** Score weights for self-preservation (tuned against test 85's two cases). */
const EXPOSURE_REAR = 30;
const EXPOSURE_FLANK = 18;
const BYPASS_PER_ENEMY = 8;
const TURN_COST = 6;
/** Melee exposure is weighted more heavily: the point is to avoid a second
 *  adjacent enemy punishing the attack. */
const MELEE_EXPOSURE_WEIGHT = 5;
/** Any adjacent enemy is worth engaging; safety then decides how. */
const ADJACENT_ATTACK_BONUS = 20;
/** A turn that does not set up an attack/charge is expensive. */
const NO_ATTACK_TURN_COST = 10;
/** Advanced formation changes need this much net-damage improvement. */
const FORMATION_MARGIN = 8;
/** Opportunity cost of the formation change, per MP spent. */
const FORMATION_COST_WEIGHT = 2;

/** Adjacent enemies (excluding `excludeId`) in the unit's flank or rear arc. */
function adjacentExposedEnemies(unit: Unit, foes: Unit[], excludeId?: string): Unit[] {
  return foes.filter(e =>
    e.id !== excludeId
    && !isUnitRouted(e)
    && hexDistance(unit.hex, e.hex) <= 1
    && arcOfTarget(unit.hex, unit.facing, e.hex) !== 'front');
}

/** Penalty for ending with a live enemy in the mover's flank/rear arc. The
 *  intended melee target is excluded (standing in its flank to strike it is the
 *  point); OTHER enemies in those arcs are the danger. */
export function ownExposureAt(dest: Hex, facing: number, foes: Unit[], excludeId?: string, weight = 1): number {
  let penalty = 0;
  for (const e of foes) {
    if (e.id === excludeId) continue;
    if (isUnitRouted(e)) continue;
    const d = hexDistance(dest, e.hex);
    if (d > 2) continue; // immediate threats only
    const w = activeWeaponOf(e);
    const range = w?.range ?? 1;
    const maxRange = Math.max(range, w?.maxRange ?? range);
    const canThreaten = d === 1
      || (!!w && !w.isHealing && (range > 1 || maxRange > 1) && d >= (w.minRange ?? 0) && d <= maxRange);
    if (!canThreaten) continue;
    const arc = arcOfTarget(dest, facing, e.hex);
    if (arc === 'rear') penalty += EXPOSURE_REAR * weight;
    else if (arc === 'flank') penalty += EXPOSURE_FLANK * weight;
  }
  return penalty;
}

/** Penalty for walking past (adjacent to) a non-target enemy en route. */
export function pathBypassPenalty(path: Hex[], foes: Unit[], dest: Hex): number {
  if (path.length < 3) return 0; // no intermediate step
  const nearTarget = new Set<string>();
  for (const e of foes) {
    if (!isUnitRouted(e) && hexDistance(dest, e.hex) === 1) nearTarget.add(e.id);
  }
  const passed = new Set<string>();
  for (let i = 1; i < path.length - 1; i++) {
    for (const e of foes) {
      if (isUnitRouted(e) || nearTarget.has(e.id)) continue;
      if (hexDistance(path[i], e.hex) === 1) passed.add(e.id);
    }
  }
  return passed.size * BYPASS_PER_ENEMY;
}

/**
 * Penalty for turning the unit's flank/rear toward a distant enemy line.
 * Immediate threats (within 2) are handled by `ownExposureAt`; this keeps the
 * front toward the nearest non-target enemy even when it is still several hexes
 * away, so an advance stays coherent.
 */
export function lineBearingPenalty(dest: Hex, facing: number, foes: Unit[], excludeId?: string, weight = 1): number {
  let nearest: Unit | null = null;
  let best = Infinity;
  for (const e of foes) {
    if (e.id === excludeId) continue;
    if (isUnitRouted(e)) continue;
    const d = hexDistance(dest, e.hex);
    if (d <= 2 || d >= best) continue;
    best = d;
    nearest = e;
  }
  if (!nearest) return 0;
  const arc = arcOfTarget(dest, facing, nearest.hex);
  if (arc === 'rear') return 24 * weight;
  if (arc === 'flank') return 14 * weight;
  return 0;
}


/** Ranged target "biggest threat" tier: within-2 > Phalanx > Close Order > rest. */
function threatTier(target: Unit, dist: number): number {
  if (dist <= 2) return 3;
  if (target.currentFormation === 'Phalanx') return 2;
  if (target.currentFormation === 'Close Order') return 1;
  return 0;
}

/** Our position arc relative to the target's facing (rear is best for us). */
function attackArcRank(from: Hex, target: Unit): number {
  const arc = determineCombatPosition(from, target.hex, target.facing);
  return arc === 'rear' ? 3 : arc === 'flank' ? 2 : 1;
}

type Doctrine = 'melee' | 'ranged';

function unitDoctrine(u: Unit): Doctrine {
  const weapons = parseWeapons(u.weaponString || '');
  if (weapons.length === 0) return 'melee'; // fists
  const hasMelee = weapons.some(w => isMeleeWeapon(w));
  if (hasMelee) return 'melee';
  const hasRanged = weapons.some(w => (w.range ?? 1) > 1 || (w.maxRange ?? (w.range ?? 1)) > 1);
  return hasRanged ? 'ranged' : 'melee';
}

function isLoose(u: Unit, forms: Record<string, Formation>): boolean {
  return isLooseUnit(u, forms[u.currentFormation]);
}

function freeTurn(u: Unit, forms: Record<string, Formation>): boolean {
  return isLoose(u, forms);
}

/** Can the unit pay `cost` MP right now (mirrors applyMpSpend logic). */
function canPayMp(u: Unit, cost: number): boolean {
  return (u.movementPointsAvailable ?? 0) >= cost || (u.actionsAvailable ?? 0) >= 1;
}

function effMax(u: Unit, formations: Record<string, Formation>): number {
  const mult = formations[u.currentFormation]?.movement_multiplier ?? 1;
  return Math.max(1, Math.floor((u.movementPoints ?? 0) * mult));
}

/** Defensive advance: a cluster may not outrun its slowest member. */
function clusterSpeedCap(
  u: Unit,
  initialUnits: Unit[],
  ctx: AiPlanContext,
  stance: 'aggressive' | 'defensive',
  advanced: boolean,
): number {
  if (!advanced || stance !== 'defensive') return Infinity;
  const group = allianceOf(u, ctx.alliances);
  const self = initialUnits.find(f => f.id === u.id) ?? u;
  let cap = effMax(u, ctx.formations);
  for (const f of initialUnits) {
    if (f.id === u.id || f.isDeleted || f.hidden || (f.currentUnitHp ?? 0) <= 0) continue;
    if (allianceOf(f, ctx.alliances) !== group) continue;
    if (hexDistance(self.hex, f.hex) > 2) continue;
    cap = Math.min(cap, effMax(f, ctx.formations));
  }
  return cap;
}

interface PlannedMoveOption {
  to: Hex;
  path: Hex[];
  cost: number;
  score: number;
  canAttack: boolean;
  attackScore: number;
}

function bestAdjacentTarget(dest: Hex, foes: Unit[]): { rank: number; target: Unit | null } {
  let best: { rank: number; target: Unit | null } = { rank: 0, target: null };
  for (const e of foes) {
    if (hexDistance(dest, e.hex) === 1) {
      const rank = attackArcRank(dest, e);
      if (rank > best.rank) best = { rank, target: e };
    }
  }
  return best;
}

/** Destination scorer for melee: prefer adjacency on the enemy's rear/flank,
 *  then closeness. Exposure to flank/rear threats and Advanced crowding/zone
 *  danger are penalties. */
function meleeDestScore(
  dest: Hex,
  foes: Unit[],
  threat: Set<string>,
  facing: number,
  canAttackAfterMove: boolean,
  tuning: DestTuning,
): number {
  const adj = bestAdjacentTarget(dest, foes);
  const targetId = canAttackAfterMove ? adj.target?.id : undefined;
  const near = nearestEnemyDist(dest, foes);
  const threatPenalty = threat.has(hexKeyOf(dest)) ? 8 : 0;
  const safety = tuning.stance === 'defensive' ? 1.6 : 1;
  const assignedBonus = tuning.assignedTarget && adj.target?.id === tuning.assignedTarget.id
    ? ASSIGNMENT_BONUS
    : 0;
  const lane = tuning.lane ?? (tuning.assignedTarget ? assignedLaneHex(tuning.assignedTarget, tuning.mover) : null);
  const laneBonus = lane
    ? Math.max(0, 28 - hexDistance(dest, lane) * 6) - Math.abs(dest.q - lane.q) * 2
    : 0;
  let score = adj.rank * 30 + (adj.rank > 0 ? ADJACENT_ATTACK_BONUS : 0) + (8 - Math.min(8, near)) - threatPenalty
    - ownExposureAt(dest, facing, foes, targetId, MELEE_EXPOSURE_WEIGHT * safety)
    - lineBearingPenalty(dest, facing, foes, targetId, 1.5 * safety)
    + cohesionAt(dest, tuning)
    + assignedBonus
    + laneBonus;
  if (tuning.advanced) {
    score -= dangerAt(dest, foes, 'melee') * 0.6;
    score -= crowdingAt(dest, tuning) * 3;
  }
  return score;
}

/** Destination scorer for stand-off ranged: stay ≥ gap from enemies and within
 *  the active weapon's reach of the fight; otherwise advance toward it. */
function reactionCoverageAt(
  unit: Unit,
  dest: Hex,
  facing: number,
  foes: Unit[],
  tuning: DestTuning,
): number {
  const weapon = activeWeaponOf(unit);
  const range = weapon?.range ?? 1;
  if (!weapon || range <= 1 || weapon.isHealing) return 0;
  const form = tuning.working.find(w => w.id === unit.id)?.currentFormation ?? unit.currentFormation;
  const formDef = tuning.formations?.[form];
  let covered = 0;
  for (const e of foes) {
    if (e.isDeleted || e.hidden || (e.currentUnitHp ?? 0) <= 0 || isProtectedHero(e)) continue;
    const d = hexDistance(dest, e.hex);
    if (d > range || d < (weapon.minRange ?? 0)) continue;
    if (formDef && !arcsContain(formDef.ranged_target_arcs, arcOfTarget(dest, facing, e.hex))) continue;
    const los = hasLineOfSight(
      dest,
      e.hex,
      tuning.working,
      new Set([unit.id, e.id]),
      tuning.structures,
      tuning.structureTemplates,
      { fromElevation: unit.elevation ?? 0, toElevation: e.elevation ?? 0 },
    );
    if (los) covered++;
  }
  return covered;
}

function rangedDestScore(
  dest: Hex,
  foes: Unit[],
  threat: Set<string>,
  weaponRange: number,
  weaponMaxRange: number,
  facing: number,
  _canAttackAfterMove: boolean,
  tuning: DestTuning,
): number {
  const near = nearestEnemyDist(dest, foes);
  const safety = tuning.stance === 'defensive' ? 1.6 : 1;
  const threatPenalty = threat.has(hexKeyOf(dest)) ? (tuning.stance === 'defensive' ? 16 : 8) : 0;
  const gap = 2;
  let score: number;
  if (near >= weaponMaxRange && weaponMaxRange >= 1) {
    // Everything is out of reach — advance.
    score = 30 - near - threatPenalty;
  } else if (near < gap) {
    score = -((gap - near) * 12) - threatPenalty; // too close: prefer to back off
  } else {
    // Comfortable band [gap .. maxRange]; prefer being a bit further back.
    score = Math.max(0, 10 - near) - threatPenalty;
  }
  // Ranged units never voluntarily enter melee contact; treat it as a hard
  // avoidance, not just a soft stand-off preference.
  if (near <= 1) score -= 120;
  if (tuning.reactionEnabled) {
    score += reactionCoverageAt(tuning.mover, dest, facing, foes, tuning) * 6;
  }
  score -= ownExposureAt(dest, facing, foes, undefined, safety);
  score -= lineBearingPenalty(dest, facing, foes, undefined, 1 * safety);
  score += cohesionAt(dest, tuning);
  if (tuning.assignedTarget && hexDistance(dest, tuning.assignedTarget.hex) <= weaponMaxRange) {
    score += ASSIGNMENT_BONUS;
  }
  if (tuning.advanced) {
    score -= dangerAt(dest, foes, 'ranged') * 0.7;
    score -= crowdingAt(dest, tuning) * 2;
  }
  return score;
}

interface Maneuver {
  turns: { dir: 'left' | 'right' }[];
  move: PlannedMoveOption;
  postTurnUnit: Unit;
  score: number;
  /** True when an attack/charge is available after this maneuver. */
  leadsToAttack: boolean;
}

interface MoverContext {
  occupied: Set<string>;
  threat: Set<string>;
  passThrough: Set<string>;
  org: OrgMoveOpts;
  costOfHex?: CostOfHexFn;
  blockedEdge?: BlockedEdgeFn;
}

/** Per-unit movement facts mirroring the human drag pipelines: dynamic ground,
 *  mount/climb gates, walls/structures, org breaks, door/loose pass-through, and
 *  fog-safe occupancy (hidden units are invisible to the AI). */
function movementContextFor(u: Unit, working: Unit[], ctx: AiPlanContext): MoverContext {
  const structures = ctx.structures;
  const templates = ctx.structureTemplates;
  const zones = ctx.groundZones;
  const mounted = !!u.mountId || !!u.mountName;
  const waiveClimb = unitIgnoresClimb(u, zones);
  const originSurface = unitStandingSurface(u, structures, templates);
  const visible = working.filter(w => !w.hidden);
  const occupied = computeOccupiedHexes(visible, u.id, originSurface);
  const threat = computeThreatHexes(visible, u.id, ctx.alliances, ctx.formations, structures, templates);
  const passThrough = new Set<string>(Array.from(doorPassThroughHexes(structures, templates, occupied)));
  for (const k of Array.from(loosePassThroughHexes(visible, u, ctx.formations, ctx.alliances, 'ground', originSurface))) {
    passThrough.add(k);
  }
  const movementMultipliers: Record<string, number> = {};
  for (const [name, f] of Object.entries(ctx.formations)) movementMultipliers[name] = f.movement_multiplier;
  const needsCost = !!ctx.terrainCosts || !!ctx.walls || (!!structures && Object.keys(structures).length > 0);
  const costOfHex = needsCost
    ? makeCostOfHex(ctx.terrainCosts ?? null, ctx.walls, { structures, templates, isMounted: mounted, waiveClimb })
    : undefined;
  const blockedEdge = makeBlockedEdge(ctx.walls, {
    structures,
    templates,
    zones,
    isMounted: mounted,
    waiveClimb,
  });
  const org: OrgMoveOpts = {
    movementMultipliers,
    orgLevels: formationOrgLevels(ctx.formations),
    breakOnEntry: (fq, fr, tq, tr, formation) =>
      entryBreakFormation({ q: fq, r: fr }, { q: tq, r: tr }, formation, structures, templates, zones),
  };
  return { occupied, threat, passThrough, org, costOfHex, blockedEdge };
}

/** Enumerate approaches: up to `maxTurns` 60° turns (each simulated with real
 *  MP accounting) followed by one straight leg, scored by `scorer`. A turn that
 *  does not lead to an attack/charge pays `NO_ATTACK_TURN_COST` extra. */
function maneuverOptions(
  u: Unit,
  enemies: Unit[],
  ctx: Pick<AiPlanContext, 'alliances' | 'formations' | 'visibleHexes' | 'reactiveArchery'>,
  movement: MoverContext,
  maxTurns: number,
  attackCap: number,
  scorer: (dest: Hex, foes: Unit[], threat: Set<string>, facing: number, canAttack: boolean) => number,
  speedCap = Infinity,
): Maneuver[] {
  const foes = enemies.filter(e => !e.isDeleted && !e.hidden && (e.currentUnitHp ?? 0) > 0);
  const out: Maneuver[] = [];
  const occ = movement.occupied;
  const threat = movement.threat;
  const canAttackNow = (unit: Unit): boolean =>
    (unit.actionsAvailable ?? 0) >= 1 && (unit.attacksUsed ?? 0) < attackCap;

  const evaluate = (turns: { dir: 'left' | 'right' }[], unitAfter: Unit) => {
    const max = effMax(unitAfter, ctx.formations);
    const pool = Math.min(computeMovePool(unitAfter, max), speedCap);
    // Holding position is always an option (including with 0 MP/actions). This
    // is what lets a unit spend leftover MP only when the destination is better
    // than staying put.
    const stayLeads = canAttackNow(unitAfter)
      && legalTargets(unitAfter, foes, { alliances: ctx.alliances, formations: ctx.formations, visibleHexes: ctx.visibleHexes }).length > 0;
    const isFreeTurn = freeTurn(unitAfter, ctx.formations);
    const turnPenalty = isFreeTurn ? 0 : TURN_COST;
    const stayScore = scorer(unitAfter.hex, foes, threat, unitAfter.facing, stayLeads)
      - turns.length * (turnPenalty + (isFreeTurn || stayLeads ? 0 : NO_ATTACK_TURN_COST));
    out.push({
      turns: [...turns],
      move: { to: unitAfter.hex, path: [], cost: 0, score: stayScore, canAttack: false, attackScore: 0 },
      postTurnUnit: unitAfter,
      score: stayScore,
      leadsToAttack: stayLeads,
    });
    if (pool < 1) return;
    const reach = computeReachableMap(
      unitAfter, pool, occ, threat, movement.costOfHex, false, movement.blockedEdge,
      undefined, movement.passThrough, movement.org, !!ctx.reactiveArchery,
    );
    reach.forEach((entry, key) => {
      if (entry.needsTurn) return;
      const dest = entry.path[entry.path.length - 1];
      if (!dest) return;
      // Use the real post-move action accounting: a move can consume leftover
      // MP and still leave the action needed for an attack.
      const applied = applyMoveCost(unitAfter, entry.cost, Math.min(max, speedCap));
      const post = {
        ...unitAfter,
        hex: dest,
        movementPointsAvailable: applied.movementPointsAvailable,
        actionsAvailable: applied.actionsAvailable,
      };
      const leadsToAttack = canAttackNow(post)
        && legalTargets(post, foes, { alliances: ctx.alliances, formations: ctx.formations, visibleHexes: ctx.visibleHexes }).length > 0;
      const isFreeTurn = freeTurn(unitAfter, ctx.formations);
      const turnPenalty = isFreeTurn ? 0 : TURN_COST;
      const score = scorer(dest, foes, threat, unitAfter.facing, leadsToAttack)
        - pathBypassPenalty(entry.path, foes, dest)
        - turns.length * (turnPenalty + (isFreeTurn || leadsToAttack ? 0 : NO_ATTACK_TURN_COST));
      out.push({ turns: [...turns], move: { to: dest, path: entry.path, cost: entry.cost, score, canAttack: false, attackScore: 0 }, postTurnUnit: unitAfter, score, leadsToAttack });
    });
  };

  // Recursively try 0..maxTurns rotations (left/right branches), stopping when
  // the unit can no longer pay for another turn.
  const recurse = (turns: { dir: 'left' | 'right' }[], unitState: Unit) => {
    evaluate(turns, unitState);
    if (turns.length >= maxTurns) return;
    if (!freeTurn(unitState, ctx.formations) && !canPayMp(unitState, 1)) return;
    for (const dir of ['left', 'right'] as const) {
      let next = unitState;
      const nf = dir === 'left' ? rotateLeft(unitState.facing) : rotateRight(unitState.facing);
      if (freeTurn(unitState, ctx.formations)) {
        next = { ...unitState, facing: nf };
      } else {
        const { movementPointsAvailable, actionsAvailable } = applyMpSpend(unitState, 1, effMax(unitState, ctx.formations));
        next = { ...unitState, facing: nf, movementPointsAvailable, actionsAvailable };
        if (actionsAvailable < 0) continue;
      }
      recurse([...turns, { dir }], next);
    }
  };
  recurse([], u);
  out.sort((a, b) =>
    b.score - a.score
    || hexTieHash(a.move.to) - hexTieHash(b.move.to)
    || a.move.to.q - b.move.to.q
    || a.move.to.r - b.move.to.r);
  return out;
}

/** Best retreat step for a ROUTED unit: the reachable hex farthest from the
 *  nearest hostile, bounded by the map rim. Returns null when nothing is
 *  strictly safer / legal. */
function chooseFleeHex(
  u: Unit,
  enemies: Unit[],
  ctx: Pick<AiPlanContext, 'alliances' | 'formations' | 'visibleHexes' | 'reactiveArchery'>,
  movement: MoverContext,
  gridRadius: number | undefined,
): { pick: PlannedMoveOption; updated: Unit; path: Hex[] } | null {
  const foes = enemies.filter(e => !e.isDeleted && !e.hidden && (e.currentUnitHp ?? 0) > 0);
  if (foes.length === 0) return null;
  const ring = (h: { q: number; r: number }) => Math.max(Math.abs(h.q), Math.abs(h.r), Math.abs(h.q + h.r));
  if (gridRadius !== undefined && ring(u.hex) >= gridRadius) return null; // at/over the rim: stay
  const pool = computeMovePool(u, effMax(u, ctx.formations));
  if (pool < 1) return null;
  const reach = computeReachableMap(
    u, pool, movement.occupied, movement.threat, movement.costOfHex, false, movement.blockedEdge,
    undefined, movement.passThrough, movement.org, !!ctx.reactiveArchery,
  );
  const startDist = nearestEnemyDist(u.hex, foes);
  const distanceSum = (hex: Hex) => foes.reduce((n, e) => n + hexDistance(hex, e.hex), 0);
  const startMass = distanceSum(u.hex);
  const candidates: PlannedMoveOption[] = [];
  reach.forEach((entry, key) => {
    if (entry.needsTurn) return;
    const dest = entry.path[entry.path.length - 1];
    if (!dest) return;
    if (gridRadius !== undefined && ring(dest) > gridRadius) return; // never flee off the board
    const d = nearestEnemyDist(dest, foes);
    const mass = distanceSum(dest);
    // Furthest from the enemy MASS beats a slightly better nearest-hostile
    // distance. Only require that the move does not get closer overall.
    if (mass < startMass) return;
    if (mass === startMass && d <= startDist) return;
    const threatPenalty = movement.threat.has(key) ? 4 : 0;
    const score = mass * 10 + d * 2 - threatPenalty - entry.cost;
    candidates.push({ to: dest, path: entry.path, cost: entry.cost, score, canAttack: false, attackScore: 0 });
  });
  if (candidates.length === 0) return null;
  let best = candidates[0];
  for (const c of candidates) if (c.score > best.score) best = c;
  const applied = applyMoveCost(u, best.cost, effMax(u, ctx.formations));
  return { pick: best, path: best.path, updated: { ...u, hex: best.to, movementPointsAvailable: applied.movementPointsAvailable, actionsAvailable: applied.actionsAvailable } };
}

/**
 * Build the plot for the current turn's AI units. Mutates nothing — works on
 * copies so later callers (and tests) see the same snapshot.
 */
export function planAiMoves(ctx: AiPlanContext): AiUnitPlan[] {
  if (!ctx.activeAlliance || ctx.teams.length === 0) return [];
  const units = ctx.units.filter(u => !u.isDeleted);
  const hostedBy = new Set<string>();
  for (const u of units) if (u.attachedToUnitId) hostedBy.add(u.attachedToUnitId);

  const controllable = units.filter(u => {
    if (ctx.excludeUnitIds && ctx.excludeUnitIds.includes(u.id)) return false;
    return isAiControllable(u, ctx, hostedBy);
  });
  if (controllable.length === 0) return [];

  const working = units.map(u => ({ ...u }));
  const initialUnits = units.map(u => ({ ...u }));
  const byId = new Map(working.map(u => [u.id, u]));
  const group = ctx.activeAlliance;
  const enemies = working.filter(u =>
    !u.isDeleted && !u.hidden && (u.currentUnitHp ?? 0) > 0 && enemyGroupsOf(group).has(allianceOf(u, ctx.alliances)));

  const maxTurns = ctx.maxTurns ?? 3;
  const cap = unitAttackCap();
  const advanced = !!ctx.advanced;
  const stance = ctx.stance ?? 'aggressive';
  // Battle roles: a shifted frontage window plus surplus flank/rear/reserve
  // units. Structure defenders and ranged-only support are excluded from the
  // frontage/flank pool.
  const battle = assignBattleRoles(controllable, enemies, ctx, advanced);
  const foesById = new Map(enemies.map(e => [e.id, e]));
  const targetIdOf = (id: string): string | null => {
    const role = battle.roles.get(id);
    return role && 'targetId' in role ? role.targetId : null;
  };
  const rolePriority = (id: string): number => {
    const role = battle.roles.get(id);
    if (!role) return 9;
    if (role.kind === 'structure') return 0;
    if (role.kind === 'ranged') return 1;
    if (role.kind === 'frontage') return 2;
    if (role.kind === 'flank' || role.kind === 'rear') return 3;
    return 4; // reserve
  };
  const laneQOf = (unit: Unit) => {
    const tid = targetIdOf(unit.id);
    return tid ? foesById.get(tid)?.hex.q ?? unit.hex.q : unit.hex.q;
  };
  const speedOf = (unit: Unit) => effMax(unit, ctx.formations);
  const planned = [...controllable].sort((a, b) =>
    rolePriority(a.id) - rolePriority(b.id)
    || laneQOf(a) - laneQOf(b)
    || (advanced && stance === 'defensive' ? speedOf(a) - speedOf(b) : 0)
    || a.hex.q - b.hex.q
    || a.id.localeCompare(b.id));
  // Advanced: damage already assigned to a target this plot, so later units see
  // the overkill waste instead of piling onto a nearly-dead squad.
  const reserved = new Map<string, number>();

  const commit = (u: Unit, updated: Unit, id: string) => {
    byId.set(id, updated);
    const idx = working.findIndex(w => w.id === id);
    if (idx >= 0) working[idx] = updated;
  };

  /** Rotate `unit` toward `toward`, spending free turns or MP/actions, and log
   *  the turns on `unitPlan`. Stops early if the next turn is unaffordable. */
  const turnTowardHex = (
    unit: Unit,
    toward: Hex,
    unitPlan: AiUnitPlan,
  ): { unit: Unit; turned: boolean } => {
    let u = unit;
    const desired = facingToward(u.hex, toward);
    let diff = (desired - u.facing + 6) % 6;
    if (diff > 3) diff -= 6;
    const dir: 'left' | 'right' = diff > 0 ? 'right' : 'left';
    let turned = false;
    for (let i = 0; i < Math.abs(diff); i++) {
      if (!freeTurn(u, ctx.formations) && !canPayMp(u, 1)) break;
      const from = u.hex;
      if (freeTurn(u, ctx.formations)) {
        u = { ...u, facing: dir === 'left' ? rotateLeft(u.facing) : rotateRight(u.facing) };
      } else {
        const { movementPointsAvailable, actionsAvailable } = applyMpSpend(u, 1, effMax(u, ctx.formations));
        u = {
          ...u,
          facing: dir === 'left' ? rotateLeft(u.facing) : rotateRight(u.facing),
          movementPointsAvailable,
          actionsAvailable,
        };
      }
      commit(u, u, u.id);
      unitPlan.steps.push({ kind: 'turn', unitId: u.id, from, dir });
      turned = true;
    }
    return { unit: u, turned };
  };

  /** A target is melee-locked when any friendly is already adjacent. Structure
   *  defenders can provide that lock too. */
  const targetIsLocked = (targetId: string | null): boolean => {
    if (!targetId) return false;
    const target = working.find(e => e.id === targetId);
    if (!target) return false;
    for (const f of working) {
      if (f.id === target.id || f.isDeleted || f.hidden || (f.currentUnitHp ?? 0) <= 0) continue;
      if (allianceOf(f, ctx.alliances) !== ctx.activeAlliance) continue;
      if (hexDistance(f.hex, target.hex) <= 1) return true;
    }
    return false;
  };

  /** Lock used for flanker staging: only frontage/structure units count. The
   *  flanker itself ending adjacent must not make it think the frontage engaged. */
  const targetLockedByFrontageIn = (units: Unit[], targetId: string | null): boolean => {
    if (!targetId) return false;
    const target = units.find(e => e.id === targetId);
    if (!target) return false;
    for (const f of units) {
      if (f.id === target.id || f.isDeleted || f.hidden || (f.currentUnitHp ?? 0) <= 0) continue;
      if (isUnitRouted(f)) continue;
      if (allianceOf(f, ctx.alliances) !== ctx.activeAlliance) continue;
      const roleOfF = battle.roles.get(f.id);
      if (!battle.frontageIds.has(f.id) && roleOfF?.kind !== 'structure') continue;
      if (hexDistance(f.hex, target.hex) <= 1) return true;
    }
    return false;
  };
  const targetLockedByFrontage = (targetId: string | null): boolean =>
    targetLockedByFrontageIn(working, targetId);
  /** Only a frontage lock that existed at the start of the plan counts for
   *  flanker engagement; a same-plan advance must not pull flankers forward. */
  const targetLockedByFrontageInitial = (targetId: string | null): boolean =>
    targetLockedByFrontageIn(initialUnits, targetId);

  const initialHexes = new Map(initialUnits.map(w => [w.id, w.hex]));
  const placementCache = new Map<string, ReservePlacement>();
  const claimedThreats = new Map<string, string>();
  const claimedGaps = new Map<string, string>();

  const currentLineUnits = (): Unit[] => working.filter(w =>
    battle.frontageIds.has(w.id)
    && !w.isDeleted && !w.hidden && (w.currentUnitHp ?? 0) > 0
    && !isUnitRouted(w));
  const currentLine = (foes: Unit[]): BattleLine | null => computeBattleLine(currentLineUnits(), foes);

  const placementFor = (u: Unit, line: BattleLine): ReservePlacement | null => {
    let placement = placementCache.get(u.id) ?? null;
    if (!placement) {
      const reserves = working.filter(w =>
        battle.roles.get(w.id)?.kind === 'reserve'
        && !w.isDeleted && !w.hidden && (w.currentUnitHp ?? 0) > 0
        && !isUnitRouted(w));
      const reachOf = (x: Unit) => Math.max(3, Math.floor(computeMoveBudget(x, effMax(x, ctx.formations))));
      const placements = assignReservePlacements(reserves, line, reachOf);
      placements.forEach((value, id) => placementCache.set(id, value));
      placement = placementCache.get(u.id) ?? null;
    }
    return placement;
  };

  const visibleToAi = (e: Unit): boolean => !ctx.visibleHexes || ctx.visibleHexes.has(hexKeyOf(e.hex));

  const pickReserveThreat = (
    u: Unit,
    line: BattleLine,
    placement: ReservePlacement,
    foes: Unit[],
    current: Unit | null,
  ): { target: Unit; score: number } | null => {
    const radius = Math.max(3, line.length);
    let best: { target: Unit; score: number } | null = null;
    for (const e of foes) {
      if (!battle.frontFoeIds.has(e.id) && !battle.unpairedFoeIds.has(e.id)) continue;
      if (!visibleToAi(e)) continue;
      const dLine = Math.min(...line.units.map(l => hexDistance(e.hex, l.hex)));
      if (dLine > radius) continue;
      const proj = projectPoint(e.hex, line);
      if (sectorOfProjection(proj.t, line, placement.groupCount) !== placement.group) continue;
      const rear = proj.du < 0;
      const flanking = isFlankOrRearThreat(e, line);
      if (!flanking) continue;
      const paired = battle.frontFoeIds.has(e.id);
      const adjacentToLine = line.units.some(l => hexDistance(e.hex, l.hex) <= 1);
      // A paired front-arc enemy already in contact is the frontage's job.
      if (paired && !rear && adjacentToLine) continue;
      const owner = claimedThreats.get(e.id);
      if (owner && owner !== u.id) continue;
      const kind = rear ? 120 : 80;
      let score = kind + (radius - dLine) * 6 - hexDistance(u.hex, e.hex) * 2;
      if (current?.id === e.id) score += 40;
      if (!best || score > best.score) best = { target: e, score };
    }
    return best;
  };

  const pickReserveGap = (
    u: Unit,
    line: BattleLine,
    placement: ReservePlacement,
  ): { gapKey: string; hex: Hex; score: number } | null => {
    const occupied = new Set(working
      .filter(w => !w.isDeleted && !w.hidden)
      .map(w => hexKeyOf(w.hex)));
    const gaps = findLineGaps(line, battle.frontageIds, initialHexes, occupied);
    let best: { gapKey: string; hex: Hex; score: number } | null = null;
    for (const gap of gaps) {
      if (gap.hexes.length === 0) continue;
      if (sectorOfProjection(projectPoint(gap.center, line).t, line, placement.groupCount) !== placement.group) continue;
      const owner = claimedGaps.get(gap.key);
      if (owner && owner !== u.id) continue;
      const hex = gap.hexes
        .slice()
        .sort((a, b) =>
          hexDistance(u.hex, a) - hexDistance(u.hex, b)
          || hexTieHash(a) - hexTieHash(b))[0];
      const score = gap.width * 20 - hexDistance(u.hex, hex) * 3;
      if (!best || score > best.score) best = { gapKey: gap.key, hex, score };
    }
    return best;
  };

  const plans: AiUnitPlan[] = [];
  for (const seed of planned) {
    const plan: AiUnitPlan = { unitId: seed.id, steps: [] };
    let u = byId.get(seed.id)!;
    let formationUpgrades = 0;
    let hasAttacked = false;
    let defensiveFaced = false;
    const role = battle.roles.get(u.id) ?? null;
    // One step per hex the unit could spend across its remaining actions (plus
    // turns/attacks): a 6-MP mounted unit gets 12, heavy infantry 2 MP gets 4.
    const initialBudget = computeMoveBudget(u, effMax(u, ctx.formations));
    const maxStepsForUnit = Math.max(ctx.maxStepsPerUnit ?? 5, Math.ceil(initialBudget));
    let assignedTargetId = targetIdOf(u.id);
    let assignedTarget = assignedTargetId ? enemies.find(e => e.id === assignedTargetId) ?? null : null;
    let interceptTarget: Unit | null = null;
    let patchHex: Hex | null = null;
    let gapKey: string | null = null;
    let reserveFaced = false;
    for (let s = 0; s < maxStepsForUnit; s++) {
      if ((u.actionsAvailable ?? 0) < 1 && (u.movementPointsAvailable ?? 0) < 1) break;
      if ((u.attacksUsed ?? 0) >= cap) break;
      const from = u.hex;
      const movement = movementContextFor(u, working, ctx);
      const canAct = (u.actionsAvailable ?? 0) >= 1;

      // Routed units can't fight — run as far from hostiles as possible, but
      // stop at the map's outer rim so the DM can hide the broken unit.
      if (isUnitRouted(u)) {
        const flee = chooseFleeHex(u, enemies, ctx, movement, ctx.gridRadius);
        if (!flee) break;
        commit(u, flee.updated, u.id);
        u = flee.updated;
        plan.steps.push({ kind: 'move', unitId: u.id, from, to: flee.pick.to, path: flee.path, cost: flee.pick.cost });
        continue;
      }

      const doctrine = unitDoctrine(u);
      const enemiesAlive = enemies.filter(e => !e.isDeleted && !e.hidden && (e.currentUnitHp ?? 0) > 0);

      // Defensive reserve: cover the whole battle line. Real flank/rear
      // threats come first, then surplus front-line pairings (only when the
      // hostile forward band outnumbers us by more than one), then holes.
      if (role?.kind === 'reserve' && stance === 'defensive' && !hasAttacked) {
        const line = currentLine(enemiesAlive);
        const placement = line ? placementFor(u, line) : null;
        if (line && placement) {
          const threat = pickReserveThreat(u, line, placement, enemiesAlive, interceptTarget);
          const gap = threat ? null : pickReserveGap(u, line, placement);
          if (threat) {
            if (gapKey) {
              claimedGaps.delete(gapKey);
              gapKey = null;
            }
            patchHex = null;
            if (interceptTarget?.id !== threat.target.id) {
              if (interceptTarget) claimedThreats.delete(interceptTarget.id);
              interceptTarget = threat.target;
              assignedTargetId = threat.target.id;
              assignedTarget = threat.target;
              reserveFaced = false;
            }
            claimedThreats.set(threat.target.id, u.id);
          } else if (gap) {
            if (interceptTarget) claimedThreats.delete(interceptTarget.id);
            interceptTarget = null;
            if (gapKey && gapKey !== gap.gapKey) claimedGaps.delete(gapKey);
            gapKey = gap.gapKey;
            claimedGaps.set(gap.gapKey, u.id);
            patchHex = gap.hex;
          } else {
            if (interceptTarget) claimedThreats.delete(interceptTarget.id);
            if (gapKey) claimedGaps.delete(gapKey);
            interceptTarget = null;
            patchHex = null;
            gapKey = null;
          }
          if (interceptTarget && !reserveFaced) {
            reserveFaced = true;
            const faced = turnTowardHex(u, interceptTarget.hex, plan);
            u = faced.unit;
            if (faced.turned) continue;
          }
        }
      }

      const reserveHolding = role?.kind === 'reserve' && stance === 'defensive'
        && !interceptTarget && !patchHex
        && nearestEnemyDist(u.hex, enemiesAlive) > 1;
      const flankRoleEarly = role?.kind === 'flank' || role?.kind === 'rear';

      // A flanker does not wait in a queue behind one assigned target, but it
      // also does not engage before the main body. It retargets to the closest
      // enemy locked by a frontage/structure unit; with none engaged it circles
      // the closest enemy at a safe distance.
      if (flankRoleEarly) {
        const engaged = enemiesAlive.filter(e => targetLockedByFrontageInitial(e.id));
        const pool = engaged.length > 0 ? engaged : enemiesAlive;
        const closest = pool
          .slice()
          .sort((a, b) =>
            hexDistance(u.hex, a.hex) - hexDistance(u.hex, b.hex)
            || a.id.localeCompare(b.id))[0] ?? null;
        const currentLocked = assignedTargetId
          ? targetLockedByFrontageInitial(assignedTargetId)
          : false;
        if (closest && (!assignedTargetId || !currentLocked)) {
          assignedTargetId = closest.id;
          assignedTarget = closest;
        }
      }

      // Ranged units avoid contact at all costs. Scattered is the escape/transit
      // formation (loose, all-direction, faster); this is the one formation
      // downgrade allowed for a ranged unit.
      if (canAct && doctrine === 'ranged' && u.currentFormation !== 'Scattered' && !u.isHero) {
        const near = nearestEnemyDist(u.hex, enemiesAlive);
        const canScatter =
          near <= 2 &&
          (u.formationAvailability ?? []).includes('Scattered') &&
          isFormationChangeAffordable(u, effMax(u, ctx.formations));
        if (canScatter) {
          const newMax = effMax({ ...u, currentFormation: 'Scattered' }, ctx.formations);
          const applied = applyFormationChange(u, effMax(u, ctx.formations), newMax);
          const updated = { ...u, currentFormation: 'Scattered', movementPointsAvailable: applied.movementPointsAvailable, actionsAvailable: applied.actionsAvailable };
          commit(u, updated, u.id);
          u = updated;
          plan.steps.push({ kind: 'formation', unitId: u.id, from, formation: 'Scattered' });
          continue;
        }
      }

      // Defensive advance, ranged posture: close when safe/far for maximum
      // attacks, Open/Scattered under incoming ranged fire, Scattered when
      // melee is imminent (all-direction disengage).
      if (canAct && advanced && stance === 'defensive' && formationUpgrades < 2 && doctrine === 'ranged' && !u.isHero && !u.isCharging && !u.climbTo) {
        const w = activeWeaponOf(u);
        const range = w?.range ?? 1;
        const maxR = Math.max(range, w?.maxRange ?? range);
        const formationFoes = enemiesAlive.filter(e => !isProtectedHero(e));
        const near = nearestEnemyDist(u.hex, formationFoes);
        if (w && formationFoes.length > 0 && near <= Math.max(maxR, 2) + 2) {
          const target = formationFoes
            .slice()
            .sort((a, b) => hexDistance(u.hex, a.hex) - hexDistance(u.hex, b.hex) || a.id.localeCompare(b.id))[0];
          const dist = hexDistance(u.hex, target.hex);
          const oldMax = effMax(u, ctx.formations);
          const currentNet = formationRangedScore(u, u.currentFormation, target, dist, enemiesAlive, ctx, stance);
          const candidates = new Set<string>([u.currentFormation, ...(u.formationAvailability ?? [])]);
          let bestF: string | null = null;
          let bestNet = currentNet;
          for (const f of Array.from(candidates)) {
            if (f === u.currentFormation) continue;
            const form = ctx.formations[f];
            if (!form) continue;
            if (!canAdoptFormation(u.currentFormation, f)) continue;
            if (!isFormationChangeAffordable(u, oldMax)) continue;
            if (f === 'Shield Wall') {
              if (!u.isShielded) continue;
              if (w.isTwoHanded) continue;
            }
            const newMax = effMax({ ...u, currentFormation: f }, ctx.formations);
            const applied = applyFormationChange(u, oldMax, newMax);
            if (applied.actionsAvailable < 1 && dist <= maxR) continue; // keep the shot
            const net = formationRangedScore(u, f, target, dist, enemiesAlive, ctx, stance)
              - getFormationChangeMpCost(oldMax) * FORMATION_COST_WEIGHT;
            if (net > bestNet + FORMATION_MARGIN) {
              bestNet = net;
              bestF = f;
            }
          }
          if (bestF) {
            const newMax = effMax({ ...u, currentFormation: bestF }, ctx.formations);
            const applied = applyFormationChange(u, oldMax, newMax);
            const updated = {
              ...u,
              currentFormation: bestF,
              movementPointsAvailable: applied.movementPointsAvailable,
              actionsAvailable: applied.actionsAvailable,
            };
            commit(u, updated, u.id);
            u = updated;
            formationUpgrades++;
            plan.steps.push({ kind: 'formation', unitId: u.id, from, formation: bestF });
            continue;
          }
        }
      }

      // Advanced defensive reserves wait loose (Scattered) for a fast reaction
      // while they are uncommitted. Once committed, the normal role upgrade
      // below applies again.
      if (
        canAct && advanced && stance === 'defensive' && role?.kind === 'reserve'
        && !interceptTarget && !patchHex && formationUpgrades < 1
        && !u.isHero && !u.isCharging && !u.climbTo
        && u.currentFormation !== 'Scattered' && u.currentFormation !== 'Hero'
      ) {
        const near = nearestEnemyDist(u.hex, enemiesAlive);
        const canScatter = near > 1
          && (u.formationAvailability ?? []).includes('Scattered')
          && canAdoptFormation(u.currentFormation, 'Scattered')
          && isFormationChangeAffordable(u, effMax(u, ctx.formations));
        if (canScatter) {
          const newMax = effMax({ ...u, currentFormation: 'Scattered' }, ctx.formations);
          const applied = applyFormationChange(u, effMax(u, ctx.formations), newMax);
          const updated = {
            ...u,
            currentFormation: 'Scattered',
            movementPointsAvailable: applied.movementPointsAvailable,
            actionsAvailable: applied.actionsAvailable,
          };
          commit(u, updated, u.id);
          u = updated;
          formationUpgrades++;
          plan.steps.push({ kind: 'formation', unitId: u.id, from, formation: 'Scattered' });
          continue;
        }
      }

      // Role-aware formation upgrade. Frontage/structure prioritise the highest
      // available organisation level before contact, even at the cost of an
      // attack. A committed reserve upgrades too; an uncommitted reserve keeps
      // its loose waiting posture. Flankers attack first; upgrade only when no
      // attack is currently available (waiting for melee lock).
      if (
        canAct && advanced && formationUpgrades < 2 && doctrine === 'melee'
        && !u.isHero && !u.isCharging && !u.climbTo
        && !(role?.kind === 'reserve' && !interceptTarget && !patchHex)
      ) {
        const near = nearestEnemyDist(u.hex, enemiesAlive);
        const inZoc = movement.threat.has(hexKeyOf(u.hex));
        const isFlank = role?.kind === 'flank' || role?.kind === 'rear';
        const flankLocked = !isFlank || targetIsLocked(assignedTargetId);
        const hasAttackNow = flankLocked && legalTargets(u, enemiesAlive, ctx).length > 0;
        if ((inZoc || near <= 2) && (!isFlank || !hasAttackNow)) {
          const activeWeapon = activeWeaponOf(u);
          const orgLevels = formationOrgLevels(ctx.formations);
          const currentOrg = orgLevels[u.currentFormation] ?? 0;
          const oldMax = effMax(u, ctx.formations);
          let bestF: string | null = null;
          let bestOrg = currentOrg;
          for (const f of [u.currentFormation, ...(u.formationAvailability ?? [])]) {
            if (f === u.currentFormation) continue;
            const form = ctx.formations[f];
            if (!form) continue;
            if (!canAdoptFormation(u.currentFormation, f)) continue;
            if (!isFormationChangeAffordable(u, oldMax)) continue;
            if (f === 'Shield Wall') {
              if (!u.isShielded) continue;
              if (activeWeapon?.isTwoHanded) continue;
            }
            const org = orgLevels[f] ?? 0;
            if (org > bestOrg) {
              bestOrg = org;
              bestF = f;
            }
          }
          if (bestF) {
            const newMax = effMax({ ...u, currentFormation: bestF }, ctx.formations);
            const applied = applyFormationChange(u, oldMax, newMax);
            const updated = {
              ...u,
              currentFormation: bestF,
              movementPointsAvailable: applied.movementPointsAvailable,
              actionsAvailable: applied.actionsAvailable,
            };
            commit(u, updated, u.id);
            u = updated;
            formationUpgrades++;
            plan.steps.push({ kind: 'formation', unitId: u.id, from, formation: bestF });
            continue;
          }
        }
      }

      // Advanced formation choice: melee units compare their available
      // formations when a fight is imminent (already in a hostile ZoC, or an
      // enemy is within 2 hexes). Net damage dealt − received, minus the
      // formation-change cost; switch only on a clear margin.
      if (canAct && advanced && formationUpgrades < 2 && doctrine === 'melee' && !u.isHero && !u.isCharging && !u.climbTo && !role) {
        const activeWeapon = activeWeaponOf(u);
        const meleeActive = !activeWeapon || isMeleeWeapon(activeWeapon);
        const airborne = (u.elevation ?? 0) > 0 && !!(u.flySpeed ?? 0);
        const near = nearestEnemyDist(u.hex, enemiesAlive);
        const inZoc = movement.threat.has(hexKeyOf(u.hex));
        const formationFoes = enemiesAlive.filter(e => !isProtectedHero(e));
        if (meleeActive && !airborne && (inZoc || near <= 2) && formationFoes.length > 0) {
          const target = formationFoes
            .slice()
            .sort((a, b) => hexDistance(u.hex, a.hex) - hexDistance(u.hex, b.hex) || a.id.localeCompare(b.id))[0];
          const oldMax = effMax(u, ctx.formations);
          const currentNet = formationExchangeScore(u, u.currentFormation, target, ctx);
          const candidates = new Set<string>([u.currentFormation, ...(u.formationAvailability ?? [])]);
          let bestF: string | null = null;
          let bestNet = currentNet;
          for (const f of Array.from(candidates)) {
            if (f === u.currentFormation) continue;
            const form = ctx.formations[f];
            if (!form) continue;
            if (!canAdoptFormation(u.currentFormation, f)) continue;
            if (!isFormationChangeAffordable(u, oldMax)) continue;
            if (f === 'Shield Wall') {
              if (!u.isShielded) continue;
              if (activeWeapon?.isTwoHanded) continue;
            }
            const newMax = effMax({ ...u, currentFormation: f }, ctx.formations);
            const applied = applyFormationChange(u, oldMax, newMax);
            // Keep the action needed for an immediate attack.
            if (applied.actionsAvailable < 1 && hexDistance(u.hex, target.hex) <= 1) continue;
            // The change must not spend the movement needed to close.
            if (hexDistance(u.hex, target.hex) > 1) {
              const post = { ...u, currentFormation: f, movementPointsAvailable: applied.movementPointsAvailable, actionsAvailable: applied.actionsAvailable };
              const postPool = computeMovePool(post, newMax);
              if (postPool < hexDistance(u.hex, target.hex) - 1) continue;
            }
            const net = formationExchangeScore(u, f, target, ctx)
              - getFormationChangeMpCost(oldMax) * FORMATION_COST_WEIGHT;
            if (net > bestNet + FORMATION_MARGIN) {
              bestNet = net;
              bestF = f;
            }
          }
          if (bestF) {
            const newMax = effMax({ ...u, currentFormation: bestF }, ctx.formations);
            const applied = applyFormationChange(u, oldMax, newMax);
            const updated = {
              ...u,
              currentFormation: bestF,
              movementPointsAvailable: applied.movementPointsAvailable,
              actionsAvailable: applied.actionsAvailable,
            };
            commit(u, updated, u.id);
            u = updated;
            formationUpgrades++;
            plan.steps.push({ kind: 'formation', unitId: u.id, from, formation: bestF });
            continue;
          }
        }
      }

      // Target choice. Melee prefers adjacency on the best arc (rear > flank >
      // front). Ranged/hybrid shots pick the biggest threat first: an enemy
      // within 2 hexes, else a Phalanx, else a Close Order unit; value breaks
      // ties within a tier. Advanced values marginal damage, finishing blows
      // and expected retaliation; Basic stays raw expected damage.
      const legal = legalTargets(u, enemiesAlive, ctx);
      const meleeOptions = legal.filter(t => !t.isRanged);
      const rangedOptions = legal.filter(t => t.isRanged);
      type TargetSel = { unit: Unit; dist: number; score: number; dmg: number; counter: number; rank: number };
      const pickMelee = (forceFloor = 0): TargetSel | null => {
        let best: TargetSel | null = null;
        for (const t of meleeOptions) {
          const v = attackValue(u, t.unit, t.dist, false, ctx, advanced, stance, reserved);
          if (v.dmg <= 0) continue;
          const score = v.score + (assignedTargetId === t.unit.id ? ASSIGNMENT_BONUS : 0);
          const rank = attackArcRank(u.hex, t.unit);
          // Flankers never spend an attack on a redundant front arc and do not
          // engage before the main body: the target must be locked by a
          // frontage/structure unit.
          if ((role?.kind === 'flank' || role?.kind === 'rear')
            && (rank === 1 || !targetLockedByFrontageInitial(t.unit.id))) continue;
          const better = !best || rank > best.rank
            || (rank === best.rank && (
              advanced
                ? score > best.score
                : v.dmg > best.dmg || (v.dmg === best.dmg && v.counter < best.counter)
            ));
          if (better) {
            best = { unit: t.unit, dist: t.dist, score, dmg: v.dmg, counter: v.counter, rank };
          }
        }
        return best && (advanced ? best.score > forceFloor : best.dmg > 0) ? best : null;
      };
      const pickRanged = (): TargetSel | null => {
        let best: TargetSel | null = null;
        for (const t of rangedOptions) {
          const v = attackValue(u, t.unit, t.dist, true, ctx, advanced, stance, reserved);
          if (v.dmg <= 0) continue;
          const score = v.score + (assignedTargetId === t.unit.id ? ASSIGNMENT_BONUS : 0);
          const tier = threatTier(t.unit, t.dist);
          const better = !best || tier > best.rank
            || (tier === best.rank && (
              advanced
                ? score > best.score
                : v.dmg > best.dmg || (v.dmg === best.dmg && v.counter < best.counter)
            ));
          if (better) {
            best = { unit: t.unit, dist: t.dist, score, dmg: v.dmg, counter: v.counter, rank: tier };
          }
        }
        return best && (advanced ? best.score > 0 : best.dmg > 0) ? best : null;
      };
      let attack: TargetSel | null = null;
      if (!reserveHolding) {
        if (doctrine === 'melee' && meleeOptions.length > 0) {
          // Adjacent frontage/reserve/structure units take a near-breakeven
          // attack rather than idling, even with multiple actions. Flankers
          // keep their stricter positive-score gate.
          const adjacent = nearestEnemyDist(u.hex, enemiesAlive) <= 1;
          const nearBreakevenFloor = (adjacent || (u.actionsAvailable ?? 0) === 1)
            && (role?.kind === 'frontage' || role?.kind === 'reserve' || role?.kind === 'structure')
            ? -8
            : 0;
          attack = pickMelee(nearBreakevenFloor);
        } else if (doctrine === 'ranged') {
          attack = pickRanged();
        } else {
          attack = pickRanged(); // hybrid: no adjacency, so shoot from range
        }
      }

      if (attack && canAct) {
        // Defensive melee: don't accept an attack that leaves another adjacent
        // enemy in our flank/rear. Turn to face the most dangerous one instead,
        // even if that costs the attack this step.
        if (stance === 'defensive' && doctrine === 'melee' && !u.isHero && !defensiveFaced) {
          const exposed = adjacentExposedEnemies(u, enemiesAlive, attack.unit.id);
          if (exposed.length > 0) {
            defensiveFaced = true;
            const threat = exposed.slice().sort((a, b) => {
              const ra = arcOfTarget(u.hex, u.facing, a.hex) === 'rear' ? 2 : 1;
              const rb = arcOfTarget(u.hex, u.facing, b.hex) === 'rear' ? 2 : 1;
              return rb - ra
                || computeThreatRating(b) - computeThreatRating(a)
                || a.id.localeCompare(b.id);
            })[0];
            const faced = turnTowardHex(u, threat.hex, plan);
            u = faced.unit;
            if (faced.turned) continue;
          }
        }
        plan.steps.push({ kind: 'attack', unitId: u.id, from, targetId: attack.unit.id, target: attack.unit.hex });
        if (advanced) reserved.set(attack.unit.id, (reserved.get(attack.unit.id) ?? 0) + attack.dmg);
        const updated = { ...u, actionsAvailable: (u.actionsAvailable ?? 0) - 1, attacksUsed: (u.attacksUsed ?? 0) + 1 };
        commit(u, updated, u.id);
        u = updated;
        hasAttacked = true;
        continue;
      }

      // Structure defenders never voluntarily leave their standing structure.
      if (role?.kind === 'structure') break;

      // No profitable attack — one-pool movement maneuver. Multiple maneuvers
      // are allowed across the turn (mount a move/turn/move/charge sequence);
      // turns that do not set up an attack/charge pay the surcharge.
      const weapon = parseWeapons(u.weaponString || '')[u.activeWeaponIndex ?? 0];
      const weaponRange = weapon?.range ?? 1;
      const weaponMaxRange = Math.max(weaponRange, weapon?.maxRange ?? weaponRange);
      const lockedNow = flankRoleEarly
        ? targetLockedByFrontageInitial(assignedTargetId)
        : targetLockedByFrontage(assignedTargetId);
      const stationLane = role?.kind === 'reserve'
        ? placementCache.get(u.id)?.station ?? null
        : null;
      const lane = interceptTarget
        ? roleLaneHex(
            { kind: 'flank', targetId: interceptTarget.id, side: u.hex.q <= interceptTarget.hex.q ? 'left' : 'right' },
            interceptTarget,
            u,
            true,
          )
        : patchHex ?? stationLane ?? roleLaneHex(role ?? { kind: 'frontage', targetId: '' }, assignedTarget, u, lockedNow);
      const tuning: DestTuning = {
        advanced,
        working,
        mover: u,
        alliances: ctx.alliances,
        assignedTarget,
        stance,
        lane,
        role: role ?? undefined,
        reactionEnabled: !!ctx.reactiveArchery,
        formations: ctx.formations,
        structures: ctx.structures,
        structureTemplates: ctx.structureTemplates,
      };
      const maxTurnCount = freeTurn(u, ctx.formations)
        ? 6
        : doctrine === 'melee' ? maxTurns : Math.min(1, maxTurns);
      const reactingReserve = role?.kind === 'reserve' && (!!interceptTarget || !!patchHex);
      const speedCap = reactingReserve
        ? Infinity
        : clusterSpeedCap(u, initialUnits, ctx, stance, advanced);
      const scorer = doctrine === 'ranged'
        ? (d: Hex, foes: Unit[], threat: Set<string>, facing: number, canAttack: boolean) => rangedDestScore(d, foes, threat, weaponRange, weaponMaxRange, facing, canAttack, tuning)
        : (d: Hex, foes: Unit[], threat: Set<string>, facing: number, canAttack: boolean) => meleeDestScore(d, foes, threat, facing, canAttack, tuning);
      let options = maneuverOptions(
        u, enemiesAlive, ctx, movement, maxTurnCount, cap, scorer, speedCap,
      );
      // Flankers stage on a ring of at least three hexes; they may close only
      // when the destination enables a flank/rear attack on an enemy already
      // locked by the main body. This prevents them engaging before the
      // frontline and settling at two hexes.
      if (flankRoleEarly) {
        options = options.filter(o => {
          const flankAttack = enemiesAlive.some(e =>
            hexDistance(o.move.to, e.hex) === 1
            && attackArcRank(o.move.to, e) > 1
            && targetLockedByFrontageInitial(e.id));
          return flankAttack || nearestEnemyDist(o.move.to, enemiesAlive) >= 3;
        });
      }
      if (options.length === 0) break;
      // Strict turn rule: a rotation is only allowed when no 0-turn option
      // reaches an attack/charge. It never buys lane/cohesion/line bearing.
      const free = freeTurn(u, ctx.formations);
      const flankRole = role?.kind === 'flank' || role?.kind === 'rear';
      const straightAttacks = options.filter(o => o.turns.length === 0 && o.leadsToAttack);
      let candidates: Maneuver[];
      if (reserveHolding) {
        candidates = options;
      } else if (free) {
        candidates = options;
      } else if (flankRoleEarly) {
        candidates = options.filter(o => o.turns.length === 0 || o.leadsToAttack);
      } else if (straightAttacks.length > 0) {
        candidates = straightAttacks;
      } else {
        candidates = options.filter(o => o.turns.length === 0 || o.leadsToAttack);
      }
      // AGR failure still spends the attack action; never plan a follow-up turn
      // that can become unaffordable. Free Scattered turns are safe.
      if (hasAttacked && !free) candidates = candidates.filter(o => o.turns.length === 0);
      if (candidates.length === 0) break;
      let best = candidates[0];
      if (reserveHolding) {
        // An uncommitted reserve only returns to its central station; it does
        // not advance on the enemy line, attack, or leave a hole behind.
        const station = placementCache.get(u.id)?.station ?? null;
        if (!station || hexDistance(u.hex, station) <= 1) break;
        const moves = candidates.filter(o => o.move.path.length > 0);
        if (moves.length === 0) break;
        best = moves.slice().sort((a, b) =>
          hexDistance(a.move.to, station) - hexDistance(b.move.to, station)
          || a.turns.length - b.turns.length
          || b.score - a.score)[0];
      } else {
        // A melee unit that still has actions/MP and is not at contact must keep
        // advancing. Otherwise a defensive line can stop after one maneuver and
        // need a second Execute to finish the same turn.
        const isHold = best.turns.length === 0
          && best.move.path.length === 0
          && best.move.to.q === from.q
          && best.move.to.r === from.r;
        const nearest = nearestEnemyDist(u.hex, enemiesAlive);
        const hasBudget = ((u.actionsAvailable ?? 0) >= 1 || (u.movementPointsAvailable ?? 0) >= 1);
        if (isHold && doctrine === 'melee' && (role?.kind !== 'reserve' || !!interceptTarget || !!patchHex) && !hasAttacked && nearest > 1 && hasBudget) {
          if (flankRoleEarly && !lockedNow) {
            // Unlocked flanker: keep circling instead of waiting in place. Aim
            // for a ring-3+ position that improves the final flank/rear angle.
            const target = assignedTarget
              ?? enemiesAlive
                .slice()
                .sort((a, b) => hexDistance(u.hex, a.hex) - hexDistance(u.hex, b.hex) || a.id.localeCompare(b.id))[0]
              ?? null;
            const finalLane = target ? roleLaneHex(role!, target, u, true) : null;
            const moving = options.filter(o => o.move.path.length > 0);
            if (moving.length > 0) {
              const progress = finalLane
                ? moving.filter(o => hexDistance(o.move.to, finalLane) < hexDistance(u.hex, finalLane))
                : [];
              const pool = progress.length > 0 ? progress : moving;
              pool.sort((a, b) =>
                (finalLane ? hexDistance(a.move.to, finalLane) - hexDistance(b.move.to, finalLane) : 0)
                || b.score - a.score);
              best = pool[0];
            }
          } else {
            const goals: Hex[] = [];
            if (lane) goals.push(lane);
            if (assignedTarget) goals.push(assignedLaneHex(assignedTarget, u));
            const nearestFoe = enemiesAlive
              .slice()
              .sort((a, b) => hexDistance(u.hex, a.hex) - hexDistance(u.hex, b.hex) || a.id.localeCompare(b.id))[0];
            if (nearestFoe) goals.push(assignedLaneHex(nearestFoe, u));
            // If the assigned lane is already reached or blocked, fall back to
            // the nearest reachable enemy instead of holding indefinitely.
            for (const goal of goals) {
              const progress = options.filter(o =>
                o.turns.length === 0
                && o.move.path.length > 0
                && hexDistance(o.move.to, goal) < hexDistance(u.hex, goal));
              progress.sort((a, b) =>
                hexDistance(a.move.to, goal) - hexDistance(b.move.to, goal)
                || Math.abs(a.move.to.q - goal.q) - Math.abs(b.move.to.q - goal.q)
                || b.score - a.score);
              if (progress.length > 0) {
                best = progress[0];
                break;
              }
            }
          }
        }
      }
      // Replay the simulated turns/move onto the real accounting.
      for (const t of best.turns) {
        if (freeTurn(u, ctx.formations)) {
          u = { ...u, facing: t.dir === 'left' ? rotateLeft(u.facing) : rotateRight(u.facing) };
        } else {
          const { movementPointsAvailable, actionsAvailable } = applyMpSpend(u, 1, effMax(u, ctx.formations));
          u = { ...u, facing: t.dir === 'left' ? rotateLeft(u.facing) : rotateRight(u.facing), movementPointsAvailable, actionsAvailable };
        }
        commit(u, u, u.id);
        plan.steps.push({ kind: 'turn', unitId: u.id, from: u.hex, dir: t.dir });
      }
      const applied = applyMoveCost(u, best.move.cost, Math.min(effMax(u, ctx.formations), speedCap));
      // A hold (no move) still applies any in-place turn above, then stops.
      if (best.move.to.q === from.q && best.move.to.r === from.r && best.move.path.length === 0) break;
      const updated = { ...u, hex: best.move.to, movementPointsAvailable: applied.movementPointsAvailable, actionsAvailable: applied.actionsAvailable };
      commit(u, updated, u.id);
      u = updated;
      plan.steps.push({ kind: 'move', unitId: u.id, from, to: best.move.to, path: best.move.path, cost: best.move.cost });
    }

    // Flankers that are still staging should end facing the enemy line so an
    // interception does not catch them side-on. This is a defensive facing turn,
    // not a new attack; it uses leftover budget only.
    if (
      !hasAttacked
      && (role?.kind === 'flank' || role?.kind === 'rear')
      && !targetLockedByFrontageInitial(assignedTargetId)
      && plan.steps.some(s => s.kind === 'move')
      && !plan.steps.some(s => s.kind === 'attack')
    ) {
      const goal = enemies
        .filter(e => !e.isDeleted && !e.hidden && (e.currentUnitHp ?? 0) > 0)
        .sort((a, b) => hexDistance(u.hex, a.hex) - hexDistance(u.hex, b.hex) || a.id.localeCompare(b.id))[0]
        ?? assignedTarget;
      if (goal) {
        const faced = turnTowardHex(u, goal.hex, plan);
        u = faced.unit;
      }
    }

    if (plan.steps.length > 0) plans.push(plan);
  }
  return plans;
}


