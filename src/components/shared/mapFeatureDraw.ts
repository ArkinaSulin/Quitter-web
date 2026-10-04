// src/components/shared/mapFeatureDraw.ts
// Shared canvas drawing for authored board features (hex/edge structures, their
// HP / door / destroyed badges, and the MP-cost number) used by BOTH the scenario
// map (`useCanvasDraw`) and the Map Editor (`MapCanvas`). The two canvases differ
// in coordinate model (screen-space vs world-space) and image loading, so each
// keeps its own loop and passes a pixel mapper + font/line-width scaler here.
import { StructureTemplate, StructureInstance } from '@/types/structure';
import { structureDoorState } from '@/lib/mapStructures';

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
