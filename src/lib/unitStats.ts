import { Unit, Formation, SizeCategory, AllianceGroup } from '@/types/gameProtocol';
import { parseWeapons } from '@/lib/weaponParser';
import { getBandSetting, getSetting, SettingBand } from '@/lib/settingsCache';
import { isUnitRouted, areHexesAdjacent, isHeroMoraleBoostEnabled } from '@/lib/unitMorale';
import { AttackDirection } from '@/lib/attackDirection';

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

/**
 * Effective AC against an attack from `direction`. The shield is 360° (baked into
 * `baselineAc`) and two-handed/routing still drop it everywhere. The formation's
 * AC term applies front/flank only — a formation gives NO AC bonus from the rear
 * (uniform rule) — and is split by attack type: `melee_ac_modifier` for melee,
 * `range_ac_modifier` for ranged (`isRanged`; bows/thrown and single-target magic
 * weapons alike). Values are data-driven; both default 0 when absent.
 * Heroes have no rear (all sides are front).
 */
export function effectiveAc(
  unit: Pick<Unit, 'baselineAc' | 'isShielded' | 'weaponString' | 'activeWeaponIndex' | 'currentFormation' | 'isHero'>,
  formation: Formation | null | undefined,
  direction: AttackDirection,
  isRanged = false,
): number {
  const dir = unit.isHero || unit.currentFormation === 'Hero' ? 'front' : direction;
  const formationAc = dir === 'rear'
    ? 0
    : (isRanged ? (formation?.range_ac_modifier ?? 0) : (formation?.melee_ac_modifier ?? 0));
  return (unit.baselineAc || 10) + formationAc - getShieldPenalty(unit).penalty;
}

/**
 * Heroic capacity aura: the extra attack-capacity multiplier granted to `unit`
 * when a same-alliance HERO within the 7 hexes is LEADING (attached front) or
 * INSPIRED. Value = the `heroic_capacity_multiplier` setting (decimal, seed 1,
 * added on top of the formation's attack capacity). Heroes never receive it;
 * several heroes do not stack (the single setting value). Gated by the ambient
 * scenario toggle. Returns 0 when nothing applies.
 */
export function heroicCapacityBonus(
  unit: Pick<Unit, 'isHero' | 'hex' | 'team'>,
  units: Unit[],
  alliances: Record<string, AllianceGroup>,
): number {
  if (unit.isHero) return 0;
  if (!isHeroMoraleBoostEnabled()) return 0;
  const bonus = getSetting('heroic_capacity_multiplier', 1);
  if (!bonus) return 0;
  const unitAlliance = alliances[unit.team] || 'friendly';
  for (const src of units) {
    if (!src.isHero || src.isDeleted || src.hidden || (src.currentUnitHp ?? 0) <= 0) continue;
    if ((alliances[src.team] || 'friendly') !== unitAlliance) continue;
    const leading = !!src.attachedToUnitId && src.attachedPosition === 'front';
    if (!leading && !src.heroicInspirationActive) continue;
    const sameHex = src.hex.q === unit.hex.q && src.hex.r === unit.hex.r;
    if (!sameHex && !areHexesAdjacent(src.hex, unit.hex)) continue;
    return bonus;
  }
  return 0;
}
