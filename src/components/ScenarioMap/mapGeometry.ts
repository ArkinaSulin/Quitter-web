// src/components/ScenarioMap/mapGeometry.ts
// Map constants + token geometry shared by the canvas draw hook and the map.
import { Unit } from '@/types/gameProtocol';
import { hexToPixel } from '@/hooks/useHexGrid';

export const HEX_SIZE = 100;
export const TOKEN_WIDTH = HEX_SIZE * 1.6;
export const TOKEN_HEIGHT = TOKEN_WIDTH * 0.75;
export const DEFAULT_GRID_RADIUS = 12;

export interface MapBackgroundConfig {
  imageUrl: string;
  offsetX: number;
  offsetY: number;
  scale: number;
  gridRadius: number;
}

/** Pixel offset of an attached hero token around its host's hex. */
export function getAttachedHeroPos(unitHex: { q: number; r: number; s: number }, facing: number, attachedPosition: 'front' | 'back' | null = 'front') {
  const pos = hexToPixel(unitHex, HEX_SIZE);
  const vertexIndex = attachedPosition === 'back' ? (facing + 2) % 6 : (facing + 5) % 6;
  const angle = (60 * vertexIndex - 30) * Math.PI / 180;
  return {
    x: pos.x + HEX_SIZE * 0.75 * Math.cos(angle),
    y: pos.y + HEX_SIZE * 0.75 * Math.sin(angle),
  };
}

/** Corpses (HP <= 0) sort first so live tokens stacked on their hex render on top. */
export const corpseLast = (a: Unit, b: Unit) =>
  ((a.currentUnitHp ?? 0) <= 0 ? 0 : 1) - ((b.currentUnitHp ?? 0) <= 0 ? 0 : 1);
