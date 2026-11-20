import { describe, expect, it } from 'vitest';
import {
  addCargoLine,
  cargoManifestMass,
  cargoQuantity,
  consumeCargoQuantity,
  foodWaterPersonDays,
  normalizeCargoManifest,
  removeCargoLine,
  roundCargoQuantity,
  supplyDays,
  updateCargoLine,
} from '@/packages/ships';

describe('cargo manifest', () => {
  it('rounds quantities by category unit', () => {
    expect(roundCargoQuantity('food_water', 12.6)).toBe(13);
    expect(roundCargoQuantity('ship_repair_kit', 2.4)).toBe(2);
    expect(roundCargoQuantity('general_cargo', 1.24)).toBe(1.2);
    expect(roundCargoQuantity('mission_cargo', -1)).toBe(0);
  });

  it('derives mass from category quantities', () => {
    expect(cargoManifestMass([
      { name: 'Dried rations', category: 'food_water', quantity: 400 }, // 2t
      { name: 'Repair kit', category: 'ship_repair_kit', quantity: 5 }, // 0.5t
      { name: 'Ammunition', category: 'ammunition', quantity: 2 }, // 2t
      { name: 'Artifact', category: 'mission_cargo', quantity: 1.5 }, // 1.5t
    ])).toBe(6);
  });

  it('keeps multiple named lines in the same category', () => {
    let items = addCargoLine([], { name: 'Ore', category: 'general_cargo', quantity: 2 });
    items = addCargoLine(items, { name: 'Furniture', category: 'general_cargo', quantity: 1 });
    expect(items).toHaveLength(2);
    expect(cargoQuantity(items, 'general_cargo')).toBe(3);

    items = updateCargoLine(items, 0, { name: 'Ore', category: 'general_cargo', quantity: 4 });
    expect(items[0].quantity).toBe(4);
    expect(cargoQuantity(items, 'general_cargo')).toBe(5);

    items = removeCargoLine(items, 1);
    expect(items).toHaveLength(1);
  });

  it('adds fixed lines and consumes units', () => {
    let items = addCargoLine([], { name: 'Ship repair kit', category: 'ship_repair_kit', quantity: 4 });
    items = addCargoLine(items, { name: 'Dried rations', category: 'food_water', quantity: 600 });
    expect(cargoQuantity(items, 'ship_repair_kit')).toBe(4);
    expect(cargoQuantity(items, 'food_water')).toBe(600);

    items = consumeCargoQuantity(items, 'ship_repair_kit', 1);
    expect(cargoQuantity(items, 'ship_repair_kit')).toBe(3);
    expect(cargoQuantity(items, 'food_water')).toBe(600);
  });

  it('computes food & water endurance from person-days', () => {
    const manifest = [
      { name: 'Dried rations', category: 'food_water' as const, quantity: 300 },
      { name: 'Water', category: 'food_water' as const, quantity: 100 },
      { name: 'Ammunition', category: 'ammunition' as const, quantity: 2 },
    ];
    expect(foodWaterPersonDays(manifest)).toBe(400);
    expect(supplyDays(manifest, 10)).toBe(40);
    expect(supplyDays(manifest, 0)).toBeNull();
  });

  it('converts legacy mass items and keeps names/categories separate', () => {
    expect(normalizeCargoManifest([
      { name: 'Food & water', category: 'food_water', mass: 1 },
      { name: 'Ship repair kit', category: 'ship_repair_kit', mass: 0.3 },
      { name: 'Ammunition', category: 'ammunition', mass: 2 },
      { name: 'Artifact', category: 'mission_cargo', mass: 1.5 },
      { name: 'Rations', category: 'food_water', mass: 0.5 },
      null,
    ])).toEqual([
      { name: 'Food & water', category: 'food_water', quantity: 200 },
      { name: 'Ship repair kit', category: 'ship_repair_kit', quantity: 3 },
      { name: 'Ammunition', category: 'ammunition', quantity: 2 },
      { name: 'Artifact', category: 'mission_cargo', quantity: 1.5 },
      { name: 'Rations', category: 'food_water', quantity: 100 },
    ]);
  });

  it('keeps existing quantity items', () => {
    expect(normalizeCargoManifest([
      { name: 'Dried rations', category: 'food_water', quantity: 200, mass: 9 },
    ])).toEqual([{ name: 'Dried rations', category: 'food_water', quantity: 200 }]);
  });
});
