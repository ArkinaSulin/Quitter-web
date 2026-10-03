// src/lib/hexGeometry.ts
// Pure hex <-> pixel math (pointy-top), shared by the canvas hook, map geometry,
// token layout and hit-testing. Kept dependency-free so any layer can import it
// without creating a cycle (mapGeometry no longer imports from useHexGrid).
import { Hex } from '@/types/gameProtocol';

/** Rendered hex circumradius in world pixels (the canvas `size`). */
export const HEX_SIZE = 100;

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
