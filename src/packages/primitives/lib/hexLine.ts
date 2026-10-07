// src/lib/hexLine.ts
// Axial hex line (cube lerp, Red Blob Games). Returns every hex the segment
// passes through, inclusive of both endpoints, ordered from `a` to `b`. Used to
// find which edge a ranged attack crosses as it enters the defender's hex.
import { Hex } from '@/types/gameProtocol';

interface Cube { x: number; y: number; z: number }

function axialToCube(q: number, r: number): Cube {
  return { x: q, z: r, y: -q - r };
}

function cubeRound(c: Cube): { q: number; r: number } {
  let rx = Math.round(c.x);
  let ry = Math.round(c.y);
  let rz = Math.round(c.z);
  const dx = Math.abs(rx - c.x);
  const dy = Math.abs(ry - c.y);
  const dz = Math.abs(rz - c.z);
  if (dx > dy && dx > dz) rx = -ry - rz;
  else if (dy > dz) ry = -rx - rz;
  else rz = -rx - ry;
  // Normalize -0 to 0 so structural equality (tests) is stable.
  return { q: rx || 0, r: rz || 0 };
}

function cubeLerp(a: Cube, b: Cube, t: number): Cube {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t };
}

/** Every hex on the straight line a -> b (endpoints included). */
export function hexLine(a: Hex, b: Hex): Hex[] {
  const ca = axialToCube(a.q, a.r);
  const cb = axialToCube(b.q, b.r);
  const n = Math.max(Math.abs(ca.x - cb.x), Math.abs(ca.y - cb.y), Math.abs(ca.z - cb.z));
  if (n === 0) return [{ ...a }];
  const out: Hex[] = [];
  for (let i = 0; i <= n; i++) {
    const { q, r } = cubeRound(cubeLerp(ca, cb, i / n));
    out.push({ q, r, s: -q - r });
  }
  return out;
}

/**
 * The hex a ranged attack comes from as it ENTERS `defender`'s hex, i.e. the
 * second-to-last hex on the line. Null when the line has no prior hex (same hex).
 */
export function hexEnteringFrom(attacker: Hex, defender: Hex): Hex | null {
  const line = hexLine(attacker, defender);
  return line.length >= 2 ? line[line.length - 2] : null;
}
