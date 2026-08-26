// src/lib/meleeFallback.ts
import { Unit, AllianceGroup } from '@/types/gameProtocol';
import { Weapon } from '@/lib/weaponParser';
import { isInKillZone, isUnitRouted } from '@/lib/unitMorale';

/**
 * Fists: the last-resort melee weapon used by a unit whose active weapon is
 * ranged (or thrown) and that owns no melee weapon. Follows every regular melee
 * weapon rule — 1 action, AGR check, roll to hit, causes retaliation.
 */
export const FISTS_WEAPON: Weapon = {
  name: 'Fists',
  attackBonus: 0,
  damageDice: '1d1',
  isHealing: false,
  range: 1,
  maxRange: 1,
  magicDimension: 0,
  shape: 'circle',
  reach: false,
  noRetaliation: false,
  freeAction: false,
  isTwoHanded: false,
  numberOfAttacks: 1,
  onSaveHalfOrNeg: true,
  savingThrow: 'Dex',
};

/**
 * A melee weapon: both range and maxRange are 1 or under. A thrown weapon
 * (range 1 but maxRange > 1, e.g. a throw dagger) is NOT melee — it cannot be
 * used at adjacency and the unit falls back to another melee weapon or Fists.
 */
export function isMeleeWeapon(w: Pick<Weapon, 'range' | 'maxRange'> | null | undefined): boolean {
  if (!w) return false;
  const range = w.range ?? 1;
  const maxRange = w.maxRange ?? range;
  return range <= 1 && maxRange <= 1;
}

/** Index of the first melee weapon in the arsenal, or -1. */
export function findFirstMeleeWeaponIndex(weapons: Weapon[]): number {
  return weapons.findIndex(w => isMeleeWeapon(w));
}

/** A melee exchange happens at adjacency; everything further is ranged. */
export function isAdjacentDistance(dist: number): boolean {
  return dist <= 1;
}

/**
 * Is `unit` standing in the kill zone (front two hexes) of any hostile unit?
 * Hidden units are not in play and never count; deleted/routed hostiles don't
 * impose a kill zone either.
 */
export function isInAnyHostileKillZone(
  unit: Unit,
  units: Unit[],
  alliances: Record<string, AllianceGroup>,
): boolean {
  const unitAlliance = alliances[unit.team] || 'friendly';
  return units.some(other =>
    !other.isDeleted &&
    !other.hidden &&
    other.id !== unit.id &&
    !isUnitRouted(other) &&
    (alliances[other.team] || 'friendly') !== unitAlliance &&
    isInKillZone(other, unit.hex),
  );
}

/**
 * AC after switching to `weapon`: a two-handed weapon drops the shield (-2),
 * mirroring the manual WEAPON_SELECT logic in useGameEngine.
 */
export function computeWeaponSwitchAc(
  unit: Pick<Unit, 'isShielded' | 'baselineAc' | 'currentAc'>,
  weapon: Weapon,
): number {
  const shieldPenalty = unit.isShielded && weapon.isTwoHanded ? 2 : 0;
  return (unit.baselineAc || 10) - shieldPenalty;
}
