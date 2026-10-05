// src/lib/meleeFallback.ts
import { Unit, AllianceGroup, hexDistance } from '@/types/gameProtocol';
import { Weapon } from '@/lib/weaponParser';
import { isInKillZone, isUnitRouted } from '@/lib/unitMorale';
import { isHostile } from '@/lib/alliances';
import { withinVerticalGap } from '@/lib/flying';

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
  saveDC: 10,
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

/** Can these units have a MELEE exchange: horizontal adjacency (≤1 hex) AND a
 *  vertical gap of at most 10 ft. */
export function isMeleeReachable(attacker: Pick<Unit, 'hex' | 'elevation'>, target: Pick<Unit, 'hex' | 'elevation'>): boolean {
  return isAdjacentDistance(hexDistance(attacker.hex, target.hex)) && withinVerticalGap(attacker.elevation, target.elevation);
}

/**
 * Which kind of attack a weapon makes against a target, by geometry + kill zone:
 *  - a MAGIC weapon always acts at range;
 *  - at adjacency, a melee weapon is melee, and a RANGED weapon is melee only when
 *    the attacker stands in the target's kill zone (engaged frontally) — otherwise
 *    it fires at point-blank;
 *  - beyond adjacency, a ranged/thrown weapon is ranged; a melee weapon cannot
 *    reach (`none`).
 */
export function attackKind(
  weapon: Pick<Weapon, 'range' | 'maxRange' | 'magicDimension'> | null | undefined,
  isAdjacent: boolean,
  inOpponentKillZone: boolean,
): 'melee' | 'ranged' | 'none' {
  if (!weapon) return 'none';
  if ((weapon.magicDimension ?? 0) > 0) return 'ranged';
  if (isAdjacent) return (isMeleeWeapon(weapon) || inOpponentKillZone) ? 'melee' : 'ranged';
  return isMeleeWeapon(weapon) ? 'none' : 'ranged';
}

/**
 * Can `attacker` use `weapon` against `target` from its CURRENT hex? Combines
 * `attackKind` with the ranged reach rule (each 10 ft climbed adds 1 hex; shooting
 * DOWN never extends reach). Healing weapons are never usable offensively.
 */
export function canWeaponAttack(
  weapon: Pick<Weapon, 'range' | 'maxRange' | 'magicDimension' | 'isHealing'> | null | undefined,
  attacker: Unit,
  target: Unit,
  rangeBonus = 0,
): boolean {
  if (!weapon || weapon.isHealing) return false;
  const dist = hexDistance(attacker.hex, target.hex);
  const isAdjacent = isMeleeReachable(attacker, target);
  const kind = attackKind(weapon, isAdjacent, isInKillZone(target, attacker.hex, attacker.elevation));
  if (kind === 'none') return false;
  if (kind === 'ranged' && (weapon.magicDimension ?? 0) <= 0) {
    const upHex = Math.max(0, Math.floor(((target.elevation ?? 0) - (attacker.elevation ?? 0)) / 10));
    const bonus = (weapon.maxRange ?? 1) > 1 ? rangeBonus : 0;
    return dist + upHex <= (weapon.maxRange ?? 1) + bonus;
  }
  return true;
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
  return units.some(other =>
    !other.isDeleted &&
    !other.hidden &&
    other.id !== unit.id &&
    !isUnitRouted(other) &&
    isHostile(other.team, unit.team, alliances) &&
    isInKillZone(other, unit.hex, unit.elevation),
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
