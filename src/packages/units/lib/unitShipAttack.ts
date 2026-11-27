// src/packages/units/lib/unitShipAttack.ts
// Classification for unit attacks against Spelljammer ships. Personal weapons
// cannot damage a ship; magic, siege engines and Huge+ units follow the
// ship-damage rules (docs/dev/21, docs/dev/outstanding.md).
import type { Weapon } from './weaponParser';

export type UnitShipAttackClass = 'personal' | 'magic-single' | 'magic-aoe' | 'warmachine' | 'huge';

/** Huge and larger units attack ships like ship weapons. */
export const HUGE_SHIP_ATTACK_SIZE = 300;

export function classifyUnitShipAttack(
  unit: { sizeCategory?: number | null },
  weapon: Pick<Weapon, 'warMachine' | 'magicDimension' | 'isHealing' | 'attackClass'>,
): UnitShipAttackClass {
  if (Number(unit.sizeCategory ?? 0) >= HUGE_SHIP_ATTACK_SIZE) return 'huge';
  if (weapon.attackClass === 'personal') return 'personal';
  if (weapon.attackClass === 'warmachine') return 'warmachine';
  if (weapon.attackClass === 'magic') {
    return (weapon.magicDimension ?? 0) > 0 ? 'magic-aoe' : 'magic-single';
  }
  if (weapon.warMachine) return 'warmachine';
  if ((weapon.magicDimension ?? 0) > 0) return 'magic-aoe';
  if (weapon.isHealing) return 'magic-single';
  return 'personal';
}

/** The best (longest-range) equipped weapon that can reach a target distance. */
export function unitShipAttackWeapon(
  weapons: Weapon[],
  distance: number,
): Weapon | null {
  let best: Weapon | null = null;
  for (const weapon of weapons) {
    const min = Math.max(0, weapon.minRange ?? 0);
    if (distance < min || distance > weapon.maxRange) continue;
    if (!best || weapon.maxRange > best.maxRange) best = weapon;
  }
  return best;
}
