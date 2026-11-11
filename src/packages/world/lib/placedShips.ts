// Scenario-placed ship markers. Stored in `scenarios.map_data.ships`; this is
// the placement layer only (no ship engine/combat state yet).

import { Hex } from '@/types/gameProtocol';

export interface PlacedShip {
  id: string;
  templateId: string;
  name: string;
  role: string | null;
  imageUrl: string;
  keelLength: number;
  imageOffsetY: number;
  hex: Hex;
  /** Derived from the helm occupant (render-only); null = unmanned/no alliance. */
  alliance?: 'friendly' | 'enemy' | 'neutral' | null;
}

function numberOr(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function parsePlacedShips(raw: unknown): PlacedShip[] {
  if (!Array.isArray(raw)) return [];
  const ships: PlacedShip[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, any>;
    const hex = row.hex;
    if (!hex || !Number.isFinite(Number(hex.q)) || !Number.isFinite(Number(hex.r))) continue;
    const id = typeof row.id === 'string' ? row.id : '';
    const name = typeof row.name === 'string' ? row.name : '';
    if (!id || !name) continue;
    const q = Number(hex.q);
    const r = Number(hex.r);
    ships.push({
      id,
      templateId: typeof row.templateId === 'string' ? row.templateId : '',
      name,
      role: typeof row.role === 'string' ? row.role : null,
      imageUrl: typeof row.imageUrl === 'string' ? row.imageUrl : '',
      keelLength: numberOr(row.keelLength, 100),
      imageOffsetY: numberOr(row.imageOffsetY, 0),
      hex: { q, r, s: -q - r },
    });
  }
  return ships;
}
