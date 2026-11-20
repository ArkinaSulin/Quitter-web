// src/packages/ships/lib/weaponArcs.ts
// Per-card firing arcs. The deck region supplies a starting default (Bow/Port/
// Starboard/Stern one arc, Body all four), but the maker may remove or add any
// arc freely; the defaults are no longer protected.

import { ShipDeckRegion, WeaponArc, WeaponArcOverrides } from '@/types/ship';

export const WEAPON_ARCS: WeaponArc[] = ['bow', 'port', 'starboard', 'stern'];

export const WEAPON_ARC_LABELS: Record<WeaponArc, string> = {
  bow: 'Bow',
  port: 'Port',
  starboard: 'Starboard',
  stern: 'Stern',
};

const REGION_DEFAULT_ARC: Record<Exclude<ShipDeckRegion, 'body'>, WeaponArc> = {
  bow: 'bow',
  port: 'port',
  starboard: 'starboard',
  stern: 'stern',
};

export function defaultWeaponArcs(region: ShipDeckRegion): WeaponArc[] {
  return region === 'body' ? [...WEAPON_ARCS] : [REGION_DEFAULT_ARC[region]];
}

function clean(overrides: WeaponArcOverrides): WeaponArcOverrides | null {
  const added = Array.from(new Set(overrides.added ?? []));
  const removed = Array.from(new Set(overrides.removed ?? []));
  if (added.length === 0 && removed.length === 0) return null;
  return {
    ...(added.length > 0 ? { added } : {}),
    ...(removed.length > 0 ? { removed } : {}),
  };
}

export function effectiveWeaponArcs(
  region: ShipDeckRegion,
  overrides: WeaponArcOverrides | undefined,
): WeaponArc[] {
  const active = new Set(defaultWeaponArcs(region));
  for (const arc of overrides?.added ?? []) active.add(arc);
  for (const arc of overrides?.removed ?? []) active.delete(arc);
  return WEAPON_ARCS.filter(arc => active.has(arc));
}

export function addWeaponArc(
  overrides: WeaponArcOverrides | undefined,
  region: ShipDeckRegion,
  arc: WeaponArc,
): WeaponArcOverrides {
  if (effectiveWeaponArcs(region, overrides).includes(arc)) return overrides ?? {};
  const next: WeaponArcOverrides = {
    added: [...(overrides?.added ?? [])],
    removed: [...(overrides?.removed ?? [])],
  };
  if (next.removed?.includes(arc)) {
    next.removed = next.removed.filter(a => a !== arc);
  } else {
    next.added = [...(next.added ?? []), arc];
  }
  return clean(next) ?? {};
}

export function removeWeaponArc(
  overrides: WeaponArcOverrides | undefined,
  region: ShipDeckRegion,
  arc: WeaponArc,
): WeaponArcOverrides {
  if (!effectiveWeaponArcs(region, overrides).includes(arc)) return overrides ?? {};
  const next: WeaponArcOverrides = {
    added: [...(overrides?.added ?? [])],
    removed: [...(overrides?.removed ?? [])],
  };
  if (next.added?.includes(arc)) {
    next.added = next.added.filter(a => a !== arc);
  } else {
    next.removed = [...(next.removed ?? []), arc];
  }
  return clean(next) ?? {};
}
