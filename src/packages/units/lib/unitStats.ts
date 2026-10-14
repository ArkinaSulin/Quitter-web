import { Unit, Formation, SizeCategory, AllianceGroup, hexDistance } from '@/types/gameProtocol';
import { parseWeapons } from '@/packages/units/lib/weaponParser';
import { getBandSetting, SettingBand } from '@/packages/infra';
import { isUnitRouted, isHeroMoraleBoostEnabled } from '@/packages/morale';
import { sameAlliance } from '@/packages/primitives';
import { AttackDirection } from '@/packages/primitives';
import { coverAcBonus, directAcBonus, modifierAmount } from '@/packages/effects';

// Code fallback matches migration 042 seed — the unit_size_categories table row wins
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
 * Effective AC against an attack from `direction`.
 *
 * Three layers:
 *  - BASE  = `baselineAc` (shield, 360°) minus the two-handed/routing drop.
 *  - COVER = max(formation AC, zone AC, wall cover). Cover never stacks — a
 *    shield wall behind a tower behind a wall only counts the best one.
 *    Formation AC is front/flank only (rear = 0); zone cover is 360°; wall
 *    cover is directional (melee or ranged, whichever the caller passes).
 *  - BUFF  = direct unit `ac` effects (e.g. Haste) — these STACK on top.
 *
 * Formation terms are split by attack type (`melee_ac_modifier` /
 * `range_ac_modifier`); heroes have no rear (all sides are front).
 */
export function effectiveAc(
  unit: Pick<Unit, 'baselineAc' | 'isShielded' | 'weaponString' | 'activeWeaponIndex' | 'currentFormation' | 'isHero'> & { effects?: Unit['effects'] },
  formation: Formation | null | undefined,
  direction: AttackDirection,
  isRanged = false,
  wallCover = 0,
  auraAc = 0,
): number {
  const dir = unit.isHero || unit.currentFormation === 'Hero' ? 'front' : direction;
  const formationAc = dir === 'rear'
    ? 0
    : (isRanged ? (formation?.range_ac_modifier ?? 0) : (formation?.melee_ac_modifier ?? 0));
  const cover = Math.max(formationAc, coverAcBonus(unit, isRanged), wallCover);
  const buff = directAcBonus(unit, isRanged);
  return (unit.baselineAc || 10) - getShieldPenalty(unit).penalty + cover + buff + auraAc;
}

/**
 * War-machine to-hit AC against a unit. A siege bolt/rock ignores ARMOUR, SHIELD
 * and FORMATION (the shield-wall), so the target defends with its UNARMOURED base
 * AC only — plus cover (edge wall or hex-structure/zone cover, never stacking) and
 * direct `ac` effects. No shield penalty, no formation AC, no hero aura. The
 * unarmoured base may itself exceed 10 (natural armour), so no flat floor is used.
 */
export function warMachineAc(
  unit: Pick<Unit, 'baseAc'> & { effects?: Unit['effects'] },
  isRanged: boolean,
  wallCover = 0,
): number {
  const base = unit.baseAc ?? 10;
  const cover = Math.max(wallCover, coverAcBonus(unit, isRanged));
  return base + cover + directAcBonus(unit, isRanged);
}

/** A hero-aura contribution to one unit: flat bonuses to its strikes and defence. */
export interface HeroAuraBonus {
  /** To-hit bonus for the unit's attacks. */
  attack: number;
  /** AC bonus (added on top of formation/cover). */
  ac: number;
  /** Flat damage bonus per landed hit (never doubled on a crit). */
  damage: number;
  /** Bonus to every saving throw. */
  save: number;
}

const ZERO_AURA: HeroAuraBonus = { attack: 0, ac: 0, damage: 0, save: 0 };

/** Same-elevation aura reach, with the source's own hex allowing a ±10 ft
 *  elevation gap (mirrors `withinAdjacencyFootprint`, generalized to any radius;
 *  radius 1 = the 8-hex footprint). */
function withinAuraRadius(
  src: Pick<Unit, 'hex' | 'elevation'>,
  victim: Pick<Unit, 'hex' | 'elevation'>,
  radius: number,
): boolean {
  if (src.hex.q === victim.hex.q && src.hex.r === victim.hex.r) {
    return Math.abs((src.elevation ?? 0) - (victim.elevation ?? 0)) <= 10;
  }
  if (hexDistance(src.hex, victim.hex) > radius) return false;
  return (src.elevation ?? 0) === (victim.elevation ?? 0);
}

/**
 * Hero AURA bonus granted to `unit` by nearby allied heroes.
 *
 * A hero's `aura` effect modifiers (attack/ac/damage/save_bonus, each with a
 * `radius`) radiate to same-alliance NON-HERO allies within that radius — heroes
 * are self-motivated and gain nothing. A hero emits its aura only while LEADING
 * (front-attached to a host) or INSPIRED. Several heroes do not stack: the best
 * value per channel wins. `isRanged` scopes the melee/ranged `attack`/`ac`/`damage`
 * channels. Gated by the ambient `hero_morale_boost_enabled` scenario toggle.
 * Returns all-zero when nothing applies.
 */
export function heroAuraBonus(
  unit: Pick<Unit, 'id' | 'isHero' | 'hex' | 'elevation' | 'team'>,
  units: Unit[],
  alliances: Record<string, AllianceGroup>,
  isRanged = false,
): HeroAuraBonus {
  if (unit.isHero) return ZERO_AURA;
  if (!isHeroMoraleBoostEnabled()) return ZERO_AURA;
  const best: HeroAuraBonus = { ...ZERO_AURA };
  for (const src of units) {
    if (src.id === unit.id) continue;
    if (!src.isHero || src.isDeleted || src.hidden || (src.currentUnitHp ?? 0) <= 0) continue;
    if (!sameAlliance(src.team, unit.team, alliances)) continue;
    const leading = !!src.attachedToUnitId && src.attachedPosition === 'front';
    if (!leading && !src.heroicInspirationActive) continue;
    const hero: HeroAuraBonus = { ...ZERO_AURA };
    for (const e of src.effects ?? []) {
      if (!e.aura) continue;
      if (!withinAuraRadius(src, unit, e.radius ?? 0)) continue;
      const amt = modifierAmount(e.dice);
      if (!amt) continue;
      if (e.kind === 'attack') { if (!modeApplies(e.mode, isRanged)) continue; hero.attack += amt; }
      else if (e.kind === 'ac') { if (!modeApplies(e.mode, isRanged)) continue; hero.ac += amt; }
      else if (e.kind === 'damage') { if (!modeApplies(e.mode, isRanged)) continue; hero.damage += amt; }
      else if (e.kind === 'save_bonus') hero.save += amt;
    }
    best.attack = Math.max(best.attack, hero.attack);
    best.ac = Math.max(best.ac, hero.ac);
    best.damage = Math.max(best.damage, hero.damage);
    best.save = Math.max(best.save, hero.save);
  }
  return best;
}

function modeApplies(mode: 'melee' | 'ranged' | undefined, isRanged: boolean): boolean {
  if (mode === 'melee' && isRanged) return false;
  if (mode === 'ranged' && !isRanged) return false;
  return true;
}
