// src/packages/ships/lib/shipMoveCost.ts
// Pure ship movement math: speed declaration, per-step budgets, MC facing gate,
// and a small (hex, facing, distance-since-turn) reachability search. Movement
// pools mirror units: land MP (ground), FP (atmosphere airborne), speed (space).

import { Hex, hexDistance } from '@/types/gameProtocol';
import { HEX_DIRS } from '@/packages/primitives';
import { MCBand, ShipDerivedStats } from './shipStats';

export const SHIP_MAX_SPEED = 12;
export const SHIP_MIN_SPEED = 0;

/** The effective MC for a speed, from the derived speed bands. */
export function effectiveMCForSpeed(stats: Pick<ShipDerivedStats, 'mcBands'> | null | undefined, speed: number): number {
  const bands: MCBand[] = stats?.mcBands ?? [];
  const speedInt = Math.max(0, Math.min(SHIP_MAX_SPEED, Math.floor(speed)));
  const band = bands.find(b => speedInt >= b.speedMin && speedInt <= b.speedMax) ?? bands[bands.length - 1];
  return Math.max(0, Math.ceil(band?.mc ?? 0));
}

/** Hexes the ship must travel between facing changes. */
export function facingChangeDistance(stats: Pick<ShipDerivedStats, 'mcBands'> | null | undefined, speed: number): number {
  return effectiveMCForSpeed(stats, speed);
}

export type ShipMoveMode = 'atmosphere' | 'wildspace';

/**
 * Gameplay MC. Wildspace reads the three speed bands. Atmosphere uses the
 * single base MC (`mcRaw`) because its speed is fixed and the wildspace band
 * modifier does not apply there.
 */
export function shipMC(
  stats: Pick<ShipDerivedStats, 'mcBands' | 'mcRaw'> | null | undefined,
  speed: number,
  mode: ShipMoveMode,
): number {
  const base = mode === 'atmosphere'
    ? Math.max(0, Math.ceil(Number(stats?.mcRaw ?? 0)))
    : effectiveMCForSpeed(stats, speed);
  return Number.isFinite(base) ? base : Number.POSITIVE_INFINITY;
}

/** MC turn gate after the rudder trim, using the mode's single MC rule. */
export function shipTurnDistance(
  stats: Pick<ShipDerivedStats, 'mcBands' | 'mcRaw'> | null | undefined,
  speed: number,
  mode: ShipMoveMode,
  mcReduction = 0,
): number {
  const base = shipMC(stats, speed, mode);
  if (!Number.isFinite(base)) return Number.POSITIVE_INFINITY;
  return Math.max(0, base - Math.max(0, Math.floor(mcReduction)));
}

/** Canvas rotation for a ship facing (0 = nose north, +1 = 60° clockwise). */
export function shipFacingRadians(facing: number | null | undefined): number {
  const step = ((Math.floor(Number(facing) || 0) % 6) + 6) % 6;
  return (step * Math.PI) / 3;
}

/** MC for the turn after the rudder trim (never below 0). */
export function effectiveTurnDistance(
  stats: Pick<ShipDerivedStats, 'mcBands'> | null | undefined,
  speed: number,
  mcReduction = 0,
): number {
  return Math.max(0, facingChangeDistance(stats, speed) - Math.max(0, Math.floor(mcReduction)));
}

/** Spell-slot cost of buying extra speed hexes: |hexes| × max(1, round(mass/10)). */
export function spellSlotCostForHexes(extraHexes: number, mass: number): number {
  return Math.abs(Math.trunc(extraHexes)) * Math.max(1, Math.round((Number(mass) || 0) / 10));
}

/** Declared speed for a round. Free acceleration is capped by the derived accel. */
export function declareSpeed(args: {
  previousSpeed: number;
  accelDelta: number;
  extraHexes: number;
  acceleration: number;
  maxSpeed?: number;
}): number {
  const accel = Math.max(0, Math.floor(args.acceleration));
  const free = Math.max(-accel, Math.min(accel, Math.trunc(args.accelDelta)));
  const total = Math.trunc(args.previousSpeed) + free + Math.trunc(args.extraHexes);
  return Math.max(SHIP_MIN_SPEED, Math.min(args.maxSpeed ?? SHIP_MAX_SPEED, total));
}

/**
 * Apply a sail-speed delta to one step's budget. Soft clamp: the budget can
 * never drop below 0, but there is no upper clamp (a successful sail maxing may
 * push it above the usual 12; callers warn above 13).
 */
export function adjustStepBudget(stepBudget: number[] | undefined, step: number, delta: number): number[] {
  const next = Array.from({ length: 5 }, (_, i) =>
    Math.max(0, Math.floor(Number((stepBudget ?? [])[i] ?? 0))),
  );
  const idx = Math.max(0, Math.min(4, Math.floor(step) - 1));
  next[idx] = Math.max(0, next[idx] + Math.trunc(delta));
  return next;
}

/** Remaining movement this step (wildspace step budget minus already spent). */
export function shipStepRemaining(ship: {
  stepBudget?: number[];
  step?: number;
  speedSpent?: number;
}, step?: number): number {
  const s = Math.max(1, Math.min(5, Math.floor(step ?? ship.step ?? 1)));
  const budget = (ship.stepBudget ?? [])[s - 1] ?? 0;
  return Math.max(0, budget - (ship.speedSpent ?? 0));
}

/** Remaining movement for the whole wildspace turn (current step + later steps). */
export function shipRoundRemaining(ship: {
  stepBudget?: number[];
  step?: number;
  speedSpent?: number;
}, step?: number): number {
  const s = Math.max(1, Math.min(5, Math.floor(step ?? ship.step ?? 1)));
  const budgets = ship.stepBudget ?? [];
  let total = shipStepRemaining(ship, s);
  for (let i = s; i < 5; i += 1) {
    total += Math.max(0, Math.floor(Number(budgets[i]) || 0));
  }
  return total;
}

/** Movement already spent this round = declared speed − remaining movement. */
export function shipRoundSpent(
  declaredSpeed: number,
  ship: { stepBudget?: number[]; step?: number; speedSpent?: number },
  step?: number,
): number {
  return Math.max(0, Math.floor(declaredSpeed) - shipRoundRemaining(ship, step));
}

/**
 * Rebuild the step budget after a speed change while preserving completed step
 * budgets and the current step's spend. Only the current and later budgets are
 * reallocated so the new whole-turn remaining equals `newSpeed - spent`.
 */
export function rebuildStepBudgetPreservingMoved(args: {
  newSpeed: number;
  ship: { stepBudget?: number[]; step?: number; speedSpent?: number };
  step?: number;
}): number[] {
  const s = Math.max(1, Math.min(5, Math.floor(args.step ?? args.ship.step ?? 1)));
  const old = Array.from({ length: 5 }, (_, i) =>
    Math.max(0, Math.floor(Number((args.ship.stepBudget ?? [])[i]) || 0)),
  );
  const past = old.slice(0, s - 1);
  const currentSpent = Math.max(0, Math.floor(args.ship.speedSpent ?? 0));
  const pastMoved = past.reduce((sum, value) => sum + value, 0);
  const remaining = Math.max(0, Math.floor(args.newSpeed) - pastMoved - currentSpent);
  const stepsLeft = 6 - s;
  const allocations: number[] = [];
  let prev = 0;
  for (let i = 1; i <= stepsLeft; i += 1) {
    const cum = Math.round((remaining * i) / stepsLeft);
    allocations.push(cum - prev);
    prev = cum;
  }
  const currentBudget = currentSpent + (allocations[0] ?? 0);
  return [...past, currentBudget, ...allocations.slice(1)];
}

export interface ShipReachEntry {
  cost: number;
  path: Hex[];
  finalFacing: number;
  /** Hexes travelled since the last facing change (capped at the MC gate). */
  distanceSinceFacing: number;
  /** False when the hex is occupied (ships may pass through but not stop). */
  endable: boolean;
}

export interface ShipReachOpts {
  /** Hexes/edges that cannot be entered (structures, obstacles). */
  blocked?: (q: number, r: number) => boolean;
  /** Occupied hexes may be passed through but not ended on. */
  occupied?: Set<string>;
  /** Cannot end on this hex (e.g. the mover's own current hex is fine). */
  forwardOnly?: boolean;
}

const keyOf = (h: Hex) => `${h.q},${h.r}`;
const stateKey = (h: Hex, facing: number, dist: number) => `${h.q},${h.r},${facing},${dist}`;

function add(h: Hex, d: Hex): Hex {
  const q = h.q + d.q;
  const r = h.r + d.r;
  return { q, r, s: -q - r };
}

/**
 * Reachable ship hexes for a movement pool. Movement is one hex straight ahead
 * (front two arcs, like a formed unit); a 60° turn costs 1 pool point and is
 * gated by the MC distance since the previous turn. MC 0 turns freely.
 */
export function computeShipReachable(
  start: { hex: Hex; facing: number; turnsSinceFacing?: number },
  maxPool: number,
  turnDistance: number,
  opts: ShipReachOpts = {},
): Map<string, ShipReachEntry> {
  const pool = Math.max(0, Math.floor(maxPool));
  const requirement = Math.max(0, Math.floor(turnDistance));
  const occupied = opts.occupied ?? new Set<string>();
  const best = new Map<string, { cost: number; path: Hex[]; facing: number; dist: number }>();
  const startDist = Math.min(requirement, Math.max(0, Math.floor(start.turnsSinceFacing ?? 0)));
  const startKey = stateKey(start.hex, start.facing, startDist);
  best.set(startKey, { cost: 0, path: [start.hex], facing: start.facing, dist: startDist });

  const queue: { hex: Hex; facing: number; dist: number; cost: number; path: Hex[] }[] = [
    { hex: start.hex, facing: start.facing, dist: startDist, cost: 0, path: [start.hex] },
  ];

  const push = (hex: Hex, facing: number, dist: number, cost: number, path: Hex[]) => {
    if (cost > pool) return;
    if (opts.blocked && opts.blocked(hex.q, hex.r)) return;
    const capped = Math.min(requirement, dist);
    const k = stateKey(hex, facing, capped);
    const prev = best.get(k);
    if (prev && prev.cost <= cost) return;
    best.set(k, { cost, path, facing, dist: capped });
    queue.push({ hex, facing, dist: capped, cost, path });
  };

  while (queue.length > 0) {
    // Small state space: pick the cheapest queued state (Dijkstra).
    let minIdx = 0;
    for (let i = 1; i < queue.length; i += 1) if (queue[i].cost < queue[minIdx].cost) minIdx = i;
    const cur = queue.splice(minIdx, 1)[0];

    // Turn left/right (1 pool point), allowed once the MC distance is met.
    if (requirement === 0 || cur.dist >= requirement) {
      for (const delta of [-1, 1]) {
        const nf = ((cur.facing + delta) % 6 + 6) % 6;
        push(cur.hex, nf, 0, cur.cost + 1, cur.path);
      }
    }

    // Move forward into the two front-arc hexes.
    for (const delta of [4, 5]) {
      const dir = (cur.facing + delta) % 6;
      const next = add(cur.hex, HEX_DIRS[dir]);
      push(next, cur.facing, cur.dist + 1, cur.cost + 1, [...cur.path, next]);
    }
  }

  // Collapse states to the best entry per hex.
  const out = new Map<string, ShipReachEntry>();
  for (const state of Array.from(best.values())) {
    const hk = keyOf(state.path[state.path.length - 1]);
    const prev = out.get(hk);
    const endable = !occupied.has(hk) || hk === keyOf(start.hex);
    if (!prev || state.cost < prev.cost || (state.cost === prev.cost && state.dist > 0)) {
      out.set(hk, {
        cost: state.cost,
        path: state.path,
        finalFacing: state.facing,
        distanceSinceFacing: state.dist,
        endable,
      });
    }
  }
  return out;
}

/** Manhattan-ish hex distance re-export for callers (kept local to the package). */
export function shipHexDistance(a: Hex, b: Hex): number {
  return hexDistance(a, b);
}
