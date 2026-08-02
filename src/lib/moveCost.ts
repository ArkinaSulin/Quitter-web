import { Hex, Unit } from '@/types/gameProtocol';

export interface MovePathEntry {
  cost: number;
  path: Hex[];
  finalFacing: number;
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
 * Single-source BFS over (hex, facing) for formed units:
 *   - entering a hex from the front arc costs 1 MP
 *   - each 60° turn costs 1 MP
 * Threat hexes are reachable but cannot be passed through. Occupied hexes are
 * never reachable.
 *
 * Routed / Scattered / Hero units move in any direction at 1 MP per hex (no facing).
 *
 * Returns the minimum-cost path to every reachable hex keyed by "q,r".
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
        };
        result.set(k, entry);
        if (!threatHexes.has(k)) {
          queue.push({ q: nq, r: nr, dist: cur.dist + 1, path: entry.path });
        }
      }
    }
    return result;
  }

  const visited = new Set<string>();
  const queue: { q: number; r: number; facing: number; mpUsed: number; path: Hex[] }[] = [];
  queue.push({ q: unit.hex.q, r: unit.hex.r, facing: unit.facing, mpUsed: 0, path: [] });
  visited.add(`${unit.hex.q},${unit.hex.r},${unit.facing}`);

  while (queue.length > 0) {
    const cur = queue.shift()!;
    if (cur.mpUsed >= maxMP) continue;

    const frontDirs = [(cur.facing + 4) % 6, (cur.facing + 5) % 6];
    for (const dirIdx of frontDirs) {
      const dir = HEX_DIRS[dirIdx];
      const nq = cur.q + dir.q;
      const nr = cur.r + dir.r;
      const k = key(nq, nr);
      if (occupied.has(k)) continue;
      const stateKey = `${nq},${nr},${cur.facing}`;
      if (visited.has(stateKey)) continue;
      visited.add(stateKey);
      const entry: MovePathEntry = {
        cost: cur.mpUsed + 1,
        path: [...cur.path, { q: nq, r: nr, s: -nq - nr }],
        finalFacing: cur.facing,
      };
      if (!result.has(k)) result.set(k, entry);
      if (!threatHexes.has(k)) {
        queue.push({ q: nq, r: nr, facing: cur.facing, mpUsed: cur.mpUsed + 1, path: entry.path });
      }
    }

    for (const newFacing of [(cur.facing + 5) % 6, (cur.facing + 1) % 6]) {
      const stateKey = `${cur.q},${cur.r},${newFacing}`;
      if (visited.has(stateKey)) continue;
      visited.add(stateKey);
      queue.push({ q: cur.q, r: cur.r, facing: newFacing, mpUsed: cur.mpUsed + 1, path: cur.path });
    }
  }

  return result;
}
