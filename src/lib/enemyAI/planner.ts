// src/lib/enemyAI/planner.ts
// Pure "enemy AI assist" decision layer. Given a snapshot of the board and the
// teams handed to the AI, produce an ordered plot (per-unit move/attack steps)
// that the GM can preview and then execute through the NORMAL action path.
//
// Design rules (v0):
//  - Gated out of AI control: deleted, killed (HP <= 0), hidden units, hero-
//    hosted/attached units, and units whose alliance is not the active turn.
//    Routed units ARE plotted — they flee as far from hostiles as possible.
//  - A unit only ever attacks adversarial alliances (friendly<->enemy; neutral
//    is never auto-attacked or auto-driven). No friendly fire by construction.
//  - Plans stay strictly within budget (never a soft-enforcement prompt): moves
//    use the reachable map + real MP accounting; attacks require an action and
//    stay under the attack cap.
//  - Fog is respected: targets must lie in the AI side's visible hexes.
//  - Everything is deterministic (tie-breaks by unit id / hex distance).
import { Unit, Hex, AllianceGroup, Formation, hexDistance } from '@/types/gameProtocol';
import { parseWeapons, isAreaWeapon } from '@/lib/weaponParser';
import { isUnitRouted } from '@/lib/unitMorale';
import { isProtectedHero } from '@/lib/unitInteractions';
import { arcsContain, beAttackedModifier } from '@/lib/formationRules';
import { getRowCapacityBase } from '@/lib/unitStats';
import { unitAttackCap } from '@/lib/attackCap';
import { computeReachableMap, computeMovePool, applyMoveCost } from '@/lib/moveCost';
import { terrainCostOf, TerrainCosts, computeThreatHexes } from '@/components/ScenarioMap/mapGeometry';

const DIRS: { q: number; r: number; s: number }[] = [
  { q: 1, r: 0, s: -1 }, { q: 0, r: 1, s: -1 }, { q: -1, r: 1, s: 0 },
  { q: -1, r: 0, s: 1 }, { q: 0, r: -1, s: 1 }, { q: 1, r: -1, s: 0 },
];

export type AiStep =
  | { kind: 'move'; unitId: string; from: Hex; to: Hex; path: Hex[]; cost: number }
  | { kind: 'attack'; unitId: string; from: Hex; targetId: string; target: Hex };

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
  /** Grid radius (axial ring). When set, routed flee stops at the outer rim and
   *  never moves beyond it — the DM then gets a chance to hide the broken unit. */
  gridRadius?: number;
  /** Max plot steps per unit (default 3). */
  maxStepsPerUnit?: number;
}

export function hexKeyOf(hex: { q: number; r: number }): string {
  return `${hex.q},${hex.r}`;
}

export function allianceOf(unit: Pick<Unit, 'team'>, alliances: Record<string, AllianceGroup>): AllianceGroup {
  return alliances[unit.team] || 'friendly';
}

/** Which alliances a given alliance treats as adversarial. Neutral is never attacked. */
export function enemyGroupsOf(group: AllianceGroup): Set<AllianceGroup> {
  if (group === 'friendly') return new Set<AllianceGroup>(['enemy']);
  if (group === 'enemy') return new Set<AllianceGroup>(['friendly']);
  return new Set<AllianceGroup>();
}

/** True when a unit is eligible to be handed to the AI at this moment.
 *  Routed units ARE eligible — the planner flees them away from hostiles. */
export function isAiControllable(
  unit: Unit,
  ctx: Pick<AiPlanContext, 'alliances' | 'teams' | 'activeAlliance'>,
  hostedBy: Set<string>,
): boolean {
  if (unit.isDeleted) return false;
  if (unit.hidden) return false; // hidden units are never AI-controlled
  if ((unit.currentUnitHp ?? 0) <= 0) return false; // killed / downed
  if (unit.attachedToUnitId) return false; // attached hero rides its host
  if (hostedBy.has(unit.id)) return false; // host of an attached hero (split-accounting)
  if (!ctx.teams.includes(unit.team)) return false;
  if (ctx.activeAlliance === null) return false; // free play — no plotting
  if (allianceOf(unit, ctx.alliances) !== ctx.activeAlliance) return false;
  if ((unit.actionsAvailable ?? 0) < 1) return false;
  return true;
}

function arcBetween(from: Hex, facing: number, to: Hex): 'front' | 'flank' | 'rear' {
  const idx = DIRS.findIndex(d => d.q === to.q - from.q && d.r === to.r - from.r && d.s === to.s - from.s);
  if (idx === -1) return 'front';
  const front = [(facing + 4) % 6, (facing + 5) % 6];
  const rear = [(facing + 1) % 6, (facing + 2) % 6];
  if (front.includes(idx)) return 'front';
  if (rear.includes(idx)) return 'rear';
  return 'flank';
}

interface AttackLike {
  weapon: { attackBonus: number; damageDice: string; numberOfAttacks?: number; range?: number; maxRange?: number };
  isRanged: boolean;
  dist: number;
  targetArc: 'front' | 'flank' | 'rear';
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
    if (dist > 1 && !weapon) continue;
    // Ranged-capable weapons shoot within maxRange from any arc the formation allows.
    const maxRange = Math.max(weapon?.range ?? 1, weapon?.maxRange ?? (weapon?.range ?? 1));
    const isRangedCapable = (weapon?.range ?? 1) > 1 || (weapon?.maxRange ?? (weapon?.range ?? 1)) > 1;
    const targetArc = arcBetween(attacker.hex, attacker.facing, other.hex);
    if (dist > 1) {
      if (!isRangedCapable || !weapon) continue;
      if (dist > maxRange) continue;
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

function hitChance(atkBonus: number, targetAc: number, disadvantage: boolean): number {
  const need = targetAc - atkBonus;
  let p = (21 - Math.min(20, Math.max(1, need))) / 20;
  p = Math.max(0, Math.min(1, p));
  if (disadvantage) p = p * p;
  return p;
}

/** Row/attack math for the attacker side (mirrors computeAttackCount). */
function expectedAttackerCount(attacker: Unit, isRanged: boolean, ctx: Pick<AiPlanContext, 'formations'>): number {
  const form = ctx.formations[attacker.currentFormation];
  const weapons = parseWeapons(attacker.weaponString || '');
  const weapon = weapons[attacker.activeWeaponIndex ?? 0] ?? weapons[0];
  const weaponAttacks = weapon?.numberOfAttacks ?? 1;
  if (attacker.isHero) return weaponAttacks;
  const rowCap = getRowCapacityBase(attacker.sizeCategory);
  const atkCapMult = form?.attack_capacity_multiplier ?? 1;
  const cap = Math.min(attacker.currentTroopCount, rowCap * atkCapMult);
  return Math.max(1, cap * weaponAttacks);
}

/** Expected damage of `attacker` vs `target` this action (0 = pointless). */
export function expectedDamage(
  attacker: Unit,
  target: Unit,
  dist: number,
  isRanged: boolean,
  ctx: Pick<AiPlanContext, 'formations'>,
): number {
  const weapons = parseWeapons(attacker.weaponString || '');
  const weapon = weapons[attacker.activeWeaponIndex ?? 0] ?? weapons[0];
  if (!weapon) {
    if (dist !== 1) return 0;
    return expectedAttackerCount(attacker, false, ctx) * hitChance(0, target.currentAc, false) * 1; // fists 1d1
  }
  const effBonus = weapon.attackBonus + (ctx.formations[attacker.currentFormation]?.attack_modifier ?? 0);
  const targetForm = ctx.formations[target.currentFormation];
  const mod = beAttackedModifier(targetForm, isRanged) ?? 1;
  const count = Math.round(expectedAttackerCount(attacker, isRanged, ctx) * mod);
  // Melee vs a lone hero: only half the troops reach.
  const heroCap = !isRanged && !attacker.isHero && target.isHero ? 0.5 : 1;
  const disadvantage = isRanged && dist > (weapon.range ?? 1);
  const perHit = Math.min(diceMean(weapon.damageDice) + (weapon.isHealing ? 0 : 0), target.troopHp);
  if (weapon.isHealing || isAreaWeapon(weapon)) return 0; // AI doesn't heal/cast in v0
  return Math.max(0, Math.round(count * heroCap) * hitChance(effBonus, target.currentAc, disadvantage) * perHit);
}

function nearestEnemyDist(hex: Hex, enemies: Unit[]): number {
  let best = Infinity;
  for (const e of enemies) {
    const d = hexDistance(hex, e.hex);
    if (d < best) best = d;
  }
  return best;
}

export interface PlannedMoveOption {
  to: Hex;
  path: Hex[];
  cost: number;
  score: number;
  canAttack: boolean;
  attackScore: number;
}

/** Candidate landing hexes from the reachable map, scored for the AI. */
export function scoreMoveDestinations(
  unit: Unit,
  pool: number,
  occupied: Set<string>,
  threatHexes: Set<string>,
  enemies: Unit[],
  ctx: Pick<AiPlanContext, 'alliances' | 'formations' | 'visibleHexes' | 'terrainCosts'>,
  costOfHex?: (q: number, r: number) => number,
): PlannedMoveOption[] {
  const reach = computeReachableMap(unit, Math.max(1, pool), occupied, threatHexes, costOfHex);
  const options: PlannedMoveOption[] = [];
  reach.forEach((entry, key) => {
    if (entry.needsTurn) return;
    const dest = entry.path[entry.path.length - 1];
    if (!dest) return;
    const land = hexKeyOf(dest);
    const visibleOk = !ctx.visibleHexes || ctx.visibleHexes.has(hexKeyOf(unit.hex)) || ctx.visibleHexes.has(land);
    if (!visibleOk) return;
    // Can we attack from the landing hex? (facing unchanged after a move)
    const ghost: Unit = { ...unit, hex: dest };
    const foes = enemies.filter(e => !e.isDeleted && !e.hidden && (e.currentUnitHp ?? 0) > 0);
    let canAttack = false;
    let attackScore = 0;
    for (const e of foes) {
      const d = hexDistance(dest, e.hex);
      const melee = d === 1;
      const ranged = !melee;
      const isRanged = ranged;
      if (legalTargets(ghost, enemies, ctx).some(t => t.unit.id === e.id)) {
        canAttack = true;
        const score = expectedDamage(ghost, e, d, isRanged, ctx);
        if (score > attackScore) attackScore = score;
      }
    }
    const nearEnemy = nearestEnemyDist(dest, foes);
    // Heuristic: favour hexes that enable an attack now, then closer-to-threat
    // hexes, penalizing landing in enemy zones of control.
    const threatPenalty = threatHexes.has(land) ? 6 : 0;
    const baseScore = canAttack ? 1000 + attackScore : 40 - nearEnemy;
    const score = baseScore - threatPenalty + (canAttack ? 20 : 0);
    options.push({ to: dest, path: entry.path, cost: entry.cost, score, canAttack, attackScore });
  });
  options.sort((a, b) => b.score - a.score);
  return options;
}

function buildMoveOption(
  u: Unit,
  working: Unit[],
  enemies: Unit[],
  ctx: AiPlanContext,
  effMax: (x: Unit) => number,
  costOfHex: ((q: number, r: number) => number) | undefined,
): { pick: PlannedMoveOption; updated: Unit; path: Hex[] } | null {
  const occ = new Set<string>();
  for (const w of working) if (!w.isDeleted && w.id !== u.id) occ.add(hexKeyOf(w.hex));
  const pool = computeMovePool(u, effMax(u));
  if (pool < 1) return null;
  const threat = computeThreatHexes(working, u.id, ctx.alliances, ctx.formations);
  const options = scoreMoveDestinations(u, pool, occ, threat, enemies, ctx, costOfHex);
  if (options.length === 0) return null;
  const pick = options[0];
  const applied = applyMoveCost(u, pick.cost, effMax(u));
  return { pick, path: pick.path, updated: { ...u, hex: pick.to, movementPointsAvailable: applied.movementPointsAvailable, actionsAvailable: applied.actionsAvailable } };
}

/** Best retreat step for a ROUTED unit: the reachable hex farthest from the
 *  nearest hostile (ties → away from enemy kill zones, cheaper path first).
 *  When a `gridRadius` is set, the run stops at the map's outer rim — a unit
 *  already at (or beyond) the rim does not move (gives the DM a chance to
 *  hide it). Returns null when nothing is strictly safer / legal. */
function chooseFleeHex(
  u: Unit,
  working: Unit[],
  enemies: Unit[],
  ctx: AiPlanContext,
  effMax: (x: Unit) => number,
  costOfHex: ((q: number, r: number) => number) | undefined,
  gridRadius: number | undefined,
): { pick: PlannedMoveOption; updated: Unit; path: Hex[] } | null {
  const foes = enemies.filter(e => !e.isDeleted && !e.hidden && (e.currentUnitHp ?? 0) > 0);
  if (foes.length === 0) return null;
  // Axial ring distance from the map centre (s = -q - r).
  const ring = (h: { q: number; r: number }) => Math.max(Math.abs(h.q), Math.abs(h.r), Math.abs(h.q + h.r));
  if (gridRadius !== undefined && ring(u.hex) >= gridRadius) return null; // at/over the rim: stay
  const occ = new Set<string>();
  for (const w of working) if (!w.isDeleted && w.id !== u.id) occ.add(hexKeyOf(w.hex));
  const pool = computeMovePool(u, effMax(u));
  if (pool < 1) return null;
  const threat = computeThreatHexes(working, u.id, ctx.alliances, ctx.formations);
  const reach = computeReachableMap(u, pool, occ, threat, costOfHex);
  const startDist = nearestEnemyDist(u.hex, foes);
  const candidates: PlannedMoveOption[] = [];
  reach.forEach((entry, key) => {
    if (entry.needsTurn) return;
    const dest = entry.path[entry.path.length - 1];
    if (!dest) return;
    if (gridRadius !== undefined && ring(dest) > gridRadius) return; // never flee off the board
    const d = nearestEnemyDist(dest, foes);
    if (d <= startDist) return; // only strictly safer hexes
    const threatPenalty = threat.has(key) ? 4 : 0;
    const score = d * 10 - threatPenalty - entry.cost;
    candidates.push({ to: dest, path: entry.path, cost: entry.cost, score, canAttack: false, attackScore: 0 });
  });
  if (candidates.length === 0) return null;
  let best = candidates[0];
  for (const c of candidates) if (c.score > best.score) best = c;
  const applied = applyMoveCost(u, best.cost, effMax(u));
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

  // Work on copies: as each unit is plotted we advance its simulated position
  // and spend its resources, so later units plan against the evolving board.
  const working = units.map(u => ({ ...u }));
  const byId = new Map(working.map(u => [u.id, u]));
  const group = ctx.activeAlliance;
  const enemies = working.filter(u =>
    !u.isDeleted && !u.hidden && (u.currentUnitHp ?? 0) > 0 && enemyGroupsOf(group).has(allianceOf(u, ctx.alliances)));

  const formationMult = (u: Unit) => ctx.formations[u.currentFormation]?.movement_multiplier ?? 1;
  const effMax = (u: Unit) => Math.max(1, Math.floor((u.movementPoints ?? 0) * formationMult(u)));
  const cap = unitAttackCap();
  const maxSteps = ctx.maxStepsPerUnit ?? 3;
  const costOfHex = ctx.terrainCosts ? (q: number, r: number) => terrainCostOf(ctx.terrainCosts ?? null, q, r) : undefined;

  const plans: AiUnitPlan[] = [];
  for (const seed of controllable) {
    const plan: AiUnitPlan = { unitId: seed.id, steps: [] };
    let u = byId.get(seed.id)!;
    for (let s = 0; s < maxSteps; s++) {
      if ((u.actionsAvailable ?? 0) < 1) break;
      if ((u.attacksUsed ?? 0) >= cap) break;
      const from = u.hex;

      // Routed units can't fight — run as far from hostiles as possible, but
      // stop at the map's outer rim so the DM can hide the broken unit.
      if (isUnitRouted(u)) {
        const flee = chooseFleeHex(u, working, enemies, ctx, effMax, costOfHex, ctx.gridRadius);
        if (!flee) break;
        byId.set(u.id, flee.updated);
        const wIdx = working.findIndex(w => w.id === u.id);
        if (wIdx >= 0) working[wIdx] = flee.updated;
        u = flee.updated;
        plan.steps.push({ kind: 'move', unitId: u.id, from, to: flee.pick.to, path: flee.path, cost: flee.pick.cost });
        continue;
      }

      // Prefer the best legal attack available right now.
      const legal = legalTargets(u, enemies, ctx);
      let bestTarget: { unit: Unit; score: number } | null = null;
      for (const t of legal) {
        const score = expectedDamage(u, t.unit, t.dist, t.isRanged, ctx);
        if (!bestTarget || score > bestTarget.score || (score === bestTarget.score && t.unit.id < bestTarget.unit.id)) {
          bestTarget = { unit: t.unit, score };
        }
      }
      if (bestTarget && bestTarget.score > 0) {
        plan.steps.push({ kind: 'attack', unitId: u.id, from, targetId: bestTarget.unit.id, target: bestTarget.unit.hex });
        const updated = { ...u, actionsAvailable: (u.actionsAvailable ?? 0) - 1, attacksUsed: (u.attacksUsed ?? 0) + 1 };
        byId.set(u.id, updated);
        const idx = working.findIndex(w => w.id === u.id);
        if (idx >= 0) working[idx] = updated;
        u = updated;
        continue;
      }

      // Otherwise move toward a good landing hex (one that may set up an attack).
      const move = buildMoveOption(u, working, enemies, ctx, effMax, costOfHex);
      if (!move) break;
      byId.set(u.id, move.updated);
      const idx = working.findIndex(w => w.id === u.id);
      if (idx >= 0) working[idx] = move.updated;
      u = move.updated;
      plan.steps.push({ kind: 'move', unitId: u.id, from, to: move.pick.to, path: move.path, cost: move.pick.cost });
    }
    if (plan.steps.length > 0) plans.push(plan);
  }
  return plans;
}
