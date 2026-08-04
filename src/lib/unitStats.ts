import { Unit, Formation, SizeCategory } from '@/types/gameProtocol';
import { parseWeapons } from '@/lib/weaponParser';

export function computeEffectiveAc(unit: Unit, formationModifier: number): number {
  return unit.baselineAc + formationModifier;
}

export function computeEffectiveMovement(unit: Unit, movementMultiplier: number): number {
  return Math.max(1, Math.floor(unit.movementPoints * movementMultiplier));
}

export function computeEffectiveAttackBonus(weaponAttackBonus: number, formationModifier: number): number {
  return weaponAttackBonus + formationModifier;
}

export function getFormationModifier(formations: Record<string, Formation>, formationName: string | undefined, key: keyof Formation): number {
  if (!formationName) return 0;
  const f = formations[formationName];
  if (!f) return 0;
  return (f[key] as number) ?? 0;
}

export function getFormationMultiplier(formations: Record<string, Formation>, formationName: string | undefined, key: keyof Formation): number {
  if (!formationName) return 1;
  const f = formations[formationName];
  if (!f) return 1;
  return (f[key] as number) ?? 1;
}

export function getRowCapacity(sizeCategories: SizeCategory[], sizeCategory: number): number {
  const sc = sizeCategories.find(s => s.size_category === sizeCategory);
  if (sc) return sc.row_capacity;
  if (sizeCategory >= 400) return 1;
  if (sizeCategory >= 300) return 2;
  if (sizeCategory >= 200) return 5;
  return 10;
}

export function getVisualDotsPerRow(formationsMap: Record<string, Formation>, rowCapacity: number, formationName: string): number {
  const mult = getFormationMultiplier(formationsMap, formationName, 'row_capacity_multiplier');
  return Math.max(1, rowCapacity * mult);
}

/**
 * Shield penalty while wielding a two-handed weapon. A shielded unit loses its
 * shield bonus (2 AC) whenever the active weapon is two-handed. Units without a
 * shield are unaffected.
 */
export function getShieldPenalty(unit: Pick<Unit, 'isShielded' | 'weaponString' | 'activeWeaponIndex'>): number {
  if (!unit.isShielded) return 0;
  const activeWeapon = parseWeapons(unit.weaponString || '')[unit.activeWeaponIndex ?? 0];
  return activeWeapon?.isTwoHanded ? 2 : 0;
}
