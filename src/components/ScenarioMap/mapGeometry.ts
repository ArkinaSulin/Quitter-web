// src/components/ScenarioMap/mapGeometry.ts
// Map constants + hex/token geometry shared by the canvas draw hook and the map.
import { Unit, Hex, AllianceGroup, Formation } from '@/types/gameProtocol';
import { hexToPixel } from '@/hooks/useHexGrid';
import { determineCombatPosition } from '@/lib/unitCombat';
import { canStopEnemyMovement } from '@/lib/formationRules';
import { isUnitInteractable } from '@/lib/unitInteractions';
import { isUnitRouted } from '@/lib/unitMorale';

export const HEX_SIZE = 100;
export const TOKEN_WIDTH = HEX_SIZE * 1.6;
export const TOKEN_HEIGHT = TOKEN_WIDTH * 0.75;
export const DEFAULT_GRID_RADIUS = 12;

/** Painted per-hex terrain entry costs: "q,r" -> MP cost to ENTER (0 free, 1 default, 2..9 costly). */
export type TerrainCosts = Record<string, number>;

/** MP to enter hex (q,r): 1 unless the GM painted a cost there (0 = free entry). */
export function terrainCostOf(terrain: TerrainCosts | null | undefined, q: number, r: number): number {
  const v = terrain ? terrain[`${q},${r}`] : undefined;
  const c = v == null ? 1 : Math.round(v);
  return Number.isFinite(c) && c >= 0 ? c : 1;
}

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

export const HEX_DIRS = [
  { q: 1, r: 0, s: -1 },
  { q: 0, r: 1, s: -1 },
  { q: -1, r: 1, s: 0 },
  { q: -1, r: 0, s: 1 },
  { q: 0, r: -1, s: 1 },
  { q: 1, r: -1, s: 0 },
];

/** All hexes exactly at `radius` hexes from `center` (a hexagonal ring). */
export function hexRing(center: Hex, radius: number): Hex[] {
  const results: Hex[] = [];
  if (radius <= 0) return results;
  const add = (a: Hex, b: { q: number; r: number; s: number }): Hex => ({ q: a.q + b.q, r: a.r + b.r, s: a.s + b.s });
  let hex = add(center, { q: HEX_DIRS[4].q * radius, r: HEX_DIRS[4].r * radius, s: HEX_DIRS[4].s * radius });
  for (let i = 0; i < 6; i++) {
    for (let j = 0; j < radius; j++) {
      results.push(hex);
      hex = add(hex, HEX_DIRS[i]);
    }
  }
  return results;
}

export function computeOccupiedHexes(allUnits: Unit[], excludeUnitId?: string): Set<string> {
  return new Set(
    allUnits
      .filter(u => isUnitInteractable(u) && u.id !== excludeUnitId)
      .map(u => `${u.hex.q},${u.hex.r}`),
  );
}

export function computeThreatHexes(allUnits: Unit[], draggedUnitId: string, alliances: Record<string, AllianceGroup>, formationsMap: Record<string, Formation>): Set<string> {
  const draggedUnit = allUnits.find(u => u.id === draggedUnitId);
  const draggedGroup = alliances[draggedUnit?.team ?? ''] || 'friendly';
  const occupied = computeOccupiedHexes(allUnits);
  const threats = new Set<string>();
  for (const unit of allUnits) {
    if (unit.isDeleted || unit.id === draggedUnitId || unit.attachedToUnitId || unit.isHero || isUnitRouted(unit)) continue;
    const unitGroup = alliances[unit.team] || 'friendly';
    if (unitGroup === draggedGroup) continue;
    for (const dir of HEX_DIRS) {
      const nq = unit.hex.q + dir.q;
      const nr = unit.hex.r + dir.r;
      const key = `${nq},${nr}`;
      if (occupied.has(key)) continue;
      const pos = determineCombatPosition({ q: nq, r: nr, s: -nq - nr }, unit.hex, unit.facing);
      // Only formations with a zone of control in this arc stop enemy movement.
      if (canStopEnemyMovement(formationsMap[unit.currentFormation], pos)) threats.add(key);
    }
  }
  return threats;
}
