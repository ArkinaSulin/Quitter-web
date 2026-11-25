// src/packages/ships/lib/cargoDamage.ts
// Cargo hold packing and weapon damage. A hold is split into at most its
// effective capacity (capacity minus destroyed Cargo-card boxes); full one-ton
// groups are packed first and leftover partial groups go at the end. Damage
// rolls shrink the die as boxes are destroyed, so the same box is never hit
// twice in one resolution.

import type { CargoCategory, CargoManifestItem } from '@/types/ship';
import { cargoUnitMass, formatCargoMass, roundCargoQuantity } from './cargoManifest';
import { COMPONENT_NAMES, computeCargoCapacity, type ShipBuild } from './shipStats';
import { shipHitCards } from './shipCombat';

export interface CargoBoxEntry {
  /** Source manifest line index (so removal hits the right line). */
  lineIndex: number;
  name: string;
  category: CargoCategory;
  /** Amount in the category's own unit (tons, kits, person-days). */
  quantity: number;
  /** Mass in tons. */
  tons: number;
}

export interface CargoBox {
  index: number;
  entries: CargoBoxEntry[];
  tons: number;
}

export interface CargoCapacityInfo {
  designCapacity: number;
  effectiveCapacity: number;
  destroyedCargoBoxes: number;
}

/** Design hold size vs the capacity left after Cargo-card boxes are destroyed. */
export function cargoCapacityAfterDamage(
  build: ShipBuild,
  boxState: Record<string, unknown> | null | undefined,
): CargoCapacityInfo {
  const designCapacity = computeCargoCapacity(build);
  const cargoCard = shipHitCards(build).find(card => card.name === COMPONENT_NAMES.cargo);
  const destroyedCargoBoxes = cargoCard
    ? Math.max(0, Math.min(cargoCard.tons, Number(boxState?.[cargoCard.key] ?? 0)))
    : 0;
  return {
    designCapacity,
    effectiveCapacity: Math.max(0, designCapacity - destroyedCargoBoxes),
    destroyedCargoBoxes,
  };
}

/** Pack a manifest into exactly `capacity` boxes (some may be empty). */
export function packCargoBoxes(
  items: CargoManifestItem[] | null | undefined,
  capacity: number,
): CargoBox[] {
  const cap = Math.max(0, Math.floor(capacity));
  if (cap <= 0) return [];

  const full: CargoBoxEntry[] = [];
  const leftovers: CargoBoxEntry[] = [];

  (items ?? []).forEach((item, lineIndex) => {
    const quantity = Math.max(0, Number(item.quantity) || 0);
    if (quantity <= 0) return;
    const unitMass = cargoUnitMass(item.category);
    const unitsPerTon = Math.max(1, Math.round(1 / unitMass));
    const fullCount = Math.floor(quantity / unitsPerTon);
    for (let i = 0; i < fullCount; i += 1) {
      full.push({
        lineIndex,
        name: item.name,
        category: item.category,
        quantity: unitsPerTon,
        tons: 1,
      });
    }
    const remainder = quantity - fullCount * unitsPerTon;
    if (remainder > 1e-9) {
      leftovers.push({
        lineIndex,
        name: item.name,
        category: item.category,
        quantity: remainder,
        tons: remainder * unitMass,
      });
    }
  });

  const boxes: CargoBox[] = [];
  const boxAt = (index: number): CargoBox => {
    if (!boxes[index]) boxes[index] = { index, entries: [], tons: 0 };
    return boxes[index];
  };
  const add = (box: CargoBox, entry: CargoBoxEntry) => {
    box.entries.push(entry);
    box.tons += entry.tons;
  };

  // Full one-ton groups never mix. When the hold is overloaded, extra full
  // boxes wrap from the start so the box count still equals the capacity.
  full.forEach((entry, i) => add(boxAt(i % cap), entry));

  // Leftover groups get their own box while space remains; only a full hold
  // mixes them (the last box then carries the remaining odd groups).
  for (const entry of leftovers) {
    if (boxes.length < cap) {
      add(boxAt(boxes.length), entry);
    } else {
      add(boxes[boxes.length - 1], entry);
    }
  }

  while (boxes.length < cap) boxAt(boxes.length);
  return boxes;
}

/**
 * Roll one box per cargo ton. The pool shrinks after each roll, so the die is
 * d[effectiveCapacity], d[effectiveCapacity - 1], ... and a box cannot be
 * destroyed twice in the same resolution.
 */
export function rollDestroyedCargoBoxes(
  boxes: CargoBox[],
  tons: number,
  rng: () => number = Math.random,
): CargoBox[] {
  const pool = [...boxes];
  const destroyed: CargoBox[] = [];
  const rolls = Math.max(0, Math.floor(tons));
  for (let i = 0; i < rolls && pool.length > 0; i += 1) {
    const index = Math.floor(rng() * pool.length);
    destroyed.push(pool.splice(Math.max(0, Math.min(pool.length - 1, index)), 1)[0]);
  }
  return destroyed;
}

export interface CargoDamageResult {
  items: CargoManifestItem[];
  /** Contents removed from the manifest, aggregated per destroyed box. */
  destroyedBoxes: CargoManifestItem[][];
  /** One flat list for the message and crate tooltip. */
  destroyedItems: CargoManifestItem[];
}

/** Subtract every destroyed box from its source manifest line. */
export function removeCargoBoxes(
  items: CargoManifestItem[],
  boxes: CargoBox[],
): CargoDamageResult {
  const subtract = new Map<number, number>();
  for (const box of boxes) {
    for (const entry of box.entries) {
      subtract.set(entry.lineIndex, (subtract.get(entry.lineIndex) ?? 0) + entry.quantity);
    }
  }

  const destroyedBoxes: CargoManifestItem[][] = boxes.map(box => aggregateCargoEntries(box.entries));
  const destroyedItems = aggregateCargoEntries(boxes.flatMap(box => box.entries));

  const next = items
    .map((item, index) => {
      const removed = subtract.get(index) ?? 0;
      if (removed <= 0) return item;
      return {
        ...item,
        quantity: roundCargoQuantity(item.category, Math.max(0, item.quantity - removed)),
      };
    })
    .filter(item => item.quantity > 0);

  return { items: next, destroyedBoxes, destroyedItems };
}

/** Merge entries with the same name + category (used for messages/crates). */
export function aggregateCargoEntries(entries: CargoBoxEntry[]): CargoManifestItem[] {
  const map = new Map<string, CargoManifestItem>();
  for (const entry of entries) {
    if (entry.quantity <= 0) continue;
    const key = `${entry.category}|${entry.name.trim().toLowerCase()}`;
    const current = map.get(key);
    if (current) current.quantity = roundCargoQuantity(entry.category, current.quantity + entry.quantity);
    else map.set(key, { name: entry.name, category: entry.category, quantity: entry.quantity });
  }
  return Array.from(map.values());
}

function formatCargoQuantity(item: CargoManifestItem): string {
  if (item.category === 'general_cargo' || item.category === 'mission_cargo' || item.category === 'ammunition') {
    return `${formatCargoMass(item.quantity)}t`;
  }
  if (item.category === 'ship_repair_kit') {
    const qty = Math.round(item.quantity);
    return `${qty} kit${qty === 1 ? '' : 's'}`;
  }
  const qty = Math.round(item.quantity);
  return `${qty} person-day${qty === 1 ? '' : 's'}`;
}

/** Merge manifest lines with the same name + category (used for one debris barrel). */
export function mergeCargoItems(items: CargoManifestItem[]): CargoManifestItem[] {
  const map = new Map<string, CargoManifestItem>();
  for (const item of items) {
    const quantity = Math.max(0, Number(item.quantity) || 0);
    if (quantity <= 0) continue;
    const key = `${item.category}|${item.name.trim().toLowerCase()}`;
    const current = map.get(key);
    if (current) current.quantity = roundCargoQuantity(item.category, current.quantity + quantity);
    else map.set(key, { name: item.name, category: item.category, quantity });
  }
  return Array.from(map.values());
}

/** Short human list for the shot message: "2t Ore, 4 kits". */
export function cargoDamageSummary(items: CargoManifestItem[]): string {
  return items
    .filter(item => item.quantity > 0)
    .map(item => `${formatCargoQuantity(item)} ${item.name}`)
    .join(', ');
}
