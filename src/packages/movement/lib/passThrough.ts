// src/packages/movement/lib/passThrough.ts
// Friendly-unit pass-through: a PASS-ELIGIBLE mover (Open Order / Scattered /
// Routed, or a hero <= Large) may move THROUGH a pass-eligible friendly unit's
// hex — traversal only, never a destination (no stacking). The mover and the
// unit passed must BOTH be pass-eligible, be friendly, and share a layer.
import { Unit, AllianceGroup } from '@/types/gameProtocol';
import { sameAlliance } from '@/packages/primitives';
import { isUnitInteractable } from '@/packages/units';
import { isPassThroughUnit } from './formationRules';

/**
 * Hexes a mover may TRAVERSE (enter for pathing, but never stop on) because they
 * hold a friendly pass-eligible unit. `layer` selects the pool: `ground` uses the
 * mover's `surface` (matches `computeOccupiedHexes`), `fly` uses the air layer
 * (elevation > 0, matching `airOccupiedHexes`).
 */
export function loosePassThroughHexes(
  units: Unit[],
  mover: Pick<Unit, 'id' | 'team' | 'isHero' | 'currentFormation' | 'sizeCategory'>,
  alliances: Record<string, AllianceGroup>,
  layer: 'ground' | 'fly',
  surface = 0,
): Set<string> {
  const out = new Set<string>();
  if (!isPassThroughUnit(mover)) return out;
  for (const u of units) {
    if (!isUnitInteractable(u) || u.id === mover.id) continue;
    if (!sameAlliance(u.team, mover.team, alliances)) continue;
    if (!isPassThroughUnit(u)) continue;
    const elev = u.elevation ?? 0;
    const onLayer = layer === 'fly' ? elev > 0 : elev === surface;
    if (onLayer) out.add(`${u.hex.q},${u.hex.r}`);
  }
  return out;
}
