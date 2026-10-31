// src/packages/ships/lib/componentMappers.ts
// Component Workshop mapping + validation. The ship component catalog holds
// built-in rows and optional components; weapons live in their own catalog.

import {
  ShipComponent,
  ShipComponentTemplate,
  ShipWeapon,
} from '@/types/ship';

export function slugifyComponentName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

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
    damage: '',
    minRange: 0,
    range: 0,
    maxRange: 0,
    fireCycleStep: 1,
    special: '',
    ac: row.ac ?? 10,
    imageUrl: row.imageUrl || '',
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
    damage: row.damage,
    minRange: row.minRange,
    range: row.range,
    maxRange: row.maxRange,
    fireCycleStep: row.fireCycleStep,
    special: row.special || '',
    ac: row.ac ?? 10,
    imageUrl: row.imageUrl || '',
  };
}

/** Validate the unified draft before saving. Returns an error message or null. */
export function validateShipComponentTemplate(t: ShipComponentTemplate): string | null {
  if (!t.name.trim()) return 'Name is required.';
  if (!Number.isFinite(t.mass) || t.mass < 0) return 'Mass must be 0 or more.';
  if (!Number.isFinite(t.crew) || t.crew < 0) return 'Crew must be 0 or more.';
  if (!Number.isFinite(t.cost) || t.cost < 0) return 'Cost must be 0 or more.';
  if (t.kind === 'weapon') {
    if (!t.damage.trim()) return 'Weapon damage is required.';
    if (!Number.isFinite(t.minRange) || t.minRange < 0) return 'Min range must be 0 or more.';
    if (!Number.isFinite(t.range) || t.range < 0) return 'Range must be 0 or more.';
    if (!Number.isFinite(t.maxRange) || t.maxRange < 0) return 'Max range must be 0 or more.';
    if (t.minRange > t.range) return 'Min range cannot exceed range.';
    if (t.range > t.maxRange) return 'Range cannot exceed max range.';
    if (!Number.isFinite(t.fireCycleStep) || t.fireCycleStep < 1) return 'Fire cycle must be at least 1 step.';
  }
  return null;
}

export function componentTemplateToComponentRow(t: ShipComponentTemplate) {
  return {
    name: slugifyComponentName(t.name),
    mass: t.mass,
    crew: t.crew,
    cost: t.cost,
    hittable: t.hittable,
    effect: t.effect || null,
    built_in: t.builtIn,
    ac: t.ac,
    image_url: t.imageUrl || '',
  };
}

export function componentTemplateToWeaponRow(t: ShipComponentTemplate) {
  return {
    name: slugifyComponentName(t.name),
    mass: t.mass,
    damage: t.damage,
    min_range: t.minRange,
    range: t.range,
    max_range: t.maxRange,
    fire_cycle_step: t.fireCycleStep,
    crew: t.crew,
    cost: t.cost,
    special: t.special || null,
    ac: t.ac,
    image_url: t.imageUrl || '',
  };
}
