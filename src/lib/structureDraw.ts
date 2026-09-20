// src/lib/structureDraw.ts
// Shared canvas geometry for map structures. The battlement (crenellation) is a
// square-wave drawn along an edge, offset toward the OUTSIDE face. Kept small so
// it reads as decoration at map scale.
export interface Pt { x: number; y: number }

/** Tooth depth (amplitude) that makes a battlement read as squares: the tooth
 *  width, so the crenellations are as tall as they are wide. */
export function battlementDepth(len: number, teeth = 8): number {
  return len / Math.max(1, teeth * 2 - 1);
}

/**
 * SVG/canvas path `d` for a battlement square-wave along segment a→b, offset by
 * `depth` in the unit direction `outward` (the outside face), with `teeth` tabs.
 */
export function battlementPath(a: Pt, b: Pt, outward: Pt, depth: number, teeth = 8): string {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const ox = outward.x * depth;
  const oy = outward.y * depth;
  const n = Math.max(1, Math.round(teeth));
  const step = len / (n * 2 - 1);
  let d = `M ${a.x} ${a.y} L ${a.x + ox} ${a.y + oy}`;
  for (let i = 0; i < n; i++) {
    const sx = a.x + ux * step * (i * 2);
    const sy = a.y + uy * step * (i * 2);
    const ex = sx + ux * step;
    const ey = sy + uy * step;
    d += ` L ${sx} ${sy} L ${sx + ox} ${sy + oy} L ${ex + ox} ${ey + oy} L ${ex} ${ey}`;
  }
  d += ` L ${b.x} ${b.y}`;
  return d;
}

/**
 * SVG/canvas path `d` for a triangle (sawtooth) wave along a→b whose minima sit
 * ON the edge and whose peaks point `outward` — a row of triangles growing out of
 * the hex edge (e.g. Archer's Stake). `depth` matches the battlement amplitude so
 * the two decorations read at the same size.
 */
export function triangleWavePath(a: Pt, b: Pt, outward: Pt, depth: number, teeth = 8): string {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const ox = outward.x * depth;
  const oy = outward.y * depth;
  const n = Math.max(1, Math.round(teeth));
  const step = len / n;
  let d = `M ${a.x} ${a.y}`;
  for (let i = 0; i < n; i++) {
    const peakT = (i + 0.5) * step; // apex, pushed outward
    const edgeT = (i + 1) * step;   // back down to the edge
    d += ` L ${a.x + ux * peakT + ox} ${a.y + uy * peakT + oy}`;
    d += ` L ${a.x + ux * edgeT} ${a.y + uy * edgeT}`;
  }
  return d;
}
