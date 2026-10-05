import { Hex, Unit } from '@/types/gameProtocol';
import { getSetting } from '@/lib/settingsCache';
import { HEX_DIRS, frontArcIndices } from '@/lib/hexGeometry';

export interface MovePathEntry {
  cost: number;
  path: Hex[];
  finalFacing: number;
  /**
   * True when every path to this hex requires a facing change. Movement only
   * pays distance; turning is a separate paid ROTATE, so a turn-required hex is
   * not droppable — it's a hint that the unit must rotate first.
   */
  needsTurn?: boolean;
  /** Formation after reaching this hex (present only when a max_org_level_allowed
   *  gate broke the formation en route). */
  finalFormation?: string;
}

/** Organization-gate context for `computeReachableMap`: how a `max_org_level_allowed`
 *  gate breaks a formation and how that changes the movement budget. */
export interface OrgMoveOpts {
  /** formation name -> movement_multiplier (rescales the MP budget on break). */
  movementMultipliers?: Record<string, number>;
  /** (fromQ, fromR, toQ, toR, formation) -> formation to break to, or null when
   *  no governing gate is exceeded. */
  breakOnEntry?: (fromQ: number, fromR: number, toQ: number, toR: number, formation: string) => string | null;
}

type MpBudget = Pick<Unit, 'movementPointsAvailable' | 'actionsAvailable'>;

/** Per-hex MP entry cost; `fromQ/fromR` (when supplied) let a caller apply a
 *  per-EDGE cost (walls) that replaces the destination hex's terrain cost. */
export type CostOfHexFn = (q: number, r: number, fromQ?: number, fromR?: number) => number;
/** Predicate: is the edge `from -> to` impassable? (walls authored as blocks). */
export type BlockedEdgeFn = (fromQ: number, fromR: number, toQ: number, toR: number) => boolean;

/**
 * Movement budget for a move, in the "1 action = 1 full MP pool" model.
 * Includes any already-materialized MP plus every remaining action as a full
 * pool. With 0 actions, one extra pool is still counted so an over-budget
 * attempt can trigger the soft-enforcement confirm.
 */
export function computeMoveBudget(unit: MpBudget, maxMP: number): number {
  const pool = Math.max(1, maxMP);
  const mp = Math.max(0, Math.floor(unit.movementPointsAvailable));
  return mp + pool * Math.max(1, unit.actionsAvailable);
}

/**
 * Executed MP/action accounting for a move of the given path cost.
 * The cost is spent from already-materialized MP first; each full pool beyond
 * that converts one action into a fresh pool. Final MP is the remainder of the
 * last pool (0 when a pool is exactly consumed), final actions is how many
 * unconverted pools remain. Values may go negative — soft enforcement.
 */
export function applyMoveCost(
  unit: MpBudget,
  cost: number,
  maxMP: number,
): { movementPointsAvailable: number; actionsAvailable: number } {
  const pool = Math.max(1, maxMP);
  const mp = Math.max(0, Math.floor(unit.movementPointsAvailable));
  const actions = unit.actionsAvailable;
  const total = mp + Math.max(0, actions) * pool;

  if (cost <= total) {
    const leftover = total - cost;
    return {
      movementPointsAvailable: leftover % pool,
      actionsAvailable: Math.floor(leftover / pool),
    };
  }

  // Over-budget soft enforcement: spend all materialized MP, then each full pool
  // costs one action (may go negative).
  const needed = cost - mp;
  const actionsSpent = Math.ceil(needed / pool);
  const remainder = needed % pool;
  return {
    movementPointsAvailable: remainder === 0 ? 0 : pool - remainder,
    actionsAvailable: actions - actionsSpent,
  };
}

/**
 * Accounting for a single MP spend (rotate, attach/detach hero).
 * When MP is insufficient and an action remains, the action converts to a full MP
 * pool (refill to max) before the spend is subtracted.
 */
export function applyMpSpend(
  unit: MpBudget,
  spend: number,
  maxMP: number,
): { movementPointsAvailable: number; actionsAvailable: number } {
  const pool = Math.max(1, maxMP);
  if (unit.movementPointsAvailable >= spend) {
    return {
      movementPointsAvailable: unit.movementPointsAvailable - spend,
      actionsAvailable: unit.actionsAvailable,
    };
  }
  if (unit.actionsAvailable >= 1) {
    return {
      movementPointsAvailable: pool - spend,
      actionsAvailable: unit.actionsAvailable - 1,
    };
  }
  return {
    movementPointsAvailable: unit.movementPointsAvailable - spend,
    actionsAvailable: unit.actionsAvailable,
  };
}

/** A move is affordable when the refill accounting does not go negative on actions. */
export function isMoveAffordable(unit: MpBudget, cost: number, maxMP: number): boolean {
  return applyMoveCost(unit, cost, maxMP).actionsAvailable >= 0;
}

// ---------------------------------------------------------------------------
// Hero movement: 5 actions = 1 full movement, prorated.
// Each converted action grants maxMP/5 MP (1 decimal). Fractions carry across
// conversions (e.g. maxMP 3 → 0.6 → 1.2 → 1.8 → 2.4 → 3.0) and the display
// floors them. All hero movement MP comes from conversion — heroes never get
// the unit rule's "1 action = 1 full pool".
// ---------------------------------------------------------------------------

/** Round MP to 1 decimal place (integer costs stay exact; no FP drift). */
function roundMp(v: number): number {
  return Math.round(v * 10) / 10;
}

/** MP granted per converted hero action: maxMP / 5, rounded to 1 decimal. */
export function heroMovePerAction(maxMP: number): number {
  return roundMp(Math.max(1, maxMP) / 5);
}

/** Hero move budget: materialized (fractional) MP + every unconverted action at the prorated rate. */
export function computeHeroMoveBudget(unit: MpBudget, maxMP: number): number {
  const per = heroMovePerAction(maxMP);
  return roundMp(Math.max(0, unit.movementPointsAvailable) + Math.max(0, unit.actionsAvailable) * per);
}

/**
 * Hero pool for the drag overlay = the CURRENT move's budget, mirroring the
 * unit rule (`computeMovePool`): a token can only enter a hex it can pay the
 * full 1 MP for — same rule for units, heroes, and ships. So the shade is
 * FLOORED payable MP: leftover MP that can pay whole hexes drives it (capped
 * at one full move); a leftover fraction below one hex doesn't dominate, but
 * still CARRIES into the conversion total (mp + actions × maxMP/5), floored
 * at the end. With no actions left a fraction can't pay a hex → 0. Always
 * capped at one full move (never a second move's worth); converting actions
 * beyond the current move flows through the soft-enforcement confirm, not the
 * highlight.
 */
export function computeHeroMovePool(unit: MpBudget, maxMP: number): number {
  const pool = Math.max(1, maxMP);
  const mp = Math.max(0, unit.movementPointsAvailable);
  if (mp >= 1) return Math.min(pool, Math.floor(mp));
  const actions = Math.max(0, unit.actionsAvailable);
  if (actions === 0) return 0;
  return Math.min(pool, Math.floor(mp + actions * heroMovePerAction(maxMP)));
}

/**
 * Executed MP/action accounting for a hero move of the given path cost.
 * Spends materialized MP first; each shortfall converts ceil((cost − MP)/per)
 * actions at the prorated rate (may go negative — soft enforcement). The
 * unconverted fraction carries over (rounded to 1 decimal).
 */
export function applyHeroMoveCost(
  unit: MpBudget,
  cost: number,
  maxMP: number,
): { movementPointsAvailable: number; actionsAvailable: number } {
  const per = heroMovePerAction(maxMP);
  const mp = Math.max(0, unit.movementPointsAvailable);
  if (cost <= mp) {
    return { movementPointsAvailable: roundMp(mp - cost), actionsAvailable: unit.actionsAvailable };
  }
  const need = cost - mp;
  const actionsSpent = Math.ceil(need / per);
  const newMp = roundMp(mp + actionsSpent * per - cost);
  return { movementPointsAvailable: newMp, actionsAvailable: unit.actionsAvailable - actionsSpent };
}

/** A hero move is affordable when the conversion does not go negative on actions. */
export function isHeroMoveAffordable(unit: MpBudget, cost: number, maxMP: number): boolean {
  return applyHeroMoveCost(unit, cost, maxMP).actionsAvailable >= 0;
}

/** True hero move capacity: materialized MP + every unconverted action at the prorated rate. */
export function computeHeroMoveCapacity(unit: MpBudget, maxMP: number): number {
  return computeHeroMoveBudget(unit, maxMP);
}

/**
 * Single-MP spend for a hero (attach/detach/swap). Spends materialized MP;
 * when insufficient, converts ceil((spend − MP)/per) actions at the prorated
 * rate to cover it (may go negative — the UI asks first).
 */
export function applyHeroMpSpend(
  unit: MpBudget,
  spend: number,
  maxMP: number,
): { movementPointsAvailable: number; actionsAvailable: number } {
  const per = heroMovePerAction(maxMP);
  const mp = Math.max(0, unit.movementPointsAvailable);
  if (mp >= spend) {
    return { movementPointsAvailable: roundMp(mp - spend), actionsAvailable: unit.actionsAvailable };
  }
  const need = spend - mp;
  const actionsSpent = Math.ceil(need / per);
  return {
    movementPointsAvailable: roundMp(mp + actionsSpent * per - spend),
    actionsAvailable: unit.actionsAvailable - actionsSpent,
  };
}

/**
 * Pool available for the current move. MP is only materialized when a move
 * converts an action: a unit with NO MP on hand and an action remaining can
 * move a full pool; once MP is on hand the highlight reflects exactly that
 * leftover MP (an action only refills a fresh pool after the current MP is
 * exhausted). With 0 actions it can only use leftover MP (no conversion).
 */
export function computeMovePool(unit: MpBudget, maxMP: number): number {
  const pool = Math.max(1, maxMP);
  if (unit.movementPointsAvailable <= 0 && unit.actionsAvailable >= 1) return pool;
  return Math.min(pool, Math.max(0, Math.floor(unit.movementPointsAvailable)));
}

/**
 * True remaining move capacity: materialized MP plus every unconverted action
 * as a full pool. Unlike `computeMoveBudget`, this does NOT fudge a spare pool
 * when actions are 0 — a unit with 0 MP and 0 actions has zero capacity. Used
 * to bound a combined host+attached-hero move by the lower of the two.
 */
export function computeMoveCapacity(unit: MpBudget, maxMP: number): number {
  const pool = Math.max(1, maxMP);
  return Math.max(0, Math.floor(unit.movementPointsAvailable)) + Math.max(0, unit.actionsAvailable) * pool;
}

function key(q: number, r: number): string {
  return `${q},${r}`;
}

/**
 * Charge corridor for a charging unit: a front-arc BFS wedge. Each step moves into
 * one of the two front-arc hexes (relative to the fixed facing — no turning), up to
 * `maxHexes` (the unit's one-action MP pool). An occupied hex blocks the lane (cannot
 * be entered or passed through). Returns hex key -> step cost (1..maxHexes).
 *
 * Geometry: facing 0 (front dirs (0,-1),(1,-1)) from the origin fans out as
 * 1 hex -> 2 hexes, 2 hexes -> 3, 3 -> 4, etc. Only formed (non-loose) units can
 * charge; Scattered/Routed/Hero cannot.
 */
export function computeChargeReachable(
  unit: { hex: Hex; facing: number },
  occupied: Set<string>,
  maxHexes = 2,
  costOfHex?: CostOfHexFn,
  blockedEdge?: BlockedEdgeFn,
): Map<string, number> {
  const result = new Map<string, number>();
  const frontDirs = frontArcIndices(unit.facing);

  const visited = new Set<string>([key(unit.hex.q, unit.hex.r)]);
  const queue: { q: number; r: number; cost: number }[] = [
    { q: unit.hex.q, r: unit.hex.r, cost: 0 },
  ];

  while (queue.length > 0) {
    const cur = queue.shift()!;
    if (cur.cost >= maxHexes) continue;
    for (const dirIdx of frontDirs) {
      const dir = HEX_DIRS[dirIdx];
      const nq = cur.q + dir.q;
      const nr = cur.r + dir.r;
      const k = key(nq, nr);
      if (visited.has(k) || occupied.has(k)) continue;
      if (blockedEdge && blockedEdge(cur.q, cur.r, nq, nr)) continue;
      // A charge cannot enter OR pass through broken terrain (painted MP cost > 1).
      if (costOfHex && (costOfHex(nq, nr, cur.q, cur.r) ?? 1) > 1) continue;
      visited.add(k);
      const cost = cur.cost + 1;
      result.set(k, cost);
      queue.push({ q: nq, r: nr, cost });
    }
  }
  return result;
}

/**
 * Reachable map for one move.
 *
 * Movement costs MP per hex ENTERED — normally 1 MP per hex, but a hex may cost
 * more via `costOfHex` (painted terrain, e.g. difficult ground at 2+ MP). Turning
 * is paid separately when the unit actually rotates (a ROTATE command). So:
 *   - WHITE entries (needsTurn false): reachable straight ahead from the current
 *     facing, cost = cheapest entry-cost path. These are droppable.
 *   - GREY entries (needsTurn true): reachable only if the unit could turn for
 *     free — a hint that it must rotate first, then move. Not droppable.
 *
 * Threat hexes are reachable but cannot be passed through. Occupied hexes are
 * never reachable. Routed / Scattered / Hero units move in any direction (no
 * facing) — always white.
 *
 * When `org` is supplied, a `max_org_level_allowed` gate (edge/hex structure or
 * ground zone) BREAKS the formation mid-move at the exact crossing point: the
 * state carries the formation, and the movement budget (MP and hex-step cap)
 * rescales by the formation's movement multiplier. The result carries
 * `finalFormation` so the caller can apply the break.
 */
export function computeReachableMap(
  unit: { hex: Hex; facing: number; currentFormation: string; movementPoints?: number; isHero?: boolean; mountId?: string | null; mountName?: string },
  maxMP: number,
  occupied: Set<string>,
  threatHexes: Set<string>,
  costOfHex?: CostOfHexFn,
  /** When true, keep hexes whose entry path COST exceeds maxMP (the unit can't
   *  pay, but soft enforcement may still be asked to move there). The hex-STEP
   *  cap (maxMP) always applies, so reach stays physically bounded. Default
   *  false keeps today's payable-only behavior (overlay highlight). */
  allowBeyondBudget?: boolean,
  /** Optional: impassable edges (walls authored as blocks). */
  blockedEdge?: BlockedEdgeFn,
  /** Physical hex-step cap. Defaults to `maxMP`. Option 2 of the movement
   *  economy: pass the pooled multi-action `maxMP` as the MP budget while keeping
   *  `hopCap` at one pool, so an expensive single step is selectable without
   *  extending normal one-move distance. */
  hopCap?: number,
  /** Occupied hexes that may be TRAVERSED (entered for pathing, but never
   *  returned as a result) — an open-door hex structure underfoot. */
  passThrough?: Set<string>,
  /** Optional org-gate context (breaks + budget rescale). */
  org?: OrgMoveOpts,
): Map<string, MovePathEntry> {
  const stepCap = hopCap ?? maxMP;
  const isPass = (k: string): boolean => passThrough?.has(k) ?? false;
  const breakOnEntry = org?.breakOnEntry;
  const multipliers = org?.movementMultipliers;
  const baseMove = unit.movementPoints ?? maxMP;

  // The movement multiplier rescales the pool per formation (a break only ever
  // raises the multiplier — ×0.5 → ×1 → ×1.5 — so the budget only grows).
  const maxMpOf = (f: string): number => Math.max(1, Math.floor(baseMove * (multipliers?.[f] ?? 1)));
  const initialMax = maxMpOf(unit.currentFormation);
  const scaleOf = (f: string): number => (initialMax > 0 ? maxMpOf(f) / initialMax : 1);
  const budgetOf = (f: string): number => maxMP * scaleOf(f);
  const stepCapOf = (f: string): number => Math.ceil(stepCap * scaleOf(f));

  const isLoose = (f: string): boolean => f === 'Scattered' || f === 'Routed' || f === 'Hero';
  const isMounted = !!unit.mountId || !!unit.mountName;
  const aboutTurnCost = isMounted
    ? getSetting('about_turn_cost_mounted', 2)
    : getSetting('about_turn_cost_foot', 1);
  const aboutTurnBlocked = (f: string): boolean => isMounted && f === 'Close Order';

  // MP to ENTER hex (q,r). Defaults to 1; a painted 0 = free entry; clamps only
  // negative/garbage to 1. `fromQ/fromR` let a wall face REPLACE the entry cost.
  const stepCost = (q: number, r: number, fromQ: number, fromR: number): number => {
    if (!costOfHex) return 1;
    const c = Math.round(costOfHex(q, r, fromQ, fromR) ?? 1);
    return Number.isFinite(c) && c >= 0 ? c : 1;
  };

  // Linear pop-min over a small state space (bounded by maxMP hexes).
  const popMin = <T extends { d: number }>(list: T[]): T => {
    let best = 0;
    for (let i = 1; i < list.length; i++) {
      if (list[i].d < list[best].d) best = i;
    }
    return list.splice(best, 1)[0];
  };

  // Better when strictly cheaper, or same cost with fewer hex-steps.
  const improves = (bestCost: number | undefined, bestHops: number | undefined, cost: number, hops: number): boolean =>
    bestCost === undefined || cost < bestCost || (cost === bestCost && hops < (bestHops ?? Infinity));

  type State = {
    q: number; r: number; facing: number; formation: string; turned: boolean; d: number; hops: number; path: Hex[];
  };
  const stateKeyOf = (s: State): string => `${s.q},${s.r},${s.facing},${s.formation},${s.turned ? 1 : 0}`;
  const start: State = {
    q: unit.hex.q, r: unit.hex.r, facing: unit.facing, formation: unit.currentFormation,
    turned: false, d: 0, hops: 0, path: [],
  };

  const best = new Map<string, { cost: number; hops: number }>();
  const queue: State[] = [];
  const push = (s: State): void => {
    const k = stateKeyOf(s);
    const cur = best.get(k);
    if (!improves(cur?.cost, cur?.hops, s.d, s.hops)) return;
    best.set(k, { cost: s.d, hops: s.hops });
    queue.push(s);
  };
  push(start);

  // Best white (no turn) / grey (turned) entry per hex.
  const whiteBest = new Map<string, State>();
  const greyBest = new Map<string, State>();
  const consider = (s: State): void => {
    if (s.q === unit.hex.q && s.r === unit.hex.r) return;
    const k = key(s.q, s.r);
    if (isPass(k)) return;
    const map = s.turned ? greyBest : whiteBest;
    const cur = map.get(k);
    if (improves(cur?.d, cur?.hops, s.d, s.hops)) map.set(k, s);
  };

  while (queue.length > 0) {
    const cur = popMin(queue);
    const k = stateKeyOf(cur);
    const known = best.get(k);
    if (!known || cur.d !== known.cost || cur.hops !== known.hops) continue; // stale entry
    consider(cur);
    const looseHere = isLoose(cur.formation);
    if ((!allowBeyondBudget && cur.d >= budgetOf(cur.formation)) || cur.hops >= stepCapOf(cur.formation)) continue;
    if (threatHexes.has(key(cur.q, cur.r))) continue; // can stop here, not pass through

    // Forward moves (omnidirectional when loose, front wedge when formed).
    const dirs = looseHere
      ? HEX_DIRS
      : frontArcIndices(cur.facing).map(i => HEX_DIRS[i]);
    for (const dir of dirs) {
      const nq = cur.q + dir.q;
      const nr = cur.r + dir.r;
      const nk = key(nq, nr);
      if (occupied.has(nk) && !isPass(nk)) continue;
      if (blockedEdge && blockedEdge(cur.q, cur.r, nq, nr)) continue;
      const nc = cur.d + stepCost(nq, nr, cur.q, cur.r);
      const nf = breakOnEntry ? (breakOnEntry(cur.q, cur.r, nq, nr, cur.formation) ?? cur.formation) : cur.formation;
      const nh = cur.hops + 1;
      if ((!allowBeyondBudget && nc > budgetOf(nf)) || nh > stepCapOf(nf)) continue;
      push({ q: nq, r: nr, facing: cur.facing, formation: nf, turned: cur.turned, d: nc, hops: nh, path: [...cur.path, { q: nq, r: nr, s: -nq - nr }] });
    }

    // Turns: 60° ±1 (1 MP each) and a 180° about-turn (setting cost). Formed
    // units only; loose move omnidirectionally and never turn.
    if (!looseHere) {
      const blockedFacing = aboutTurnBlocked(cur.formation) ? (unit.facing + 3) % 6 : -1;
      for (const nf of [(cur.facing + 5) % 6, (cur.facing + 1) % 6]) {
        if (nf === blockedFacing) continue;
        push({ ...cur, facing: nf, turned: true, d: cur.d + 1 });
      }
      if (!aboutTurnBlocked(cur.formation)) {
        push({ ...cur, facing: (cur.facing + 3) % 6, turned: true, d: cur.d + aboutTurnCost });
      }
    }
  }

  const result = new Map<string, MovePathEntry>();
  const toEntry = (s: State, needsTurn: boolean): MovePathEntry => ({
    cost: s.d,
    path: needsTurn ? [] : s.path,
    finalFacing: s.facing,
    needsTurn,
    ...(s.formation !== unit.currentFormation ? { finalFormation: s.formation } : {}),
  });
  greyBest.forEach((s, k) => {
    if (whiteBest.has(k)) return;
    result.set(k, toEntry(s, true));
  });
  whiteBest.forEach((s, k) => {
    result.set(k, toEntry(s, false));
  });
  return result;
}
