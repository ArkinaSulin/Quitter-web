import { Hex, Unit } from '@/types/gameProtocol';

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

/**
 * Pool available for the current move. MP is only materialized when a move
 * converts an action, so a unit with actions ≥ 1 can move a full pool; with 0
 * actions it can only use leftover MP (no conversion).
 */
export function computeMovePool(unit: MpBudget, maxMP: number): number {
  const pool = Math.max(1, maxMP);
  if (unit.actionsAvailable >= 1) return pool;
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
 * Movement only costs distance (1 MP per hex); turning is paid separately when
 * the unit actually rotates (a ROTATE command). So:
 *   - WHITE entries (needsTurn false): reachable straight ahead from the current
 *     facing, cost = distance. These are droppable.
 *   - GREY entries (needsTurn true): reachable only if the unit could turn for
 *     free — a hint that it must rotate first, then move. Not droppable.
 *
 * Threat hexes are reachable but cannot be passed through. Occupied hexes are
 * never reachable. Routed / Scattered / Hero units move in any direction at 1 MP
 * per hex (no facing) — always white.
 */
export function computeReachableMap(
  unit: { hex: Hex; facing: number; isRouting: boolean; currentFormation: string; isHero?: boolean },
  maxMP: number,
  occupied: Set<string>,
  threatHexes: Set<string>,
): Map<string, MovePathEntry> {
  const result = new Map<string, MovePathEntry>();
  const loose = unit.isRouting || unit.currentFormation === 'Scattered' || unit.currentFormation === 'Hero' || unit.isHero === true;

  if (loose) {
    const visited = new Set<string>();
    const queue: { q: number; r: number; dist: number; path: Hex[] }[] = [];
    queue.push({ q: unit.hex.q, r: unit.hex.r, dist: 0, path: [] });
    visited.add(key(unit.hex.q, unit.hex.r));

    while (queue.length > 0) {
      const cur = queue.shift()!;
      if (cur.dist >= maxMP) continue;
      for (const dir of HEX_DIRS) {
        const nq = cur.q + dir.q;
        const nr = cur.r + dir.r;
        const k = key(nq, nr);
        if (visited.has(k) || occupied.has(k)) continue;
        visited.add(k);
        const entry: MovePathEntry = {
          cost: cur.dist + 1,
          path: [...cur.path, { q: nq, r: nr, s: -nq - nr }],
          finalFacing: unit.facing,
          needsTurn: false,
        };
        result.set(k, entry);
        if (!threatHexes.has(k)) {
          queue.push({ q: nq, r: nr, dist: cur.dist + 1, path: entry.path });
        }
      }
    }
    return result;
  }

  // WHITE set: the two straight front-arc rays from the current facing. A unit
  // steps forward keeping its facing; cost is pure distance.
  const white = new Map<string, MovePathEntry>();
  const frontDirs = [(unit.facing + 4) % 6, (unit.facing + 5) % 6];
  for (const dirIdx of frontDirs) {
    const dir = HEX_DIRS[dirIdx];
    let q = unit.hex.q;
    let r = unit.hex.r;
    const path: Hex[] = [];
    for (let d = 1; d <= maxMP; d++) {
      q += dir.q;
      r += dir.r;
      const k = key(q, r);
      if (occupied.has(k)) break;
      path.push({ q, r, s: -q - r });
      white.set(k, { cost: d, path: [...path], finalFacing: unit.facing, needsTurn: false });
      if (threatHexes.has(k)) break; // may stop here, cannot pass through
    }
  }

  // GREY set (hint): hexes reachable only by turning, shown as a front cone.
  // Turning costs the same as a step (1 MP per 60°), so the reachable-with-turns
  // area is a cone: straight ahead reaches the full pool, 60° off reaches pool−1,
  // 120° off pool−2, 180° (about-turn) pool−3. Simple BFS over (hex, facing) —
  // steps and turns both cost 1. Entries are never droppable (a unit must rotate
  // first); they exist only as a lighter-shade hint.
  const INF = Number.MAX_SAFE_INTEGER;
  const distMap = new Map<string, number>(); // "q,r,facing" -> min cost (steps + turns)
  distMap.set(`${unit.hex.q},${unit.hex.r},${unit.facing}`, 0);
  const deque: { q: number; r: number; facing: number; d: number }[] = [
    { q: unit.hex.q, r: unit.hex.r, facing: unit.facing, d: 0 },
  ];
  while (deque.length > 0) {
    const cur = deque.shift()!;
    const curKey = `${cur.q},${cur.r},${cur.facing}`;
    if (cur.d !== distMap.get(curKey)) continue; // stale entry
    if (cur.d >= maxMP) continue;
    if (threatHexes.has(key(cur.q, cur.r))) continue; // can stop here, not pass through
    const cf = [(cur.facing + 4) % 6, (cur.facing + 5) % 6];
    for (const dirIdx of cf) {
      const dir = HEX_DIRS[dirIdx];
      const nq = cur.q + dir.q;
      const nr = cur.r + dir.r;
      const nk = `${nq},${nr},${cur.facing}`;
      if (occupied.has(key(nq, nr))) continue;
      if (cur.d + 1 < (distMap.get(nk) ?? INF)) {
        distMap.set(nk, cur.d + 1);
        deque.push({ q: nq, r: nr, facing: cur.facing, d: cur.d + 1 });
      }
    }
    for (const newFacing of [(cur.facing + 5) % 6, (cur.facing + 1) % 6]) {
      const nk = `${cur.q},${cur.r},${newFacing}`;
      if (cur.d + 1 < (distMap.get(nk) ?? INF)) {
        distMap.set(nk, cur.d + 1);
        deque.push({ q: cur.q, r: cur.r, facing: newFacing, d: cur.d + 1 });
      }
    }
  }

  const ownKey = key(unit.hex.q, unit.hex.r);
  const grey = new Map<string, number>();
  distMap.forEach((d, sk) => {
    const hk = sk.split(',').slice(0, 2).join(',');
    if (hk === ownKey) return;
    if (d < (grey.get(hk) ?? INF)) grey.set(hk, d);
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
