// src/packages/ships/lib/componentMappers.ts
// Component Workshop mapping + validation. The ship component catalog holds
// built-in rows and optional components; weapons live in their own catalog.

import {
  ShipComponent,
  ShipComponentTemplate,
  ShipWeapon,
} from '@/types/ship';

export function mapComponentToTemplate(row: ShipComponent): ShipComponentTemplate {
  return {
    id: row.id,
    kind: 'component',
    name: row.name,
    mass: row.mass,
    crew: row.crew,
    hittable: row.hittable,
    cost: row.cost,
    effect: row.effect || '',
    builtIn: row.builtIn,
    canCombine: row.canCombine,
    dt: row.dt,
    damage: '',
    minRange: 0,
    range: 0,
    maxRange: 0,
    reloadSteps: 0,
    maxTargets: 1,
    magicDimension: 0,
    shape: 'circle',
    savingThrow: 'Dex',
    saveDC: 10,
    onSaveHalfOrNeg: true,
    special: '',
    ac: row.ac ?? 10,
    imageUrl: row.imageUrl || '',
    isRam: !!row.isRam,
    ownerId: row.ownerId ?? null,
  };
}

export function mapWeaponToTemplate(row: ShipWeapon): ShipComponentTemplate {
  return {
    id: row.id,
    kind: 'weapon',
    name: row.name,
    mass: row.mass,
    crew: row.crew,
    hittable: true,
    cost: row.cost,
    effect: '',
    builtIn: false,
    canCombine: true,
    dt: row.dt,
    damage: row.damage,
    minRange: row.minRange,
    range: row.range,
    maxRange: row.maxRange,
    reloadSteps: row.reloadSteps,
    maxTargets: row.maxTargets,
    magicDimension: row.magicDimension,
    shape: row.shape,
    savingThrow: row.savingThrow,
    saveDC: row.saveDC,
    onSaveHalfOrNeg: row.onSaveHalfOrNeg,
    special: row.special || '',
    ac: row.ac ?? 10,
    imageUrl: row.imageUrl || '',
    isRam: false,
    ownerId: row.ownerId ?? null,
  };
}

/** Validate the unified draft before saving. Returns an error message or null. */
export function validateShipComponentTemplate(t: ShipComponentTemplate): string | null {
  if (!t.name.trim()) return 'Name is required.';
  if (!Number.isFinite(t.mass) || t.mass < 0) return 'Mass must be 0 or more.';
  if (!Number.isFinite(t.crew) || t.crew < 0) return 'Crew must be 0 or more.';
  if (!Number.isFinite(t.cost) || t.cost < 0) return 'Cost must be 0 or more.';
  if (!Number.isFinite(t.dt) || t.dt < 0) return 'Damage threshold must be 0 or more.';
  if (t.kind === 'weapon') {
    if (!t.damage.trim()) return 'Enter weapon damage.';
    if (!Number.isFinite(t.minRange) || t.minRange < 0) return 'Min range must be 0 or more.';
    if (!Number.isFinite(t.range) || t.range < 0) return 'Range must be 0 or more.';
    if (!Number.isFinite(t.maxRange) || t.maxRange < 0) return 'Max range must be 0 or more.';
    if (t.minRange > t.range) return 'Min range cannot exceed range.';
    if (t.range > t.maxRange) return 'Range cannot exceed max range.';
    if (!Number.isFinite(t.reloadSteps) || t.reloadSteps < 0) return 'Reload steps must be 0 or more.';
    if (!Number.isFinite(t.maxTargets) || t.maxTargets < 1) return 'Max targets must be 1 or more.';
    if (!Number.isFinite(t.magicDimension) || t.magicDimension < 0) return 'Area dimension must be 0 or more.';
    if (!Number.isFinite(t.saveDC) || t.saveDC < 0) return 'Save DC must be 0 or more.';
  }
  return null;
}

export function componentTemplateToComponentRow(t: ShipComponentTemplate) {
  return {
    name: t.name.trim(),
    mass: t.mass,
    crew: t.crew,
    cost: t.cost,
    hittable: t.hittable,
    effect: t.effect || null,
    built_in: t.builtIn,
    can_combine: t.canCombine,
    dt: t.dt,
    ac: t.ac,
    image_url: t.imageUrl || '',
  };
}

export function componentTemplateToWeaponRow(t: ShipComponentTemplate) {
  return {
    name: t.name.trim(),
    mass: t.mass,
    damage: t.damage,
    min_range: t.minRange,
    range: t.range,
    max_range: t.maxRange,
    reload_steps: t.reloadSteps,
    max_targets: t.maxTargets,
    dt: t.dt,
    crew: t.crew,
    cost: t.cost,
    magic_dimension: t.magicDimension,
    shape: t.shape,
    saving_throw: t.savingThrow,
    save_dc: t.saveDC,
    on_save_half_or_neg: t.onSaveHalfOrNeg,
    special: t.special || null,
    ac: t.ac,
    image_url: t.imageUrl || '',
  };
}
