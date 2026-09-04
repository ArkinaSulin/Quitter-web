import { Hex, Unit } from '@/types/gameProtocol';
import { getSetting } from '@/lib/settingsCache';
import { isUnitRouted } from '@/lib/unitMorale';

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
}

type MpBudget = Pick<Unit, 'movementPointsAvailable' | 'actionsAvailable'>;

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

const HEX_DIRS = [
  { q: 1, r: 0 },
  { q: 0, r: 1 },
  { q: -1, r: 1 },
  { q: -1, r: 0 },
  { q: 0, r: -1 },
  { q: 1, r: -1 },
];

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
): Map<string, number> {
  const result = new Map<string, number>();
  const frontDirs = [(unit.facing + 4) % 6, (unit.facing + 5) % 6];

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
 * facing) — always white. All three passes are min-cost Dijkstras so a cheaper
 * later path can revisit a hex (required once entry costs are non-uniform).
 */
export function computeReachableMap(
  unit: { hex: Hex; facing: number; currentFormation: string; isHero?: boolean; mountId?: string | null; mountName?: string },
  maxMP: number,
  occupied: Set<string>,
  threatHexes: Set<string>,
  costOfHex?: (q: number, r: number) => number,
): Map<string, MovePathEntry> {
  // MP to ENTER hex (q,r). Defaults to 1; a painted 0 = free entry; clamps only
  // negative/garbage to 1.
  const stepCost = (q: number, r: number): number => {
    if (!costOfHex) return 1;
    const c = Math.round(costOfHex(q, r) ?? 1);
    return Number.isFinite(c) && c >= 0 ? c : 1;
  };

  const result = new Map<string, MovePathEntry>();
  const loose = isUnitRouted(unit) || unit.currentFormation === 'Scattered' || unit.currentFormation === 'Hero' || unit.isHero === true;

  // Linear pop-min over a small state space (bounded by maxMP hexes).
  const popMin = <T extends { d: number }>(list: T[]): T => {
    let best = 0;
    for (let i = 1; i < list.length; i++) {
      if (list[i].d < list[best].d) best = i;
    }
    return list.splice(best, 1)[0];
  };

  // Better when strictly cheaper, or same cost with fewer hex-steps (a 0-cost
  // chain still spends one "hop" per hex, so maxMP bounds hex COUNT not just MP).
  const improves = (bestCost: number | undefined, bestHops: number | undefined, cost: number, hops: number): boolean =>
    bestCost === undefined || cost < bestCost || (cost === bestCost && hops < (bestHops ?? Infinity));

  // Omnidirectional (loose) or forward-wedge pass: both pay entry cost + one hop
  // per hex entered; reachable hexes are capped by maxMP MP AND maxMP hex-steps.
  const walk = (dirs: { q: number; r: number }[]): Map<string, MovePathEntry> => {
    const out = new Map<string, MovePathEntry>();
    const bestCost = new Map<string, number>();
    const bestHops = new Map<string, number>();
    const queue: { q: number; r: number; d: number; hops: number; path: Hex[] }[] = [];
    queue.push({ q: unit.hex.q, r: unit.hex.r, d: 0, hops: 0, path: [] });
    const originKey = key(unit.hex.q, unit.hex.r);
    bestCost.set(originKey, 0);
    bestHops.set(originKey, 0);
    while (queue.length > 0) {
      const cur = popMin(queue);
      if (cur.d > (bestCost.get(key(cur.q, cur.r)) ?? Infinity)) continue;
      if (cur.hops >= maxMP) continue; // reachable at the step cap, not expandable past it
      for (const dir of dirs) {
        const nq = cur.q + dir.q;
        const nr = cur.r + dir.r;
        const k = key(nq, nr);
        if (occupied.has(k)) continue;
        const nc = cur.d + stepCost(nq, nr);
        const nh = cur.hops + 1;
        if (nc > maxMP || nh > maxMP) continue;
        if (!improves(bestCost.get(k), bestHops.get(k), nc, nh)) continue;
        bestCost.set(k, nc);
        bestHops.set(k, nh);
        const path = [...cur.path, { q: nq, r: nr, s: -nq - nr }];
        out.set(k, { cost: nc, path, finalFacing: unit.facing, needsTurn: false });
        if (!threatHexes.has(k)) queue.push({ q: nq, r: nr, d: nc, hops: nh, path });
      }
    }
    return out;
  };

  if (loose) {
    return walk(HEX_DIRS);
  }

  // WHITE set: the full front wedge reachable WITHOUT turning — at each step the
  // unit moves into either front-arc hex and keeps its facing. The wedge (not
  // just the two edge rays) is straight-ahead reachable, so every interior hex
  // is droppable. Cost = cheapest entry-cost path through the wedge.
  const frontDirs = [(unit.facing + 4) % 6, (unit.facing + 5) % 6];
  const frontHexDirs = frontDirs.map(i => HEX_DIRS[i]);
  const white = walk(frontHexDirs);

  // GREY set (hint): hexes reachable only by turning, shown as a lighter-shade
  // cone. Steps and 60° turns each cost 1 MP; a 180° about-turn is a single
  // maneuver charged per settings (mounted units pay more) and is BLOCKED for
  // mounted units in Close Order. Entries are never droppable (the unit must
  // rotate first); they exist only as a hint.
  const isMounted = !!unit.mountId || !!unit.mountName;
  const aboutTurnCost = isMounted
    ? getSetting('about_turn_cost_mounted', 2)
    : getSetting('about_turn_cost_foot', 1);
  // Mounted units in Close Order are "unable to turn around" — they can never
  // face directly rearward (180° from the start facing), by any turn path.
  const aboutTurnBlocked = isMounted && unit.currentFormation === 'Close Order';
  const blockedFacing = aboutTurnBlocked ? (unit.facing + 3) % 6 : -1;

  const INF = Number.MAX_SAFE_INTEGER;
  type GreyState = { cost: number; hops: number };
  const distMap = new Map<string, GreyState>(); // "q,r,facing" -> min (cost, hops)
  const startKey = `${unit.hex.q},${unit.hex.r},${unit.facing}`;
  distMap.set(startKey, { cost: 0, hops: 0 });
  // Small state space (hexes within maxMP × 6 facings) — plain Dijkstra.
  const pq: { q: number; r: number; facing: number; d: number; hops: number }[] = [
    { q: unit.hex.q, r: unit.hex.r, facing: unit.facing, d: 0, hops: 0 },
  ];
  const relax = (q: number, r: number, facing: number, cost: number, hops: number) => {
    if (facing === blockedFacing) return;
    const nk = `${q},${r},${facing}`;
    const cur = distMap.get(nk);
    if (improves(cur?.cost, cur?.hops, cost, hops)) {
      distMap.set(nk, { cost, hops });
      pq.push({ q, r, facing, d: cost, hops });
    }
  };
  while (pq.length > 0) {
    const cur = popMin(pq);
    const curKey = `${cur.q},${cur.r},${cur.facing}`;
    const known = distMap.get(curKey);
    if (!known || cur.d !== known.cost || cur.hops !== known.hops) continue; // stale entry
    if (cur.d >= maxMP || cur.hops >= maxMP) continue;
    if (threatHexes.has(key(cur.q, cur.r))) continue; // can stop here, not pass through
    const cf = [(cur.facing + 4) % 6, (cur.facing + 5) % 6];
    for (const dirIdx of cf) {
      const dir = HEX_DIRS[dirIdx];
      const nq = cur.q + dir.q;
      const nr = cur.r + dir.r;
      if (occupied.has(key(nq, nr))) continue;
      const nc = cur.d + stepCost(nq, nr);
      if (nc <= maxMP && cur.hops + 1 <= maxMP) {
        relax(nq, nr, cur.facing, nc, cur.hops + 1);
      }
    }
    // 60° turns: ±1 facing, 1 MP each (no hop spent).
    for (const newFacing of [(cur.facing + 5) % 6, (cur.facing + 1) % 6]) {
      relax(cur.q, cur.r, newFacing, cur.d + 1, cur.hops);
    }
    // 180° about-turn: single maneuver at its setting cost (blocked when mounted
    // in Close Order). Covers both directions (±3 ≡ +3 mod 6).
    if (!aboutTurnBlocked) {
      relax(cur.q, cur.r, (cur.facing + 3) % 6, cur.d + aboutTurnCost, cur.hops);
    }
  }

  const ownKey = key(unit.hex.q, unit.hex.r);
  const grey = new Map<string, number>();
  distMap.forEach(({ cost }, sk) => {
    const hk = sk.split(',').slice(0, 2).join(',');
    if (hk === ownKey) return;
    if (cost < (grey.get(hk) ?? INF)) grey.set(hk, cost);
  });

  grey.forEach((d, k) => {
    if (white.has(k)) return;
    result.set(k, { cost: d, path: [], finalFacing: unit.facing, needsTurn: true });
  });
  white.forEach((entry, k) => {
    result.set(k, entry);
  });
  return result;
}
