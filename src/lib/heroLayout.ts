// src/lib/heroLayout.ts
// Token footprint + attached-hero layout, shared by the renderer (drawToken /
// useCanvasDraw) and the hit-tester (useHexGrid) so the drawn token and its
// grabbable box always agree. Pure — depends only on hex geometry.
import { HEX_SIZE, hexToPixel } from './hexGeometry';

export const TOKEN_WIDTH = HEX_SIZE * 1.6;
export const TOKEN_HEIGHT = TOKEN_WIDTH * 0.75;

const HERO_SQUARE_RATIOS: Record<number, number> = {
  75: 0.375,
  100: 1 / 2,
  200: 4 / 6,
  300: 5 / 6,
  400: 1,
};

/** Side length of the hero's square token for a given size category. */
export function getHeroSquareSize(unitTokenHeight: number, sizeCategory: number): number {
  const ratio = HERO_SQUARE_RATIOS[sizeCategory] || 0.5;
  return unitTokenHeight * ratio;
}

/** World-space center of an attached hero token around its host's hex. */
export function getAttachedHeroPos(
  unitHex: { q: number; r: number; s: number },
  facing: number,
  attachedPosition: 'front' | 'back' | 'rider' | null = 'front',
  sizeCategory = 100,
): { x: number; y: number } {
  const pos = hexToPixel(unitHex as any, HEX_SIZE);
  if (attachedPosition === 'rider') {
    // Mounted: the rider sits due NORTH of the mount's center, its center at 90%
    // of the mount's circle radius (slight overlap), scaling with mount size.
    const mountRadius = getHeroSquareSize(TOKEN_HEIGHT, sizeCategory) / 2 * 1.1;
    return { x: pos.x, y: pos.y - 0.9 * mountRadius };
  }
  const vertexIndex = attachedPosition === 'back' ? (facing + 2) % 6 : (facing + 5) % 6;
  const angle = (60 * vertexIndex - 30) * Math.PI / 180;
  return {
    x: pos.x + HEX_SIZE * 0.75 * Math.cos(angle),
    y: pos.y + HEX_SIZE * 0.75 * Math.sin(angle),
  };
}
