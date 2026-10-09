// src/components/shared/mapFeatureDraw.ts
// Shared canvas drawing for authored board features (hex/edge structures, their
// HP / door / destroyed badges, and the MP-cost number) used by BOTH the scenario
// map (`useCanvasDraw`) and the Map Editor (`MapCanvas`). The two canvases differ
// in coordinate model (screen-space vs world-space) and image loading, so each
// keeps its own loop and passes a pixel mapper + font/line-width scaler here.
import { StructureTemplate, StructureInstance } from '@/types/structure';
import { structureDoorState } from '@/packages/movement';
import {
  battlementPath,
  battlementDepth,
  crossMarksPath,
  sineWavePath,
  ladderPaths,
  edgeShowsLadder,
  type Pt,
} from '@/packages/movement';

/** The grey used for the MP-cost number and the destroyed "✕" badge. */
export const MP_COST_GREY = '#9ca3af';

/** Stroke-then-fill centred text (the standard map-label look). */
export function strokeFillText(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  text: string,
  font: string,
  lineWidth: number,
  fill: string,
  stroke = 'rgba(0, 0, 0, 0.85)',
): void {
  ctx.font = font;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.lineWidth = lineWidth;
  ctx.strokeStyle = stroke;
  ctx.strokeText(text, x, y);
  ctx.fillStyle = fill;
  ctx.fillText(text, x, y);
}

/** Fill a pointy-top hex centred at (cx, cy) with `radius`. */
export function fillHexPath(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  radius: number,
  color: string,
): void {
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 180) * (60 * i - 30);
    const px = cx + radius * Math.cos(angle);
    const py = cy + radius * Math.sin(angle);
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}

/** The HP / door / destroyed badge state of a placed structure. */
export interface StructureBadges {
  /** HP number to show (null = no HP badge). */
  hpText: string | null;
  /** True when the structure had HP (`maxHp > 0`) and is now at `hp <= 0` — show a grey "✕". */
  destroyed: boolean;
  /** Door badge text (`open` / `broken` / `door N`), or null when no distinct door. */
  doorText: string | null;
  /** Whether the door is open (picks the door badge colour). */
  doorOpen: boolean;
}

/** Derive the badges for one structure. Hex structures show a destroyed "✕"; edge
 *  structures are removed at `hp <= 0` by the caller, so no ✕ is expected there. */
export function structureBadges(t: StructureTemplate | null | undefined, inst: StructureInstance | null | undefined): StructureBadges {
  const maxHp = t?.maxHp ?? 0;
  const hp = inst?.hp ?? maxHp;
  const destroyed = maxHp > 0 && hp <= 0;
  const hpText = destroyed || hp <= 0 ? null : `HP: ${hp}`;
  const st = t && inst ? structureDoorState(inst, t) : null;
  const doorText = !st || st.noDoor ? null
    : st.open ? 'open'
    : st.doorNow <= 0 ? 'broken'
    : `door ${st.doorNow}`;
  return { hpText, destroyed, doorText, doorOpen: st?.open ?? false };
}

export type EdgeDecorationKind = 'battlement' | 'barricade' | 'sinWave' | 'none';

/** One edge structure's decoration geometry — the SINGLE source shared by the
 *  scenario canvas (`useCanvasDraw`) and the Map Editor (`MapCanvas`), so the two
 *  cannot diverge. Coordinates are whatever space the caller draws in (screen-space
 *  for the scenario, world-space for the editor; both are internally consistent). */
export interface EdgeStructureVisuals {
  /** Draw the thick base wall line (ladder edges draw no wall line). */
  baseLine: boolean;
  decorationKind: EdgeDecorationKind;
  /** Battlement / barricade / sine-wave path (null for `none` / ladder edges). */
  decorationPath: string | null;
  /** Trapezoid ladder rung/rail paths when the edge is a ladder, else null. */
  ladder: { rungs: string; rails: string } | null;
}

/**
 * The decoration geometry for one placed edge structure. `hexA`/`hexB` are the
 * two adjacent hex centres (edge face A and B) and `surfaceA`/`surfaceB` their
 * (effective) surfaces — used to pick the ladder's lean (higher side, or the
 * instance's `ladderSide` override). A ladder edge draws ONLY the ladder (no base
 * wall line / battlement), matching the scenario's long-standing behaviour.
 */
export function edgeStructureVisuals(args: {
  a: Pt;
  b: Pt;
  hexA: Pt;
  hexB: Pt;
  surfaceA: number;
  surfaceB: number;
  template: StructureTemplate;
  instance: StructureInstance;
}): EdgeStructureVisuals {
  const { a, b, hexA, hexB, surfaceA, surfaceB, template: t, instance: inst } = args;
  const seg = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  const midX = (a.x + b.x) / 2;
  const midY = (a.y + b.y) / 2;
  const depth = battlementDepth(seg, 8);
  const outward = (c: Pt): Pt => {
    let nx = c.x - midX;
    let ny = c.y - midY;
    const nl = Math.hypot(nx, ny) || 1;
    return { x: nx / nl, y: ny / nl };
  };

  if (edgeShowsLadder(inst, t)) {
    const side = inst.ladderSide ?? (surfaceB >= surfaceA ? 'b' : 'a');
    return { baseLine: false, decorationKind: 'none', decorationPath: null, ladder: ladderPaths(a, b, side === 'a' ? hexA : hexB) };
  }

  const kind: EdgeDecorationKind = t.sinWave ? 'sinWave' : t.barricade ? 'barricade' : t.battlement ? 'battlement' : 'none';
  let decorationPath: string | null = null;
  if (kind === 'battlement') {
    const outsideHex = (inst.outside ?? 'a') === 'a' ? hexA : hexB;
    decorationPath = battlementPath(a, b, outward(outsideHex), depth, 8);
  } else if (kind === 'barricade') {
    decorationPath = crossMarksPath(a, b, depth, 8);
  } else if (kind === 'sinWave') {
    decorationPath = sineWavePath(a, b, depth, 2);
  }
  const baseLine = kind !== 'barricade' && kind !== 'sinWave';
  return { baseLine, decorationKind: kind, decorationPath, ladder: null };
}
