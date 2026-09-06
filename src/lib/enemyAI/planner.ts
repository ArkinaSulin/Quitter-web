// src/lib/enemyAI/planner.ts
// Pure "enemy AI assist" decision layer. Given a snapshot of the board and the
// teams handed to the AI, produce an ordered plot (per-unit move/attack/
// turn/formation steps) that the GM can preview and then execute through the
// NORMAL action path.
//
// Design rules (v2 — "smarter"):
//  - Gated out of AI control: deleted, killed (HP <= 0), hidden units, hero-
//    hosted/attached units, and units whose alliance is not the active turn.
//    Routed units ARE plotted — they flee as far from hostiles as possible,
//    stopping at the map rim (gridRadius).
//  - A unit only ever attacks adversarial alliances (friendly<->enemy; neutral
//    is never auto-attacked or auto-driven). No friendly fire by construction.
//  - Plans stay strictly within budget (never a soft-enforcement prompt): moves
//    use the reachable map + real MP accounting; rotations cost 1 MP/60° for
//    formed units (free for Hero/Scattered/Routed) via applyMpSpend; attacks
//    require an action and stay under the attack cap. No about-turns (org loss).
//  - Doctrine is automatic by weapon type: ranged-only units stand off (keep
//    distance, adopt Scattered near contact); melee/hybrid units engage.
//  - Ranged targets pick the biggest threat first: an enemy within 2 hexes,
//    else a Phalanx, else a Close Order unit; expected damage breaks ties.
//  - Melee prefers the best attack arc (rear > flank > front) and tries cheap
//    flanking approaches (up to a few 60° turns) instead of frontal rushes.
//  - Fog is respected: targets must lie in the AI side's visible hexes.
//  - Everything is deterministic (tie-breaks by unit id / hex distance).
import { Unit, Hex, AllianceGroup, Formation, hexDistance } from '@/types/gameProtocol';
import { parseWeapons, isAreaWeapon } from '@/lib/weaponParser';
import { isUnitRouted } from '@/lib/unitMorale';
import { isProtectedHero } from '@/lib/unitInteractions';
import { arcsContain, beAttackedModifier } from '@/lib/formationRules';
import { getRowCapacityBase } from '@/lib/unitStats';
import { unitAttackCap } from '@/lib/attackCap';
import { computeReachableMap, computeMovePool, applyMoveCost, applyMpSpend } from '@/lib/moveCost';
import { isMeleeWeapon } from '@/lib/meleeFallback';
import { terrainCostOf, TerrainCosts, computeThreatHexes } from '@/components/ScenarioMap/mapGeometry';
import { determineCombatPosition } from '@/lib/unitCombat';
import { applyFormationChange, isFormationChangeAffordable } from '@/lib/formationCost';

const DIRS: { q: number; r: number; s: number }[] = [
  { q: 1, r: 0, s: -1 }, { q: 0, r: 1, s: -1 }, { q: -1, r: 1, s: 0 },
  { q: -1, r: 0, s: 1 }, { q: 0, r: -1, s: 1 }, { q: 1, r: -1, s: 0 },
];

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
  /** Grid radius (axial ring). When set, routed flee stops at the outer rim. */
  gridRadius?: number;
  /** Max plot steps per unit (default 5 — enough for turn + move + attack). */
  maxStepsPerUnit?: number;
  /** Max 60° turns per approach (default 3 — a full 180°, never about-turn). */
  maxTurns?: number;
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

function hitChance(atkBonus: number, targetAc: number, disadvantage: boolean): number {
  const need = targetAc - atkBonus;
  let p = (21 - Math.min(20, Math.max(1, need))) / 20;
  p = Math.max(0, Math.min(1, p));
  if (disadvantage) p = p * p;
  return p;
}

function expectedAttackerCount(attacker: Unit, ctx: Pick<AiPlanContext, 'formations'>): number {
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
  if (weapon?.isHealing || (weapon && isAreaWeapon(weapon))) return 0; // AI doesn't heal/cast in v2
  if (!weapon) {
    if (dist !== 1) return 0;
    return expectedAttackerCount(attacker, ctx) * hitChance(0, target.currentAc, false) * 1; // fists 1d1
  }
  const effBonus = weapon.attackBonus + (ctx.formations[attacker.currentFormation]?.attack_modifier ?? 0);
  const targetForm = ctx.formations[target.currentFormation];
  const mod = beAttackedModifier(targetForm, isRanged) ?? 1;
  const count = Math.round(expectedAttackerCount(attacker, ctx) * mod);
  const heroCap = !isRanged && !attacker.isHero && target.isHero ? 0.5 : 1;
  const disadvantage = isRanged && dist > (weapon.range ?? 1);
  const perHit = Math.min(diceMean(weapon.damageDice), target.troopHp);
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

function isLoose(u: Unit): boolean {
  return u.isHero || u.currentFormation === 'Scattered' || u.currentFormation === 'Routed';
}

function freeTurn(u: Unit): boolean {
  return isLoose(u);
}

/** Can the unit pay `cost` MP right now (mirrors applyMpSpend logic). */
function canPayMp(u: Unit, cost: number): boolean {
  return (u.movementPointsAvailable ?? 0) >= cost || (u.actionsAvailable ?? 0) >= 1;
}

function effMax(u: Unit, formations: Record<string, Formation>): number {
  const mult = formations[u.currentFormation]?.movement_multiplier ?? 1;
  return Math.max(1, Math.floor((u.movementPoints ?? 0) * mult));
}

interface PlannedMoveOption {
  to: Hex;
  path: Hex[];
  cost: number;
  score: number;
  canAttack: boolean;
  attackScore: number;
}

function bestAdjacentArc(dest: Hex, foes: Unit[]): number {
  let best = 0;
  for (const e of foes) {
    if (hexDistance(dest, e.hex) === 1) {
      const rank = attackArcRank(dest, e);
      if (rank > best) best = rank;
    }
  }
  return best;
}

/** Destination scorer for melee: prefer adjacency on the enemy's rear/flank,
 *  then closeness. */
function meleeDestScore(dest: Hex, foes: Unit[], threat: Set<string>): number {
  const arc = bestAdjacentArc(dest, foes);
  const near = nearestEnemyDist(dest, foes);
  const threatPenalty = threat.has(hexKeyOf(dest)) ? 8 : 0;
  return arc * 30 + (8 - Math.min(8, near)) - threatPenalty;
}

/** Destination scorer for stand-off ranged: stay ≥ gap from enemies and within
 *  the active weapon's reach of the fight; otherwise advance toward it. */
function rangedDestScore(
  dest: Hex,
  foes: Unit[],
  threat: Set<string>,
  weaponRange: number,
  weaponMaxRange: number,
): number {
  const near = nearestEnemyDist(dest, foes);
  const threatPenalty = threat.has(hexKeyOf(dest)) ? 8 : 0;
  const gap = 2;
  if (near >= weaponMaxRange && weaponMaxRange >= 1) {
    // Everything is out of reach — advance.
    return 30 - near - threatPenalty;
  }
  if (near < gap) {
    return -((gap - near) * 12) - threatPenalty; // too close: prefer to back off
  }
  // Comfortable band [gap .. maxRange]; prefer being a bit further back.
  return Math.max(0, 10 - near) - threatPenalty;
}

interface Maneuver {
  turns: { dir: 'left' | 'right' }[];
  move: PlannedMoveOption;
  postTurnUnit: Unit;
  score: number;
}

/** Enumerate approaches: up to `maxTurns` 60° turns (each simulated with real
 *  MP accounting) followed by one straight leg, scored by `scorer`. */
function maneuverOptions(
  u: Unit,
  working: Unit[],
  enemies: Unit[],
  ctx: Pick<AiPlanContext, 'alliances' | 'formations' | 'visibleHexes'>,
  costOfHex: ((q: number, r: number) => number) | undefined,
  maxTurns: number,
  scorer: (dest: Hex, foes: Unit[], threat: Set<string>) => number,
): Maneuver[] {
  const foes = enemies.filter(e => !e.isDeleted && !e.hidden && (e.currentUnitHp ?? 0) > 0);
  const out: Maneuver[] = [];
  const occ = new Set<string>();
  for (const w of working) if (!w.isDeleted && w.id !== u.id) occ.add(hexKeyOf(w.hex));
  const threat = computeThreatHexes(working, u.id, ctx.alliances, ctx.formations);

  const evaluate = (turns: { dir: 'left' | 'right' }[], unitAfter: Unit) => {
    const max = effMax(unitAfter, ctx.formations);
    const pool = computeMovePool(unitAfter, max);
    if (pool < 1) return;
    const reach = computeReachableMap(unitAfter, pool, occ, threat, costOfHex);
    reach.forEach((entry, key) => {
      if (entry.needsTurn) return;
      const dest = entry.path[entry.path.length - 1];
      if (!dest) return;
      const score = scorer(dest, foes, threat) - turns.length * 3 - entry.cost;
      out.push({ turns: [...turns], move: { to: dest, path: entry.path, cost: entry.cost, score, canAttack: false, attackScore: 0 }, postTurnUnit: unitAfter, score });
    });
  };

  // Recursively try 0..maxTurns rotations (left/right branches), stopping when
  // the unit can no longer pay for another turn.
  const recurse = (turns: { dir: 'left' | 'right' }[], unitState: Unit) => {
    evaluate(turns, unitState);
    if (turns.length >= maxTurns) return;
    if (!freeTurn(unitState) && !canPayMp(unitState, 1)) return;
    for (const dir of ['left', 'right'] as const) {
      let next = unitState;
      const nf = dir === 'left' ? ((unitState.facing + 5) % 6) : ((unitState.facing + 1) % 6);
      if (freeTurn(unitState)) {
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
  out.sort((a, b) => b.score - a.score);
  return out;
}

/** Best retreat step for a ROUTED unit: the reachable hex farthest from the
 *  nearest hostile, bounded by the map rim. Returns null when nothing is
 *  strictly safer / legal. */
function chooseFleeHex(
  u: Unit,
  working: Unit[],
  enemies: Unit[],
  ctx: Pick<AiPlanContext, 'alliances' | 'formations' | 'visibleHexes'>,
  costOfHex: ((q: number, r: number) => number) | undefined,
  gridRadius: number | undefined,
): { pick: PlannedMoveOption; updated: Unit; path: Hex[] } | null {
  const foes = enemies.filter(e => !e.isDeleted && !e.hidden && (e.currentUnitHp ?? 0) > 0);
  if (foes.length === 0) return null;
  const ring = (h: { q: number; r: number }) => Math.max(Math.abs(h.q), Math.abs(h.r), Math.abs(h.q + h.r));
  if (gridRadius !== undefined && ring(u.hex) >= gridRadius) return null; // at/over the rim: stay
  const occ = new Set<string>();
  for (const w of working) if (!w.isDeleted && w.id !== u.id) occ.add(hexKeyOf(w.hex));
  const pool = computeMovePool(u, effMax(u, ctx.formations));
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
  const byId = new Map(working.map(u => [u.id, u]));
  const group = ctx.activeAlliance;
  const enemies = working.filter(u =>
    !u.isDeleted && !u.hidden && (u.currentUnitHp ?? 0) > 0 && enemyGroupsOf(group).has(allianceOf(u, ctx.alliances)));

  const costOfHex = ctx.terrainCosts ? (q: number, r: number) => terrainCostOf(ctx.terrainCosts ?? null, q, r) : undefined;
  const maxSteps = ctx.maxStepsPerUnit ?? 5;
  const maxTurns = ctx.maxTurns ?? 3;
  const cap = unitAttackCap();

  const commit = (u: Unit, updated: Unit, id: string) => {
    byId.set(id, updated);
    const idx = working.findIndex(w => w.id === id);
    if (idx >= 0) working[idx] = updated;
  };

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
        const flee = chooseFleeHex(u, working, enemies, ctx, costOfHex, ctx.gridRadius);
        if (!flee) break;
        commit(u, flee.updated, u.id);
        u = flee.updated;
        plan.steps.push({ kind: 'move', unitId: u.id, from, to: flee.pick.to, path: flee.path, cost: flee.pick.cost });
        continue;
      }

      const doctrine = unitDoctrine(u);
      const enemiesAlive = enemies.filter(e => !e.isDeleted && !e.hidden && (e.currentUnitHp ?? 0) > 0);

      // Stand-off: adopt Scattered when contact looms and we can afford it.
      if (doctrine === 'ranged' && u.currentFormation !== 'Scattered' && !u.isHero) {
        const near = nearestEnemyDist(u.hex, enemiesAlive);
        const canScatter =
          near <= 3 &&
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

      // Target choice. Melee prefers adjacency on the best arc (rear > flank >
      // front). Ranged/hybrid shots pick the biggest threat first: an enemy
      // within 2 hexes, else a Phalanx, else a Close Order unit; expected
      // damage breaks ties within a tier.
      const legal = legalTargets(u, enemiesAlive, ctx);
      const meleeOptions = legal.filter(t => !t.isRanged);
      const rangedOptions = legal.filter(t => t.isRanged);
      type TargetSel = { unit: Unit; dist: number; score: number };
      const pickRanged = (): TargetSel | null => {
        let best: TargetSel | null = null;
        for (const t of rangedOptions) {
          const tier = threatTier(t.unit, t.dist);
          const dmg = expectedDamage(u, t.unit, t.dist, true, ctx);
          if (dmg <= 0) continue;
          if (!best) { best = { unit: t.unit, dist: t.dist, score: dmg }; continue; }
          const curTier = threatTier(best.unit, best.dist);
          if (tier > curTier || (tier === curTier && dmg > best.score)) best = { unit: t.unit, dist: t.dist, score: dmg };
        }
        return best;
      };
      let attack: TargetSel | null = null;
      if (doctrine === 'melee' && meleeOptions.length > 0) {
        let best = meleeOptions[0];
        for (const t of meleeOptions) {
          const rank = attackArcRank(u.hex, t.unit);
          const curRank = attackArcRank(u.hex, best.unit);
          const dmg = expectedDamage(u, t.unit, t.dist, false, ctx);
          const curDmg = expectedDamage(u, best.unit, best.dist, false, ctx);
          if (rank > curRank || (rank === curRank && dmg > curDmg)) best = t;
        }
        const dmg = expectedDamage(u, best.unit, best.dist, false, ctx);
        if (dmg > 0) attack = { unit: best.unit, dist: best.dist, score: dmg };
      } else if (doctrine === 'ranged') {
        attack = pickRanged();
      } else {
        attack = pickRanged(); // hybrid: no adjacency, so shoot from range
      }

      if (attack) {
        plan.steps.push({ kind: 'attack', unitId: u.id, from, targetId: attack.unit.id, target: attack.unit.hex });
        const updated = { ...u, actionsAvailable: (u.actionsAvailable ?? 0) - 1, attacksUsed: (u.attacksUsed ?? 0) + 1 };
        commit(u, updated, u.id);
        u = updated;
        continue;
      }

      // No profitable attack — maneuver (approach/flank or stand-off band).
      const weapon = parseWeapons(u.weaponString || '')[u.activeWeaponIndex ?? 0];
      const weaponRange = weapon?.range ?? 1;
      const weaponMaxRange = Math.max(weaponRange, weapon?.maxRange ?? weaponRange);
      const scorer = doctrine === 'ranged'
        ? (d: Hex, foes: Unit[], threat: Set<string>) => rangedDestScore(d, foes, threat, weaponRange, weaponMaxRange)
        : (d: Hex, foes: Unit[], threat: Set<string>) => meleeDestScore(d, foes, threat);
      const options = maneuverOptions(u, working, enemiesAlive, ctx, costOfHex, doctrine === 'melee' ? maxTurns : Math.min(1, maxTurns), scorer);
      if (options.length === 0) break;
      const best = options[0];
      // Replay the simulated turns/move onto the real accounting.
      for (const t of best.turns) {
        if (freeTurn(u)) {
          u = { ...u, facing: t.dir === 'left' ? (u.facing + 5) % 6 : (u.facing + 1) % 6 };
        } else {
          const { movementPointsAvailable, actionsAvailable } = applyMpSpend(u, 1, effMax(u, ctx.formations));
          u = { ...u, facing: t.dir === 'left' ? (u.facing + 5) % 6 : (u.facing + 1) % 6, movementPointsAvailable, actionsAvailable };
        }
        commit(u, u, u.id);
        plan.steps.push({ kind: 'turn', unitId: u.id, from: u.hex, dir: t.dir });
      }
      const applied = applyMoveCost(u, best.move.cost, effMax(u, ctx.formations));
      const updated = { ...u, hex: best.move.to, movementPointsAvailable: applied.movementPointsAvailable, actionsAvailable: applied.actionsAvailable };
      commit(u, updated, u.id);
      u = updated;
      plan.steps.push({ kind: 'move', unitId: u.id, from, to: best.move.to, path: best.move.path, cost: best.move.cost });
    }
    if (plan.steps.length > 0) plans.push(plan);
  }
  return plans;
}
