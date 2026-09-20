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
 * SVG/canvas path `d` for a row of small triangle stakes along a→b, apexes
 * pointing `outward` (away from the inside face).
 */
export function spikePath(a: Pt, b: Pt, outward: Pt, depth: number, count = 8): string {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const ox = outward.x * depth;
  const oy = outward.y * depth;
  const n = Math.max(1, Math.round(count));
  const step = len / n;
  let d = '';
  for (let i = 0; i < n; i++) {
    const bx = a.x + ux * step * i;
    const by = a.y + uy * step * i;
    const ex = a.x + ux * step * (i + 1);
    const ey = a.y + uy * step * (i + 1);
    const cx = a.x + ux * step * (i + 0.5) + ox;
    const cy = a.y + uy * step * (i + 0.5) + oy;
    d += `M ${bx} ${by} L ${cx} ${cy} L ${ex} ${ey} Z `;
  }
  return d;
}
