// src/packages/movement/lib/structureDraw.ts
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

/**
 * SVG/canvas path `d` for a line of X marks centred ON the edge (a barricade).
 * Each X is two crossing diagonals, symmetric about the edge so the decoration
 * affects both in and out. `depth` is the X's half-size.
 */
export function crossMarksPath(a: Pt, b: Pt, depth: number, teeth = 8): string {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const px = -uy; // perpendicular
  const py = ux;
  const n = Math.max(1, Math.round(teeth));
  const step = len / n;
  // Half-size is a fraction of the step so consecutive X marks stay separated
  // (otherwise the tilted arms touch and read as a connected diamond lattice).
  const half = Math.max(1, Math.min(depth, step * 0.35));
  let d = '';
  for (let i = 0; i < n; i++) {
    const cx = a.x + ux * (i + 0.5) * step;
    const cy = a.y + uy * (i + 0.5) * step;
    d += ` M ${cx - px * half - ux * half} ${cy - py * half - uy * half} L ${cx + px * half + ux * half} ${cy + py * half + uy * half}`;
    d += ` M ${cx + px * half - ux * half} ${cy + py * half - uy * half} L ${cx - px * half + ux * half} ${cy - py * half + uy * half}`;
  }
  return d;
}

/**
 * SVG/canvas paths for a trapezoid LADDER along segment a→b, leaning toward
 * `higher` (the higher surface / hex centre): 3 rungs parallel to the edge
 * (short → long as they climb away from the edge) plus two rails connecting the
 * rung ends, extruded past them. Split into rungs and rails so callers can stroke
 * them at different widths (as the live canvas does).
 */
export function ladderPaths(a: Pt, b: Pt, higher: Pt): { rungs: string; rails: string } {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const seg = Math.hypot(dx, dy) || 1;
  const ex = dx / seg;
  const ey = dy / seg;
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  let px = higher.x - mx;
  let py = higher.y - my;
  const pl = Math.hypot(px, py) || 1;
  px /= pl;
  py /= pl;
  // 50% scale: half the perpendicular spread (height) and rung lengths (width).
  const offs = [-seg * 0.07, 0, seg * 0.07];
  const lens = [seg * 0.21, seg * 0.32, seg * 0.43];
  const ends: Pt[][] = [];
  let rungs = '';
  for (let i = 0; i < 3; i++) {
    const ccx = mx + px * offs[i];
    const ccy = my + py * offs[i];
    const h = lens[i] / 2;
    const p1 = { x: ccx - ex * h, y: ccy - ey * h };
    const p2 = { x: ccx + ex * h, y: ccy + ey * h };
    ends.push([p1, p2]);
    rungs += ` M ${p1.x} ${p1.y} L ${p2.x} ${p2.y}`;
  }
  const ext = seg * 0.06;
  let rails = '';
  for (const side of [0, 1] as const) {
    const top = ends[0][side];
    const bottom = ends[2][side];
    let rx = bottom.x - top.x;
    let ry = bottom.y - top.y;
    const l = Math.hypot(rx, ry) || 1;
    rx /= l;
    ry /= l;
    rails += ` M ${top.x - rx * ext} ${top.y - ry * ext} L ${bottom.x + rx * ext} ${bottom.y + ry * ext}`;
  }
  return { rungs, rails };
}

/**
 * SVG/canvas path `d` for a sine wave oscillating symmetrically about the edge
 * (a magical barrier). `depth` is the amplitude; `cycles` is the number of full
 * waves along the segment.
 */
export function sineWavePath(a: Pt, b: Pt, depth: number, cycles = 2): string {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const px = -uy;
  const py = ux;
  const n = Math.max(2, Math.round(cycles));
  const samples = n * 12;
  let d = `M ${a.x} ${a.y}`;
  for (let i = 1; i <= samples; i++) {
    const t = i / samples;
    const along = t * len;
    const off = Math.sin(t * Math.PI * 2 * n) * depth;
    d += ` L ${a.x + ux * along + px * off} ${a.y + uy * along + py * off}`;
  }
  return d;
}
