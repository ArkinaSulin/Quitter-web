// src/lib/mapEntities.ts
// Map-entity domain types + row mappers. A map entity is an authored, reusable
// board: background image (map_images) + placement + grid radius + placed
// structures + authored per-hex effects. Scenarios snapshot one into
// scenarios.map_data.

import { MapStructures, parseStructures } from '@/packages/movement';
import { MapHexEffect, parseHexEffects } from '@/packages/effects';

export type { MapHexEffect };

export interface MapEntity {
  id: string;
  name: string;
  description: string;
  imageUrl: string;
  offsetX: number;
  offsetY: number;
  scale: number;
  gridRadius: number;
  /** Placed structures keyed "q,r,dir" (edge) / "q,r" (hex) (see `mapStructures.ts`). */
  structures: MapStructures;
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
    structures: parseStructures(row.structures),
    hexEffects: parseHexEffects(row.hex_effects),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
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
    structures: entity.structures || {},
    hex_effects: entity.hexEffects || [],
    created_by: creatorId,
  };
}
