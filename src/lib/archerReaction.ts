// src/lib/archerReaction.ts
import { Unit, AllianceGroup } from '@/types/gameProtocol';
import { Weapon, parseWeapons } from '@/lib/weaponParser';
import { isUnitRouted } from '@/lib/unitMorale';
import { hexDistance } from '@/types/gameProtocol';

/** A weapon that can shoot beyond adjacency (bow, thrown, magic). */
export function isRangedCapableWeapon(w: Pick<Weapon, 'range' | 'maxRange'> | null | undefined): boolean {
  if (!w) return false;
  const range = w.range ?? 1;
  const maxRange = w.maxRange ?? range;
  return maxRange > 1 || range > 1;
}

/** A reaction reposition is capped at 50% of the unit's max movement. */
export function getReactionMoveBudget(maxMP: number): number {
  return Math.max(1, Math.floor(maxMP * 0.5));
}

/**
 * Archers that may react to `mover` finishing a move: hostile alliance, has an
 * action, holds a ranged-capable active weapon, hasn't used its reaction this
 * turn, and stands within that weapon's `range` (not maxRange) of the mover.
 * Hidden / deleted / routed units are never eligible on either side.
 */
export function findEligibleReactionArchers(
  mover: Unit,
  units: Unit[],
  alliances: Record<string, AllianceGroup>,
): Unit[] {
  const moverAlliance = alliances[mover.team] || 'friendly';
  return units.filter(o => {
    if (o.id === mover.id || o.isDeleted || o.hidden || isUnitRouted(o)) return false;
    if ((alliances[o.team] || 'friendly') === moverAlliance) return false;
    if ((o.actionsAvailable ?? 0) < 1 || o.archerReactionUsed) return false;
    const weapon = parseWeapons(o.weaponString || '')[o.activeWeaponIndex ?? 0];
    if (!weapon || !isRangedCapableWeapon(weapon)) return false;
    return hexDistance(o.hex, mover.hex) <= weapon.range;
  });
}
