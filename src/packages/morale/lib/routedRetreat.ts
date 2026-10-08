// src/packages/morale/lib/routedRetreat.ts
// Pure decision logic for routed-unit retreat. A routed unit retreats AWAY from
// the threat, pushing through friendly org <= 1 units (scattering Open Order ones)
// until it reaches an empty hex outside enemy kill zones. Pursuit is handled by
// `pursuit.ts` / `zocDisengage.ts`; this file owns the retreat geometry only;
// integration (chained ROUT/MOVE/FORMATION commands) lives in the map layer.

import { Unit, AllianceGroup, Formation, Hex, hexDistance, getOrganizationLevel } from '@/types/gameProtocol';
import { MapStructures } from '@/packages/movement';
import { StructureTemplate } from '@/types/structure';
import { HEX_DIRS, hexDirIndex, sameAlliance, isHostile } from '@/packages/primitives';
import { computeThreatHexes } from '@/packages/world';

const key = (q: number, r: number) => `${q},${r}`;

export interface RoutContext {
  routed: Unit;
  units: Unit[];
  alliances: Record<string, AllianceGroup>;
  formationsMap: Record<string, Formation>;
  structures?: MapStructures;
  templates?: Record<string, StructureTemplate>;
  /** The attacker that caused the rout — the primary "away from" axis. */
  attacker?: Unit | null;
  /** Board bound for the walk (default 12). */
  gridRadius?: number;
  /** Injectable RNG for the stated random tie-breaks (tests). */
  rnd?: () => number;
}

export function neighborsOf(hex: Hex): Hex[] {
  return HEX_DIRS.map(d => ({ q: hex.q + d.q, r: hex.r + d.r, s: -hex.q - hex.r - d.q - d.r }));
}

/** Enemy zone-of-control hexes for the routed unit. */
export function enemyKillZone(ctx: RoutContext): Set<string> {
  return computeThreatHexes(ctx.units, ctx.routed.id, ctx.alliances, ctx.formationsMap, ctx.structures, ctx.templates);
}

export interface RoutPath {
  /** The empty, non-kill-zone hex the unit ends on (null = nowhere to go). */
  dest: Hex | null;
  /** Friendly OPEN ORDER unit ids scattered by being pushed through (path order). */
  scatters: string[];
  /** Every friendly unit id pushed through (path order). */
  through: string[];
  /** Hexes pushed through (excludes `dest`). */
  path: Hex[];
  /** Why the rout failed (when `dest` is null). */
  reason?: string;
}

type NeighborKind = 'empty' | 'hostile' | 'blocked' | 'pass';

interface NeighborInfo {
  dir: number;
  hex: Hex;
  kind: NeighborKind;
  unit?: Unit;
}

const opposite = (dir: number) => (dir + 3) % 6;

/** The neighbour direction pointing most directly AWAY from `towardHex`. */
function awayDirFrom(pos: Hex, towardHex: Hex): number {
  const adj = hexDirIndex(pos, towardHex);
  if (adj >= 0) return opposite(adj); // an adjacent threat: exactly opposite
  const tq = towardHex.q - pos.q;
  const tr = towardHex.r - pos.r;
  let bestDir = 0;
  let bestDot = Infinity;
  let bestCross = Infinity;
  for (let d = 0; d < 6; d++) {
    const dir = HEX_DIRS[d];
    const dot = dir.q * tq + dir.r * tr;
    const cross = Math.abs(dir.q * tr - dir.r * tq);
    if (dot < bestDot || (dot === bestDot && cross < bestCross)) { bestDot = dot; bestCross = cross; bestDir = d; }
  }
  return bestDir;
}

/** The neighbour direction that maximizes the summed distance to every hostile. */
function massAwayDir(pos: Hex, hostiles: Unit[]): number {
  let bestDir = 0;
  let bestSum = -Infinity;
  for (let d = 0; d < 6; d++) {
    const n = neighborsOf(pos)[d];
    let sum = 0;
    for (const h of hostiles) sum += hexDistance(n, h.hex);
    if (sum > bestSum) { bestSum = sum; bestDir = d; }
  }
  return bestDir;
}

/**
 * The rout's "away" axis at `pos`: away from the ATTACKER, else away from the
 * NEAREST hostile, else away from the hostile MASS, else away from facing.
 */
function awayDirection(pos: Hex, ctx: RoutContext, hostiles: Unit[]): number {
  const { routed } = ctx;
  if (ctx.attacker && !ctx.attacker.isDeleted && (ctx.attacker.currentUnitHp ?? 1) > 0) {
    return awayDirFrom(pos, ctx.attacker.hex);
  }
  if (hostiles.length > 0) {
    let nearestDist = Infinity;
    let nearest: Unit[] = [];
    for (const h of hostiles) {
      const d = hexDistance(pos, h.hex);
      if (d < nearestDist) { nearestDist = d; nearest = [h]; }
      else if (d === nearestDist) nearest.push(h);
    }
    if (nearest.length === 1) return awayDirFrom(pos, nearest[0].hex);
    return massAwayDir(pos, hostiles);
  }
  return opposite(routed.facing);
}

/** Count hostiles adjacent to a hex (used for the flank / front tie-breaks). */
function hostilesAdjacent(hex: Hex, hostiles: Unit[]): number {
  return hostiles.reduce((n, h) => n + (hexDistance(hex, h.hex) === 1 ? 1 : 0), 0);
}

function classify(hex: Hex, kill: Set<string>, occ: Map<string, Unit>, ctx: RoutContext): NeighborInfo['kind'] {
  const k = key(hex.q, hex.r);
  if (kill.has(k)) return 'blocked'; // hostile ZoC — an impossible route
  const u = occ.get(k);
  if (!u) return 'empty';
  if (isHostile(u.team, ctx.routed.team, ctx.alliances)) return 'hostile';
  // A friendly with org >= 2 (Close Order and up) blocks; org <= 1 yields.
  return getOrganizationLevel(u.currentFormation) >= 2 ? 'blocked' : 'pass';
}

function inBounds(hex: Hex, radius: number): boolean {
  return Math.max(Math.abs(hex.q), Math.abs(hex.r), Math.abs(hex.s)) <= radius;
}

/**
 * Compute the routed unit's retreat, walking away from the threat.
 *
 * Per hop (neighbours ordered relative to the "away" axis: away=4, flanks 3/5,
 * hostile-side 2/6):
 *  1. hex 4 if it is an empty safe hex;
 *  2. else hex 3 or 5 (prefer the one NOT adjacent to a hostile; random tie);
 *  3. else push THROUGH a friendly org <= 1 (scattering an Open Order one);
 *  4. else hex 2 or 6 (fewest hostiles adjacent).
 * Stepping through a friendly repeats from the new hex — UNBOUNDED (grid-radius
 * bounded) — until an empty safe hex is reached.
 */
export function routRetreatPath(ctx: RoutContext): RoutPath {
  const radius = ctx.gridRadius ?? 12;
  const rnd = ctx.rnd ?? Math.random;
  const kill = enemyKillZone(ctx);
  const occ = new Map<string, Unit>();
  for (const u of ctx.units) {
    if (u.isDeleted || u.id === ctx.routed.id) continue;
    occ.set(key(u.hex.q, u.hex.r), u);
  }
  const hostiles = ctx.units.filter(u => !u.isDeleted && (u.currentUnitHp ?? 0) > 0 && isHostile(u.team, ctx.routed.team, ctx.alliances));

  const scatters: string[] = [];
  const through: string[] = [];
  const path: Hex[] = [];
  const visited = new Set<string>([key(ctx.routed.hex.q, ctx.routed.hex.r)]);
  let pos: Hex = { ...ctx.routed.hex };

  for (let step = 0; step < 512; step++) {
    const away = awayDirection(pos, ctx, hostiles);
    const dirs = [away, (away + 2) % 6, (away + 4) % 6, (away + 1) % 6, (away + 5) % 6];
    const neigh = neighborsOf(pos);
    const info: NeighborInfo[] = dirs.map((d, i) => ({ dir: d, hex: neigh[d], kind: classify(neigh[d], kill, occ, ctx), unit: occ.get(key(neigh[d].q, neigh[d].r)) }));
    const ok = (n: NeighborInfo) => inBounds(n.hex, radius) && !visited.has(key(n.hex.q, n.hex.r));

    // 1) away (4) empty-safe.
    if (info[0].kind === 'empty' && ok(info[0])) return { dest: info[0].hex, scatters, through, path };

    // 2) flanks (3/5) empty-safe — prefer not-hostile-adjacent, random tie.
    const flanks = [info[1], info[2]].filter(n => n.kind === 'empty' && ok(n));
    if (flanks.length === 2) {
      const c0 = hostilesAdjacent(flanks[0].hex, hostiles);
      const c1 = hostilesAdjacent(flanks[1].hex, hostiles);
      const chosen = c0 !== c1 ? (c0 < c1 ? flanks[0] : flanks[1]) : (rnd() < 0.5 ? flanks[0] : flanks[1]);
      return { dest: chosen.hex, scatters, through, path };
    }
    if (flanks.length === 1) return { dest: flanks[0].hex, scatters, through, path };

    // 3) push through a friendly org <= 1 (in away-first order).
    const pass = info.find(n => n.kind === 'pass' && ok(n));
    if (pass && pass.unit) {
      if (pass.unit.currentFormation === 'Open Order') scatters.push(pass.unit.id);
      through.push(pass.unit.id);
      path.push(pass.hex);
      visited.add(key(pass.hex.q, pass.hex.r));
      pos = pass.hex;
      continue;
    }

    // 4) hostile-side flanks (2/6) empty-safe — fewest hostiles adjacent.
    const fronts = [info[3], info[4]].filter(n => n.kind === 'empty' && ok(n));
    if (fronts.length >= 1) {
      fronts.sort((a, b) => hostilesAdjacent(a.hex, hostiles) - hostilesAdjacent(b.hex, hostiles));
      if (fronts.length === 2 && hostilesAdjacent(fronts[0].hex, hostiles) === hostilesAdjacent(fronts[1].hex, hostiles) && rnd() < 0.5) {
        return { dest: fronts[1].hex, scatters, through, path };
      }
      return { dest: fronts[0].hex, scatters, through, path };
    }

    return { dest: null, scatters, through, path, reason: 'every route is blocked by a hostile, an enemy kill zone, or a friendly Close Order+ unit' };
  }
  return { dest: null, scatters, through, path, reason: 'no route found' };
}
