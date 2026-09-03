// src/lib/fogOfWar.ts
// Fog-of-war reveal + darkvision. Pure functions shared by the scenario map
// (live + replay) and tested. Effective sight of a unit =
// max(scenario sight_radius, unit.darkvision); the unit's own hex is not counted
// in the radius but is always visible (the unit stands there). Units of the same
// alliance share sight — EXCEPT hidden units, which exert no reveal at all (a
// concealed unit does not light up the map for its side).
//
// Visibility is GRADED at the edge of sight (soft fog rings), not binary: the dim
// band is edge-anchored and up to 3 rings deep — the outermost revealed ring
// dims 0.45, the next 0.30, the next 0.15 — and everything deeper (plus the
// unit's own hex) is crisp. Where more than one unit reveals a hex, the CLEAREST
// coverage wins (lowest alpha). Hexes no unit of the group can see are "unseen" —
// the drawer fills those with an opaque veil for players (1.0) and a translucent
// one for the DM/replay (0.6) so they can see through the boundary.

import { Unit, AllianceGroup, hexDistance } from '@/types/gameProtocol';

export const DEFAULT_SIGHT_RADIUS = 2;

// Dimmed-edge alpha values from a unit's sight edge inward (edge -> next -> next).
export const FOG_RING_ALPHAS = [0.6, 0.4, 0.2];
// Unseen hexes: opaque for players, translucent for the DM / replay viewer.
export const FOG_UNSEEN_PLAYER_ALPHA = 1.0;
export const FOG_UNSEEN_GM_ALPHA = 0.8;

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

type SightUnit = Pick<Unit, 'team' | 'hex' | 'isDeleted' | 'hidden' | 'currentUnitHp' | 'darkvision'>;

/** True when a unit contributes sight to its alliance group's reveal. Hidden units
 *  never reveal anything (they act concealed); deleted units neither. */
function revealsSight(unit: SightUnit, group: AllianceGroup, alliances: Record<string, AllianceGroup>): boolean {
  if (unit.isDeleted || unit.hidden) return false;
  return (alliances[unit.team] || 'friendly') === group;
}

/** The set of hex keys a group can currently see: every hex within `sight` hexes
 *  of any living, NON-hidden unit whose alliance group equals `group`. Own hex
 *  included (distance 0) — the radius counts hexes beyond it. */
export function computeVisibleHexes(
  units: SightUnit[],
  group: AllianceGroup,
  alliances: Record<string, AllianceGroup>,
  baseSight: number,
): Set<string> {
  const visible = new Set<string>();
  for (const unit of units) {
    if (!revealsSight(unit, group, alliances)) continue;
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
  /** Revealed hexes at the dimmed edge of sight: hexKey -> alpha (0.15/0.30/0.45).
   *  Hexes fully inside sight are crisp and absent. */
  dim: Map<string, number>;
}

/**
 * Graded fog-of-war reveal for a group. Every hex within a group unit's sight is
 * `reveal`ed; a hex `ringsIn` = (sight − distance) rings inside that unit's edge
 * dims `FOG_RING_ALPHAS[ringsIn]` (0.45 edge → 0.30 → 0.15), and hexes deeper
 * than that (or the unit's own hex) are crisp (absent from `dim`). Where several
 * units see the same hex the CLEAREST wins (lowest alpha). Hidden units exert no
 * reveal. Unseen hexes (in neither structure) are filled by the drawer with the
 * role-appropriate opaque/translucent veil.
 */
export function computeFog(
  units: SightUnit[],
  group: AllianceGroup,
  alliances: Record<string, AllianceGroup>,
  baseSight: number,
): FogResult {
  const reveal = new Set<string>();
  // Clearest alpha seen for each revealed hex (0 = crisp). Kept over every
  // revealing unit so a unit hugging a hex clears a farther unit's dim edge.
  const best = new Map<string, number>();
  for (const unit of units) {
    if (!revealsSight(unit, group, alliances)) continue;
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
        // Edge-anchored band: d == sight -> 0.45, sight-1 -> 0.30, sight-2 -> 0.15;
        // own hex (d 0) and anything 3+ rings inside are crisp. A sight-1 unit only
        // dims its ring-1 neighbors (0.45), never its own hex.
        const ringsIn = r - d;
        const alpha = d > 0 && ringsIn < FOG_RING_ALPHAS.length ? FOG_RING_ALPHAS[ringsIn] : 0;
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
