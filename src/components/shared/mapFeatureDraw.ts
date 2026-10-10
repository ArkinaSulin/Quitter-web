// src/components/shared/mapFeatureDraw.ts
// Shared canvas drawing for authored board features (hex/edge structures, their
// HP / door / destroyed badges, and the MP-cost number) used by BOTH the scenario
// map (`useCanvasDraw`) and the Map Editor (`MapCanvas`). The two canvases differ
// in coordinate model (screen-space vs world-space) and image loading, so each
// keeps its own loop and passes a pixel mapper + font/line-width scaler here.
import { StructureTemplate, StructureInstance } from '@/types/structure';
import { structureDoorState, structureElevation, structureSurfaceAt, climbStepsFromFeet, edgeRef, MapStructures } from '@/packages/movement';
import { HEX_SIZE, HEX_DIRS } from '@/packages/world';
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

/** The monospace label font used by every board label, in SCREEN pixels. */
export const MONO = (px: number): string => `bold ${px}px ui-monospace, monospace`;

export interface MapTextStyle {
  /** Font size in SCREEN pixels. */
  fontPx: number;
  /** Stroke-then-fill line width in SCREEN pixels. */
  linePx: number;
}

/**
 * The single source of truth for every board-label text style, in SCREEN pixels,
 * shared by the scenario canvas (`useCanvasDraw`), the Map Editor (`MapCanvas`) and
 * the Structure Editor preview so the three can never drift. A canvas that draws
 * inside a `ctx.scale(zoom)` transform converts to its own units by dividing by
 * `zoom` (a world font of `fontPx / zoom` renders at `fontPx` screen px).
 */
export function mapTextStyles(zoom: number): Record<'hp' | 'door' | 'elevation' | 'effectElev' | 'mp', MapTextStyle> {
  const z = Math.max(0.05, zoom);
  const line = Math.max(2, 3 * z);
  return {
    hp: { fontPx: Math.max(11, 12 * z), linePx: line },
    door: { fontPx: Math.max(10, 11 * z), linePx: line },
    elevation: { fontPx: Math.max(10, 12 * z), linePx: line },
    effectElev: { fontPx: Math.max(9, 11 * z), linePx: line },
    mp: { fontPx: Math.min(39, (2 * HEX_SIZE * z) / 3), linePx: 4 },
  };
}

/** How far a per-edge climb label sits from the edge midpoint toward its hex
 *  centre: 0 = on the edge line, 1 = at the hex centre. Shared so the scenario
 *  canvas and the Map Editor place labels identically. */
export const CLIMB_LABEL_OFFSET = 0.15;

/** The alpha of a per-edge climb label — faint so it annotates without clutter. */
export const CLIMB_LABEL_ALPHA = 0.4;

/**
 * The board text for a foot/mounted climb pair. `null` when BOTH are 0 (a free
 * climb draws no label); a negative (hard block) shows `-`; equal values collapse
 * to one number, else `foot/mounted`.
 */
export function climbLabelText(foot: number, mounted: number): string | null {
  if (foot === 0 && mounted === 0) return null;
  const fmt = (v: number) => (v < 0 ? '-' : String(v));
  return foot === mounted ? fmt(foot) : `${fmt(foot)}/${fmt(mounted)}`;
}

/** One labelled climb edge of a HEX structure: `HEX_DIRS` index + the TOTAL MP
 *  (10-ft steps × rate) to climb onto the structure across that edge. */
export interface HexClimbLabel {
  dir: number;
  foot: number;
  mounted: number;
}

/**
 * The per-edge climb labels for a HEX structure: each of its 6 edges whose
 * neighbour top is LOWER (a real climb onto this structure). Edges covered by an
 * EDGE structure are skipped (that edge draws its own labels), and level edges
 * (equal top surface) are hidden — there is no extra crossing cost. The HIGHER
 * structure owns a non-level shared edge and contributes its up-rate. Returns []
 * when the hex has no structure. Values are TOTALS: steps × mp per 10 ft.
 */
export function hexClimbLabels(
  hex: { q: number; r: number },
  structures: MapStructures | null | undefined,
  templates: Record<string, StructureTemplate> | null | undefined,
): HexClimbLabel[] {
  const inst = structures?.[`${hex.q},${hex.r}`];
  const t = inst ? templates?.[inst.templateId] : undefined;
  if (!inst || !t) return [];
  const surf = structureSurfaceAt(hex, structures ?? undefined, templates ?? undefined);
  const out: HexClimbLabel[] = [];
  for (let dir = 0; dir < 6; dir++) {
    const d = HEX_DIRS[dir];
    const n = { q: hex.q + d.q, r: hex.r + d.r };
    if (structures?.[edgeRef(hex.q, hex.r, dir).key]) continue;
    const nSurf = structureSurfaceAt(n, structures ?? undefined, templates ?? undefined);
    if (!(surf > nSurf)) continue;
    const steps = climbStepsFromFeet(surf - nSurf);
    out.push({ dir, foot: steps * t.mpClimbUp, mounted: steps * t.mpMountedUp });
  }
  return out;
}

export interface ClimbLabelDrawOpts {
  text: string;
  x: number;
  y: number;
  /** Screen px per caller unit (1 = screen space, `zoom` = world space). */
  unit: number;
  zoom: number;
}

/** Draw one per-edge climb label at (x, y) in the caller's units, using the HP
 *  font at `CLIMB_LABEL_ALPHA` so it reads as a faint annotation over the art. */
export function drawClimbLabel(ctx: CanvasRenderingContext2D, o: ClimbLabelDrawOpts): void {
  const ts = mapTextStyles(o.zoom);
  ctx.save();
  ctx.globalAlpha = CLIMB_LABEL_ALPHA;
  ctx.font = MONO(ts.hp.fontPx / o.unit);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.lineWidth = ts.hp.linePx / o.unit;
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.85)';
  ctx.strokeText(o.text, o.x, o.y);
  ctx.fillStyle = '#ffe0b2';
  ctx.fillText(o.text, o.x, o.y);
  ctx.restore();
}

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

/** Stroke a pointy-top hex outline centred at (cx, cy) with `radius`. */
export function strokeHexPath(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  radius: number,
  color: string,
  lineWidth: number,
): void {
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 180) * (60 * i - 30);
    const hx = cx + radius * Math.cos(angle);
    const hy = cy + radius * Math.sin(angle);
    if (i === 0) ctx.moveTo(hx, hy);
    else ctx.lineTo(hx, hy);
  }
  ctx.closePath();
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.stroke();
}

/** The HP / door badge state of a placed structure. */
export interface StructureBadges {
  /** HP number to show (null = no HP badge). */
  hpText: string | null;
  /** Door badge text (`open` / `broken` / `door N`), or null when no distinct door. */
  doorText: string | null;
  /** Whether the door is open (picks the door badge colour). */
  doorOpen: boolean;
}

/** Derive the badges for one structure. A destroyed structure (hp <= 0) is removed
 *  by the caller, so no badge is expected there. */
export function structureBadges(t: StructureTemplate | null | undefined, inst: StructureInstance | null | undefined): StructureBadges {
  const maxHp = t?.maxHp ?? 0;
  const hp = inst?.hp ?? maxHp;
  const hpText = hp <= 0 ? null : `HP: ${hp}`;
  const st = t && inst ? structureDoorState(inst, t) : null;
  const doorText = !st || st.noDoor ? null
    : st.open ? 'open'
    : st.doorNow <= 0 ? 'broken'
    : `door ${st.doorNow}`;
  return { hpText, doorText, doorOpen: st?.open ?? false };
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

/** A hex structure's outline / artwork / HP / door / (optional) elevation draw —
 *  shared by the scenario canvas and the Map Editor so the two render identically.
 *  Coordinates are in the CALLER's units (`unit` = screen px per caller unit: 1 for
 *  the screen-space scenario, `zoom` for the world-space editor); sizes are converted
 *  from the shared screen-px `mapTextStyles` so nothing drifts. */
export interface HexStructureDrawOpts {
  cx: number;
  cy: number;
  /** Hex radius in caller units. */
  hexRadius: number;
  /** Screen px per caller unit (1 = screen space, `zoom` = world space). */
  unit: number;
  zoom: number;
  template?: StructureTemplate | null;
  instance?: StructureInstance | null;
  /** Resolve a loaded artwork image (each canvas owns its cache). */
  getImage?: (url: string) => CanvasImageSource | null;
  /** Draw the structure-top elevation badge (the scenario draws it in one shared pass). */
  drawElevation?: boolean;
}

export function drawHexStructure(ctx: CanvasRenderingContext2D, o: HexStructureDrawOpts): void {
  const ts = mapTextStyles(o.zoom);
  const px = (screenPx: number) => screenPx / o.unit; // screen px -> caller units
  const t = o.template;
  if (t?.hexBorder !== false) strokeHexPath(ctx, o.cx, o.cy, o.hexRadius, 'rgba(0,0,0,0.95)', px(Math.max(3, 5 * o.zoom)));
  if (t?.imageUrl && o.getImage) {
    const img = o.getImage(t.imageUrl);
    if (img) {
      const h = px(1.2 * HEX_SIZE * o.zoom);
      const w = h * (Number((img as any).naturalWidth) / Math.max(1, Number((img as any).naturalHeight)));
      ctx.drawImage(img, o.cx - w / 2, o.cy - h / 2, w, h);
    }
  }
  const badges = structureBadges(o.template ?? null, o.instance ?? null);
  const ly = o.cy + px(-HEX_SIZE * o.zoom * 0.55);
  if (badges.hpText !== null) strokeFillText(ctx, o.cx, ly, badges.hpText, MONO(px(ts.hp.fontPx)), px(ts.hp.linePx), '#ffe0b2');
  if (badges.doorText) strokeFillText(ctx, o.cx, o.cy + px(HEX_SIZE * o.zoom * 0.55), badges.doorText, MONO(px(ts.door.fontPx)), px(ts.door.linePx), badges.doorOpen ? '#a5d6a7' : '#ffd9c9');
  if (o.drawElevation) {
    const top = structureElevation(o.template ?? null, o.instance ?? null);
    if (top > 0) strokeFillText(ctx, o.cx, o.cy + px(-HEX_SIZE * o.zoom * 0.72), `${top} ft`, MONO(px(ts.elevation.fontPx)), px(ts.elevation.linePx), '#ffe0b2');
  }
}

/** A ground-effect tint + centre dot, shared by the scenario map and the Map Editor
 *  (artwork/layering stay with each caller). Coordinates in the CALLER's units. */
export interface EffectMarkDrawOpts {
  cx: number;
  cy: number;
  /** Screen px per caller unit (1 = screen space, `zoom` = world space). */
  unit: number;
  zoom: number;
  color: string;
  transparentBackground?: boolean;
  /** Tint alpha (default 0.15). */
  tintAlpha?: number;
  /** Centre dot radius in SCREEN px (default max(3, 6*zoom)). */
  dotPx?: number;
}

export function drawEffectMark(ctx: CanvasRenderingContext2D, o: EffectMarkDrawOpts): void {
  const px = (screenPx: number) => screenPx / o.unit;
  ctx.save();
  if (!o.transparentBackground) {
    ctx.globalAlpha = o.tintAlpha ?? 0.15;
    fillHexPath(ctx, o.cx, o.cy, px(HEX_SIZE * o.zoom), o.color);
  }
  ctx.globalAlpha = 0.9;
  ctx.fillStyle = o.color;
  ctx.beginPath();
  ctx.arc(o.cx, o.cy, px(o.dotPx ?? Math.max(3, 6 * o.zoom)), 0, 2 * Math.PI);
  ctx.fill();
  ctx.restore();
}
