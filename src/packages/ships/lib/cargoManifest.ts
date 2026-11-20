// src/packages/ships/lib/cargoManifest.ts
// Pure cargo-manifest helpers shared by the Ship Editor and the scenario ship
// window. Items have no owner/team and quantities use the category unit:
// Food & water = person-days, Ship repair kit = kits, everything else = tons.

import { CargoCategory, CargoManifestItem } from '@/types/ship';

export const CARGO_CATEGORIES: CargoCategory[] = [
  'food_water',
  'ship_repair_kit',
  'ammunition',
  'mission_cargo',
  'general_cargo',
];

export const CARGO_CATEGORY_LABELS: Record<CargoCategory, string> = {
  ship_repair_kit: 'Ship repair kit',
  ammunition: 'Ammunition',
  food_water: 'Food & water',
  mission_cargo: 'Mission cargo',
  general_cargo: 'General cargo',
};

/** 1 ton = 5 crew × 40 days (dried food/water). */
export const FOOD_WATER_PERSON_DAYS_PER_TON = 200;
/** One universal repair kit is 0.1 ton. */
export const REPAIR_KIT_TONS = 0.1;

const CATEGORY_UNIT_LABELS: Record<CargoCategory, string> = {
  ship_repair_kit: 'kits',
  ammunition: 'tons',
  food_water: 'person-days',
  mission_cargo: 'tons',
  general_cargo: 'tons',
};

export function cargoUnitLabel(category: CargoCategory): string {
  return CATEGORY_UNIT_LABELS[category];
}

/** Tons per one category unit. */
export function cargoUnitMass(category: CargoCategory): number {
  if (category === 'food_water') return 1 / FOOD_WATER_PERSON_DAYS_PER_TON;
  if (category === 'ship_repair_kit') return REPAIR_KIT_TONS;
  return 1;
}

/** Round a quantity to the category's smallest unit. */
export function roundCargoQuantity(category: CargoCategory, value: number): number {
  const n = Number(value) || 0;
  if (category === 'food_water' || category === 'ship_repair_kit') {
    return Math.max(0, Math.round(n));
  }
  return Math.max(0, Math.round(n * 10) / 10);
}

/** Mass of one manifest line in tons. */
export function cargoItemMass(item: CargoManifestItem): number {
  return Math.max(0, Number(item.quantity) || 0) * cargoUnitMass(item.category);
}

/** Total cargo mass in tons (one decimal at the end). */
export function cargoManifestMass(items?: CargoManifestItem[] | null): number {
  const total = (items ?? []).reduce((sum, item) => sum + cargoItemMass(item), 0);
  return Math.round(total * 10) / 10;
}

export function formatCargoMass(value: number): string {
  return String(Math.round((Number(value) || 0) * 10) / 10);
}

/** Quantity currently carried in a category (sum of its lines). */
export function cargoQuantity(items: CargoManifestItem[] | null | undefined, category: CargoCategory): number {
  return roundCargoQuantity(
    category,
    (items ?? []).filter(item => item.category === category).reduce((sum, item) => sum + (Number(item.quantity) || 0), 0),
  );
}

/** Append one cargo line (quantity rounded to the category unit). */
export function addCargoLine(items: CargoManifestItem[], line: CargoManifestItem): CargoManifestItem[] {
  return [...items, {
    name: line.name.trim() || CARGO_CATEGORY_LABELS[line.category],
    category: line.category,
    quantity: roundCargoQuantity(line.category, line.quantity),
  }];
}

/** Replace one cargo line by array index. */
export function updateCargoLine(
  items: CargoManifestItem[],
  index: number,
  line: CargoManifestItem,
): CargoManifestItem[] {
  if (index < 0 || index >= items.length) return items;
  return items.map((item, i) => i === index
    ? {
      name: line.name.trim() || CARGO_CATEGORY_LABELS[line.category],
      category: line.category,
      quantity: roundCargoQuantity(line.category, line.quantity),
    }
    : item);
}

/** Remove one cargo line by array index. */
export function removeCargoLine(items: CargoManifestItem[], index: number): CargoManifestItem[] {
  return items.filter((_, i) => i !== index);
}

/** Subtract category units (oldest lines first); 0 removes the line. */
export function consumeCargoQuantity(
  items: CargoManifestItem[],
  category: CargoCategory,
  units: number,
): CargoManifestItem[] {
  let remaining = roundCargoQuantity(category, units);
  if (remaining <= 0) return items;
  const next: CargoManifestItem[] = [];
  for (const item of items) {
    if (item.category !== category || remaining <= 0) {
      next.push(item);
      continue;
    }
    const take = Math.min(item.quantity, remaining);
    remaining -= take;
    const quantity = roundCargoQuantity(category, item.quantity - take);
    if (quantity > 0) next.push({ ...item, quantity });
  }
  return next;
}

/** Total person-days of Food & water. */
export function foodWaterPersonDays(items?: CargoManifestItem[] | null): number {
  return cargoQuantity(items, 'food_water');
}

/** Whole days the Food & water supply lasts for `people`; null when nobody is aboard. */
export function supplyDays(items: CargoManifestItem[] | null | undefined, people: number): number | null {
  if (!Number.isFinite(people) || people <= 0) return null;
  return Math.floor(foodWaterPersonDays(items) / people);
}

interface LegacyCargoItem {
  name?: unknown;
  category?: unknown;
  quantity?: unknown;
  mass?: unknown;
}

function normalizeQuantity(item: LegacyCargoItem, category: CargoCategory): number {
  if (item.quantity != null && Number.isFinite(Number(item.quantity))) {
    return roundCargoQuantity(category, Number(item.quantity));
  }
  if (item.mass != null && Number.isFinite(Number(item.mass))) {
    const mass = Number(item.mass) || 0;
    if (category === 'food_water') {
      return roundCargoQuantity(category, mass * FOOD_WATER_PERSON_DAYS_PER_TON);
    }
    if (category === 'ship_repair_kit') {
      return roundCargoQuantity(category, mass / REPAIR_KIT_TONS);
    }
    return roundCargoQuantity(category, mass);
  }
  return 0;
}

/**
 * Sanitize stored manifest JSON into typed items. Legacy `{mass}` items are
 * converted to quantities. Each line keeps its own name/category, so multiple
 * entries of the same category (e.g. Ore and Furniture as General cargo) stay
 * separate.
 */
export function normalizeCargoManifest(raw: unknown): CargoManifestItem[] {
  if (!Array.isArray(raw)) return [];
  const items: CargoManifestItem[] = [];

  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const item = entry as LegacyCargoItem;
    const category = CARGO_CATEGORIES.includes(item.category as CargoCategory)
      ? (item.category as CargoCategory)
      : 'general_cargo';
    const quantity = normalizeQuantity(item, category);
    if (quantity <= 0) continue;
    const name = typeof item.name === 'string' && item.name.trim()
      ? item.name.trim()
      : CARGO_CATEGORY_LABELS[category];
    items.push({ name, category, quantity });
  }
  return items;
}
