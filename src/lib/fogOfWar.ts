// src/lib/fogOfWar.ts
// Fog-of-war reveal + darkvision. Pure functions shared by the scenario map
// (live + replay) and tested. Effective sight of a unit =
// max(scenario sight_radius, unit.darkvision); the unit's own hex is not counted
// in the radius but is always visible (the unit stands there). Units of the same
// alliance share sight.
//
// Visibility is GRADED near the edge of sight (soft fog rings), not binary: the
// outermost revealed ring is dimmed 0.6, the ring just inside 0.30, inner rings
// are crisp. Where more than one unit reveals a hex, the CLEAREST coverage wins
// (lowest alpha). Hexes no unit of the group can see are "unseen" — the drawer
// fills those with an opaque veil for players (1.0) and a translucent one for the
// DM/replay (0.5) so they can see through the boundary.

import { Unit, AllianceGroup, hexDistance } from '@/types/gameProtocol';

export const DEFAULT_SIGHT_RADIUS = 2;

// Dimmed-edge alpha values: outer revealed ring (distance == sight) vs the next
// ring in (distance == sight - 1).
export const FOG_OUTER_RING_ALPHA = 0.6;
export const FOG_INNER_RING_ALPHA = 0.3;
// Unseen hexes: opaque for players, translucent for the DM / replay viewer.
export const FOG_UNSEEN_PLAYER_ALPHA = 1.0;
export const FOG_UNSEEN_GM_ALPHA = 0.7;

export function hexKey(hex: { q: number; r: number; s: number }): string {
  return `${hex.q},${hex.r}`;
}

/** How many hexes a unit reveals beyond its own hex. */
export function unitSightRadius(
  unit: Pick<Unit, 'darkvision'>,
  baseSight: number,
): number {
  return Math.max(Math.max(1, baseSight), unit.darkvision || 0);
}

/** The set of hex keys a group can currently see: every hex within `sight` hexes
 *  of any living unit whose alliance group equals `group`. Own hex included
 *  (distance 0) — the radius counts hexes beyond it. */
export function computeVisibleHexes(
  units: Pick<Unit, 'team' | 'hex' | 'isDeleted' | 'currentUnitHp' | 'darkvision'>[],
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

export interface FogResult {
  /** Every hex the group can currently see (targetable / hoverable). */
  reveal: Set<string>;
  /** Revealed hexes at the dimmed edge of sight: hexKey -> alpha (0.3 or 0.6).
   *  Hexes fully inside sight are crisp and absent. */
  dim: Map<string, number>;
}

/**
 * Graded fog-of-war reveal for a group. Every hex within a group unit's sight is
 * `reveal`ed; hexes on that unit's outermost ring get `FOG_OUTER_RING_ALPHA`, the
 * ring just inside `FOG_INNER_RING_ALPHA`, and hexes closer than that are crisp
 * (absent from `dim`). Where several units see the same hex the CLEAREST wins
 * (lowest alpha). Unseen hexes (in neither structure) are filled by the drawer
 * with the role-appropriate opaque/translucent veil.
 */
export function computeFog(
  units: Pick<Unit, 'team' | 'hex' | 'isDeleted' | 'currentUnitHp' | 'darkvision'>[],
  group: AllianceGroup,
  alliances: Record<string, AllianceGroup>,
  baseSight: number,
): FogResult {
  const reveal = new Set<string>();
  // Clearest alpha seen for each revealed hex (0 = crisp). Kept over every
  // revealing unit so a unit hugging a hex clears a farther unit's dim edge.
  const best = new Map<string, number>();
  for (const unit of units) {
    if (unit.isDeleted) continue;
    if ((alliances[unit.team] || 'friendly') !== group) continue;
    const r = unitSightRadius(unit, baseSight);
    for (let dq = -r; dq <= r; dq++) {
      for (let dr = -r; dr <= r; dr++) {
        const s = -dq - dr;
        if (Math.abs(s) > r) continue;
        const hex = { q: unit.hex.q + dq, r: unit.hex.r + dr, s: unit.hex.s + s };
        const d = hexDistance(unit.hex, hex);
        if (d > r) continue;
        const key = hexKey(hex);
        reveal.add(key);
        // Gradient by distance from THIS unit: its own hex (d 0) and anything two
        // rings inside its sight are crisp; d == sight-1 dims 0.3; the outer ring
        // dims 0.6. A sight-1 unit only dims its ring-1 neighbors, not its hex.
        const alpha = d === r ? FOG_OUTER_RING_ALPHA : d > 0 && d === r - 1 ? FOG_INNER_RING_ALPHA : 0;
        const existing = best.get(key);
        if (existing === undefined || alpha < existing) best.set(key, alpha);
      }
    }
  }
  const dim = new Map<string, number>();
  best.forEach((alpha, key) => {
    if (alpha > 0) dim.set(key, alpha);
  });
  return { reveal, dim };
}
