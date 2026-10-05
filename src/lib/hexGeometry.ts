// src/lib/hexGeometry.ts
// Pure hex <-> pixel math (pointy-top), shared by the canvas hook, map geometry,
// token layout and hit-testing. Kept dependency-free so any layer can import it
// without creating a cycle (mapGeometry no longer imports from useHexGrid).
import { Hex } from '@/types/gameProtocol';

/** Rendered hex circumradius in world pixels (the canvas `size`). */
export const HEX_SIZE = 100;

/** The six cube-coordinate neighbour directions, indices 0..5 (clockwise). The
 *  ONE canonical copy — import this instead of redeclaring the array. */
export const HEX_DIRS: Hex[] = [
  { q: 1, r: 0, s: -1 },
  { q: 0, r: 1, s: -1 },
  { q: -1, r: 1, s: 0 },
  { q: -1, r: 0, s: 1 },
  { q: 0, r: -1, s: 1 },
  { q: 1, r: -1, s: 0 },
];

/** Arc label relative to a facing (front/flank/rear). */
export type HexArc = 'front' | 'flank' | 'rear';

/** The `HEX_DIRS` index of `to` seen from `from`, or -1 when not one of the six
 *  neighbours (same hex or farther). */
export function hexDirIndex(from: Hex, to: Hex): number {
  return HEX_DIRS.findIndex(d => d.q === to.q - from.q && d.r === to.r - from.r && d.s === to.s - from.s);
}

/** The two hex-direction indices in front of `facing`. */
export function frontArcIndices(facing: number): [number, number] {
  return [(facing + 4) % 6, (facing + 5) % 6];
}

/** The two hex-direction indices behind `facing`. */
export function rearArcIndices(facing: number): [number, number] {
  return [(facing + 1) % 6, (facing + 2) % 6];
}

/**
 * Arc of `target` relative to a unit at `origin` facing `facing` (adjacency only).
 * Same hex / off-grid resolves to `'front'` (no bearing), matching the historical
 * `determineCombatPosition` fallback. For ranged bearings use
 * `attackDirection.arcOfTarget`.
 */
export function arcOf(origin: Hex, facing: number, target: Hex): HexArc {
  const dirIdx = hexDirIndex(origin, target);
  if (dirIdx === -1) return 'front';
  if (frontArcIndices(facing).includes(dirIdx)) return 'front';
  if (rearArcIndices(facing).includes(dirIdx)) return 'rear';
  return 'flank';
}

export function hexToPixel(hex: Hex, size: number): { x: number; y: number } {
  const x = size * (Math.sqrt(3) * hex.q + Math.sqrt(3) / 2 * hex.r);
  const y = size * (1.5 * hex.r);
  return { x, y };
}

export function pixelToHex(point: { x: number; y: number }, size: number): Hex {
  const q = (Math.sqrt(3) / 3 * point.x - 1 / 3 * point.y) / size;
  const r = (2 / 3 * point.y) / size;
  return hexRound(q, r);
}

function hexRound(q: number, r: number): Hex {
  const s = -q - r;
  let rq = Math.round(q);
  let rr = Math.round(r);
  let rs = Math.round(s);
  const qDiff = Math.abs(rq - q);
  const rDiff = Math.abs(rr - r);
  const sDiff = Math.abs(rs - s);
  if (qDiff > rDiff && qDiff > sDiff) {
    rq = -rr - rs;
  } else if (rDiff > sDiff) {
    rr = -rq - rs;
  } else {
    rs = -rq - rr;
  }
  return { q: rq, r: rr, s: rs };
}
