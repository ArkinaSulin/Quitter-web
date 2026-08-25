import { Unit, Formation, SizeCategory } from '@/types/gameProtocol';
import { parseWeapons } from '@/lib/weaponParser';
import { getBandSetting, SettingBand } from '@/lib/settingsCache';
import { isUnitRouted } from '@/lib/unitMorale';

// Code fallback matches migration 042 seed — the size_categories table row wins
// in getRowCapacity; this is the fallback base for unknown categories.
const DEFAULT_ROW_CAPACITY_BANDS: SettingBand[] = [
  { min: 400, value: 1 },
  { min: 300, value: 2 },
  { min: 200, value: 5 },
  { min: 0, value: 10 },
];

/** Base row capacity by size_category (band setting; single source of truth). */
export function getRowCapacityBase(sizeCategory: number): number {
  return getBandSetting('row_capacity_by_size', DEFAULT_ROW_CAPACITY_BANDS, sizeCategory);
}

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
  return getRowCapacityBase(sizeCategory);
}

export function getVisualDotsPerRow(formationsMap: Record<string, Formation>, rowCapacity: number, formationName: string): number {
  const mult = getFormationMultiplier(formationsMap, formationName, 'row_capacity_multiplier');
  return Math.max(1, rowCapacity * mult);
}

/**
 * Shield penalty for a unit: 2 when the shield is unusable (two-handed weapon
 * active, or the unit is routing and drops its shield). Units without a shield are
 * unaffected. Returns `{ penalty, reason }` so the UI can explain why.
 */
export function getShieldPenalty(
  unit: Pick<Unit, 'isShielded' | 'weaponString' | 'activeWeaponIndex' | 'currentFormation'>,
): { penalty: number; reason?: 'two-handed' | 'routing' } {
  if (!unit.isShielded) return { penalty: 0 };
  if (isUnitRouted(unit)) return { penalty: 2, reason: 'routing' };
  const activeWeapon = parseWeapons(unit.weaponString || '')[unit.activeWeaponIndex ?? 0];
  if (activeWeapon?.isTwoHanded) return { penalty: 2, reason: 'two-handed' };
  return { penalty: 0 };
}
