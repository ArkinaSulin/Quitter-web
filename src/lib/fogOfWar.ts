// src/lib/fogOfWar.ts
// Fog-of-war reveal + night vision. Pure functions shared by the scenario map
// (live + replay) and tested. Effective sight of a unit =
// max(scenario sight_radius, unit.night_vision); the unit's own hex is not counted
// in the radius but is always visible (the unit stands there). Units of the same
// alliance share sight.

import { Unit, AllianceGroup, hexDistance } from '@/types/gameProtocol';

export const DEFAULT_SIGHT_RADIUS = 2;

export function hexKey(hex: { q: number; r: number; s: number }): string {
  return `${hex.q},${hex.r}`;
}

/** How many hexes a unit reveals beyond its own hex. */
export function unitSightRadius(
  unit: Pick<Unit, 'nightVision'>,
  baseSight: number,
): number {
  return Math.max(Math.max(1, baseSight), unit.nightVision || 0);
}

/**
 * The set of hex keys a group can currently see: every hex within `sight` hexes
 * of any living unit whose alliance group equals `group`. Own hex included
 * (distance 0) — the radius counts hexes beyond it.
 */
export function computeVisibleHexes(
  units: Pick<Unit, 'team' | 'hex' | 'isDeleted' | 'currentUnitHp' | 'nightVision'>[],
  group: AllianceGroup,
  alliances: Record<string, AllianceGroup>,
  baseSight: number,
): Set<string> {
  const visible = new Set<string>();
  for (const unit of units) {
    if (unit.isDeleted) continue;
    if ((alliances[unit.team] || 'friendly') !== group) continue;
    const r = unitSightRadius(unit, baseSight);
    for (let dq = -r; dq <= r; dq++) {
      for (let dr = -r; dr <= r; dr++) {
        const s = -dq - dr;
        if (Math.abs(s) > r) continue;
        const hex = { q: unit.hex.q + dq, r: unit.hex.r + dr, s: unit.hex.s + s };
        if (hexDistance(unit.hex, hex) <= r) visible.add(hexKey(hex));
      }
    }
  }
  return visible;
}
