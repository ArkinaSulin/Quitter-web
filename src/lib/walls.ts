// src/lib/walls.ts
// Edge walls/barriers (pure domain logic). A wall sits on the shared edge between
// a hex and one of its 6 neighbours. Each edge has two FACES — one belongs to each
// of the two hexes — and a face can:
//   - replace the destination hex's terrain MP cost when crossing INTO that side
//     (`moveCost`; `block` = impassable from that side),
//   - grant melee / ranged AC to the unit standing on that side when attacked
//     across the edge (`meleeAc` / `rangedAc`).
//
// The atomic unit is the EDGE SEGMENT; a run of contiguous segments is just several
// wall entries. Phase 2 adds per-segment HP/DT (destruction); Phase 3 adds
// effect-sourced (magic) walls with a caster/duration. Those fields are already
// carried here so the shape is stable.
//
// Edges are stored once, canonically, under the endpoint hex with the smaller
// (q, r) tuple so the two neighbours can never desync. Rendering: with the
// pointy-top layout, the edge toward `HEX_DIRS[d]` is the segment between hex
// corners `d` and `d+1` (verified against `hexCorners` / `useHexGrid`).

export const WALL_DIRS: { q: number; r: number; s: number }[] = [
  { q: 1, r: 0, s: -1 },
  { q: 0, r: 1, s: -1 },
  { q: -1, r: 1, s: 0 },
  { q: -1, r: 0, s: 1 },
  { q: 0, r: -1, s: 1 },
  { q: 1, r: -1, s: 0 },
];

/** One face of an edge (the side belonging to one of the two hexes). */
export interface WallFace {
  /** Replaces the destination hex's terrain MP cost when crossing INTO this face.
   *  Undefined = normal terrain. */
  moveCost?: number;
  /** Impassable from this side. */
  block?: boolean;
  /** AC granted to the unit on this face vs melee across the edge. */
  meleeAc?: number;
  /** AC granted to the unit on this face vs ranged across the edge. */
  rangedAc?: number;
}

export interface Wall {
  /** Face belonging to the canonical hex (the `a` endpoint of the stored key). */
  a: WallFace;
  /** Face belonging to the other hex (the `b` endpoint). */
  b: WallFace;
  // --- Phase 2: destructibility (per segment) ---
  hp?: number;
  maxHp?: number;
  /** Damage Threshold: a single hit at/below this does nothing; above deals full. */
  dt?: number;
  // --- Phase 3: effect-sourced (magic) walls ---
  source?: 'map' | 'effect';
  casterUnitId?: string | null;
  casterTeam?: string | null;
  casterPlayerId?: string | null;
  duration?: number;
  turnsLeft?: number;
}

/** edge key ("q,r,dir") -> wall. */
export type Walls = Record<string, Wall>;

export interface HexPoint { q: number; r: number }

export function oppositeDir(dir: number): number {
  return (dir + 3) % 6;
}

/** The direction index that takes `from` to `to` when they are adjacent, else -1. */
export function directionBetween(from: HexPoint, to: HexPoint): number {
  const dq = to.q - from.q;
  const dr = to.r - from.r;
  return WALL_DIRS.findIndex(d => d.q === dq && d.r === dr);
}

export interface EdgeRef {
  /** Canonical key "q,r,dir". */
  key: string;
  /** Canonical hex (owns face `a`) — smaller (q,r) tuple. */
  aq: number;
  ar: number;
  /** Direction from the canonical hex to the other hex (0..5). */
  dir: number;
  /** The other hex (owns face `b`). */
  bq: number;
  br: number;
}

/** Canonical edge reference for the edge between (q,r) and its neighbour `dir`. */
export function edgeRef(q: number, r: number, dir: number): EdgeRef {
  const d = ((dir % 6) + 6) % 6;
  const n = WALL_DIRS[d];
  const nq = q + n.q;
  const nr = r + n.r;
  // Canonical endpoint = the smaller (q, r) tuple.
  const aIsThis = q < nq || (q === nq && r < nr);
  if (aIsThis) {
    return { key: `${q},${r},${d}`, aq: q, ar: r, dir: d, bq: nq, br: nr };
  }
  const rd = oppositeDir(d);
  return { key: `${nq},${nr},${rd}`, aq: nq, ar: nr, dir: rd, bq: q, br: r };
}

/** Look up the wall on the edge between two adjacent hexes (null when none). */
export function wallBetween(walls: Walls | null | undefined, from: HexPoint, to: HexPoint): { ref: EdgeRef; wall: Wall; faceFrom: WallFace; faceTo: WallFace } | null {
  if (!walls) return null;
  const dir = directionBetween(from, to);
  if (dir < 0) return null; // not adjacent
  const ref = edgeRef(from.q, from.r, dir);
  const wall = walls[ref.key];
  if (!wall) return null;
  const fromIsA = ref.aq === from.q && ref.ar === from.r;
  return {
    ref,
    wall,
    faceFrom: fromIsA ? wall.a : wall.b,
    faceTo: fromIsA ? wall.b : wall.a,
  };
}

/** True when the edge between `from` and `to` blocks movement from `from`'s side. */
export function isBlockedEdge(walls: Walls | null | undefined, from: HexPoint, to: HexPoint): boolean {
  const hit = wallBetween(walls, from, to);
  return !!hit?.faceFrom.block;
}

/**
 * MP to cross into `to` from `from`, when a wall face on `to`'s side overrides the
 * terrain cost. Returns `undefined` when there is no wall (caller falls back to
 * `terrainCostOf`) or the face has no `moveCost`.
 */
export function crossingCost(walls: Walls | null | undefined, from: HexPoint, to: HexPoint): number | undefined {
  const hit = wallBetween(walls, from, to);
  return hit?.faceTo.moveCost;
}

/** Melee AC the wall grants to the defender when attacked from `attackerHex`. */
export function meleeWallAc(walls: Walls | null | undefined, attackerHex: HexPoint, defenderHex: HexPoint): number {
  return wallBetween(walls, attackerHex, defenderHex)?.faceTo.meleeAc ?? 0;
}

/** Ranged AC the wall grants to the defender when the shot crosses its edge. */
export function rangedWallAc(walls: Walls | null | undefined, attackerHex: HexPoint, defenderHex: HexPoint): number {
  return wallBetween(walls, attackerHex, defenderHex)?.faceTo.rangedAc ?? 0;
}

/**
 * The face on `to`'s side of the edge crossed by a step from `from` to `to`
 * (used by the ranged line: the segment ENTERING the defender's hex). Adjacent or
 * null.
 */
export function crossingFace(walls: Walls | null | undefined, from: HexPoint, to: HexPoint): WallFace | null {
  return wallBetween(walls, from, to)?.faceTo ?? null;
}

/** True when crossing `from -> to` is blocked (movement predicate for BFS/AI). */
export function blockedStep(walls: Walls | null | undefined, fromQ: number, fromR: number, toQ: number, toR: number): boolean {
  return isBlockedEdge(walls, { q: fromQ, r: fromR }, { q: toQ, r: toR });
}

/** True when ANY wall sits on the edge `from -> to` (used to block charges). */
export function hasWallEdge(walls: Walls | null | undefined, fromQ: number, fromR: number, toQ: number, toR: number): boolean {
  return !!wallBetween(walls, { q: fromQ, r: fromR }, { q: toQ, r: toR });
}

// --- Geometry (pointy-top; matches useHexGrid.hexToPixel + MapCanvas.hexCorners) ---

export function hexCenter(hex: HexPoint, size: number): { x: number; y: number } {
  return { x: size * (Math.sqrt(3) * hex.q + Math.sqrt(3) / 2 * hex.r), y: size * 1.5 * hex.r };
}

export function hexCorner(hex: HexPoint, i: number, size: number): { x: number; y: number } {
  const c = hexCenter(hex, size);
  const angle = (Math.PI / 180) * (60 * i - 30);
  return { x: c.x + size * Math.cos(angle), y: c.y + size * Math.sin(angle) };
}

/** World-space segment for the edge toward `dir` (corners `dir` and `dir+1`). */
export function edgeSegment(hex: HexPoint, dir: number, size: number): [{ x: number; y: number }, { x: number; y: number }] {
  const d = ((dir % 6) + 6) % 6;
  return [hexCorner(hex, d, size), hexCorner(hex, (d + 1) % 6, size)];
}

function distToSegment(p: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }): number {
  const vx = b.x - a.x, vy = b.y - a.y;
  const wx = p.x - a.x, wy = p.y - a.y;
  const len2 = vx * vx + vy * vy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, (wx * vx + wy * vy) / len2));
  const cx = a.x + t * vx, cy = a.y + t * vy;
  return Math.hypot(p.x - cx, p.y - cy);
}

/**
 * The edge of `hex` nearest to a world-space point (for pointer authoring).
 * Returns the directed edge on `hex` (dir 0..5) plus its distance.
 */
export function nearestEdge(hex: HexPoint, point: { x: number; y: number }, size: number): { dir: number; dist: number } {
  let best = 0;
  let bestDist = Infinity;
  for (let d = 0; d < 6; d++) {
    const [a, b] = edgeSegment(hex, d, size);
    const dist = distToSegment(point, a, b);
    if (dist < bestDist) { bestDist = dist; best = d; }
  }
  return { dir: best, dist: bestDist };
}

// --- Persistence sanitizer ---

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function parseFace(raw: any): WallFace {
  const f: WallFace = {};
  if (!raw || typeof raw !== 'object') return f;
  if (isNum(raw.moveCost)) f.moveCost = Math.max(0, Math.min(99, Math.round(raw.moveCost)));
  if (raw.block === true) f.block = true;
  if (isNum(raw.meleeAc)) f.meleeAc = Math.round(raw.meleeAc);
  if (isNum(raw.rangedAc)) f.rangedAc = Math.round(raw.rangedAc);
  return f;
}

/** Sanitize the jsonb walls blob into a Record<"q,r,dir", Wall>. */
export function parseWalls(raw: any): Walls {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Walls = {};
  for (const [key, v] of Object.entries(raw)) {
    if (!/^-?\d+,-?\d+,[0-5]$/.test(key)) continue;
    if (!v || typeof v !== 'object') continue;
    const wall: Wall = { a: parseFace((v as any).a), b: parseFace((v as any).b) };
    if (isNum((v as any).maxHp)) wall.maxHp = Math.max(0, Math.round((v as any).maxHp));
    if (isNum((v as any).hp)) wall.hp = Math.max(0, Math.round((v as any).hp));
    if (isNum((v as any).dt)) wall.dt = Math.max(0, Math.round((v as any).dt));
    const src = (v as any).source;
    if (src === 'map' || src === 'effect') wall.source = src;
    if (typeof (v as any).casterUnitId === 'string') wall.casterUnitId = (v as any).casterUnitId;
    if (typeof (v as any).casterTeam === 'string') wall.casterTeam = (v as any).casterTeam;
    if (typeof (v as any).casterPlayerId === 'string') wall.casterPlayerId = (v as any).casterPlayerId;
    if (isNum((v as any).duration)) wall.duration = Math.max(0, Math.round((v as any).duration));
    if (isNum((v as any).turnsLeft)) wall.turnsLeft = Math.max(0, Math.round((v as any).turnsLeft));
    // Drop fully-empty faces? Keep — an edge with both faces empty is a no-op but harmless.
    out[key] = wall;
  }
  return out;
}
