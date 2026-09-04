// src/lib/mapEntities.ts
// Map-entity domain types + row mappers. A map entity is an authored, reusable
// board: background image (map_images) + placement + grid radius + per-hex MP
// entry costs (terrain_costs). Scenarios snapshot one into scenarios.map_data.

import { TerrainCosts } from '@/components/ScenarioMap/mapGeometry';

/** Reserved per-hex authored effects (future map-effects pass). Unused in v1. */
export type MapHexEffect = {
  q: number;
  r: number;
  effectId: string;
};

export interface MapEntity {
  id: string;
  name: string;
  description: string;
  imageUrl: string;
  offsetX: number;
  offsetY: number;
  scale: number;
  gridRadius: number;
  terrainCosts: TerrainCosts;
  hexEffects: MapHexEffect[];
  createdAt: string;
  updatedAt: string;
}

export const MAP_DEFAULTS = {
  scale: 1,
  gridRadius: 12,
};

/** Parse a maps row (snake_case) into a MapEntity. */
export function mapMapRow(row: any): MapEntity {
  return {
    id: row.id,
    name: row.name || 'Untitled map',
    description: row.description || '',
    imageUrl: row.image_url || '',
    offsetX: Number(row.offset_x) || 0,
    offsetY: Number(row.offset_y) || 0,
    scale: Number(row.scale) || MAP_DEFAULTS.scale,
    gridRadius: Number(row.grid_radius) || MAP_DEFAULTS.gridRadius,
    terrainCosts: parseTerrainCosts(row.terrain_costs),
    hexEffects: Array.isArray(row.hex_effects) ? row.hex_effects : [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Sanitize the jsonb terrain blob into a Record<"q,r", cost 0..9>. */
export function parseTerrainCosts(raw: any): TerrainCosts {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: TerrainCosts = {};
  for (const [key, v] of Object.entries(raw)) {
    const n = Math.round(Number(v));
    if (Number.isFinite(n) && n >= 0 && n <= 9 && /^-?\d+,-?\d+$/.test(key)) {
      out[key] = n;
    }
  }
  return out;
}

/** Map a MapEntity to a snake_case maps row for INSERT/UPDATE. */
export function mapEntityToRow(entity: MapEntity, creatorId?: string) {
  return {
    name: entity.name || 'Untitled map',
    description: entity.description || '',
    image_url: entity.imageUrl || '',
    offset_x: entity.offsetX || 0,
    offset_y: entity.offsetY || 0,
    scale: entity.scale || MAP_DEFAULTS.scale,
    grid_radius: entity.gridRadius || MAP_DEFAULTS.gridRadius,
    terrain_costs: entity.terrainCosts || {},
    hex_effects: entity.hexEffects || [],
    created_by: creatorId,
  };
}
