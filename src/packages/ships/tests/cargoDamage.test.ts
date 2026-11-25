import { describe, expect, it } from 'vitest';
import type { CargoManifestItem } from '@/types/ship';
import {
  cargoDamageSummary,
  cargoCapacityAfterDamage,
  mergeCargoItems,
  packCargoBoxes,
  removeCargoBoxes,
  rollDestroyedCargoBoxes,
} from '@/packages/ships';

const ore = (quantity: number): CargoManifestItem => ({ name: 'Ore', category: 'general_cargo', quantity });
const furniture = (quantity: number): CargoManifestItem => ({ name: 'Furniture', category: 'general_cargo', quantity });
const kits = (quantity: number): CargoManifestItem => ({ name: 'Ship repair kit', category: 'ship_repair_kit', quantity });
const food = (quantity: number): CargoManifestItem => ({ name: 'Food & water', category: 'food_water', quantity });

describe('packCargoBoxes', () => {
  it('fills full one-ton boxes first and packs the remainder last', () => {
    const boxes = packCargoBoxes([ore(2.5)], 4);
    expect(boxes).toHaveLength(4);
    expect(boxes[0].tons).toBe(1);
    expect(boxes[1].tons).toBe(1);
    expect(boxes[2].tons).toBe(0.5);
    expect(boxes[3].tons).toBe(0);
  });

  it('uses the category unit for kits and food/water', () => {
    const kitBoxes = packCargoBoxes([kits(14)], 2);
    expect(kitBoxes[0].entries[0].quantity).toBe(10);
    expect(kitBoxes[1].entries[0].quantity).toBe(4);

    const foodBoxes = packCargoBoxes([food(450)], 3);
    expect(foodBoxes[0].entries[0].quantity).toBe(200);
    expect(foodBoxes[1].entries[0].quantity).toBe(200);
    expect(foodBoxes[2].entries[0].quantity).toBe(50);
  });

  it('does not mix leftover groups while the hold has room', () => {
    const boxes = packCargoBoxes([ore(0.4), furniture(0.4)], 3);
    expect(boxes[0].entries.map(e => e.name)).toEqual(['Ore']);
    expect(boxes[1].entries.map(e => e.name)).toEqual(['Furniture']);
    expect(boxes[2].entries).toEqual([]);
  });

  it('mixes leftovers only when the hold is full', () => {
    const boxes = packCargoBoxes([ore(0.4), furniture(0.4)], 1);
    expect(boxes).toHaveLength(1);
    expect(boxes[0].entries.map(e => e.name)).toEqual(['Ore', 'Furniture']);
    expect(boxes[0].tons).toBeCloseTo(0.8, 6);
  });

  it('never creates more boxes than capacity, even when overloaded', () => {
    const boxes = packCargoBoxes([ore(12)], 5);
    expect(boxes).toHaveLength(5);
    expect(boxes.reduce((sum, box) => sum + box.tons, 0)).toBe(12);
  });
});

describe('rollDestroyedCargoBoxes', () => {
  it('shrinks the pool so a box is never hit twice', () => {
    const boxes = packCargoBoxes([ore(3)], 3);
    const destroyed = rollDestroyedCargoBoxes(boxes, 3, () => 0);
    expect(destroyed.map(box => box.index)).toEqual([0, 1, 2]);
  });

  it('stops when the hold has no boxes left', () => {
    const boxes = packCargoBoxes([ore(2)], 2);
    expect(rollDestroyedCargoBoxes(boxes, 5, () => 0)).toHaveLength(2);
  });
});

describe('removeCargoBoxes', () => {
  it('subtracts the destroyed boxes from the source manifest lines', () => {
    const items = [ore(2), furniture(1)];
    const boxes = packCargoBoxes(items, 4);
    const result = removeCargoBoxes(items, [boxes[0], boxes[2]]);
    expect(result.items).toEqual([ore(1)]);
    expect(result.destroyedItems).toEqual([ore(1), furniture(1)]);
    expect(cargoDamageSummary(result.destroyedItems)).toBe('1t Ore, 1t Furniture');
  });

  it('keeps a duplicate line separate through the line index', () => {
    const items = [ore(1), ore(1)];
    const boxes = packCargoBoxes(items, 2);
    const result = removeCargoBoxes(items, [boxes[1]]);
    expect(result.items).toEqual([ore(1)]);
  });

  it('formats kits and person-days with their own units', () => {
    expect(cargoDamageSummary([kits(4), food(50)]))
      .toBe('4 kits Ship repair kit, 50 person-days Food & water');
  });

  it('merges same-name/same-category cargo for one debris barrel', () => {
    expect(mergeCargoItems([ore(1), ore(2.5), furniture(1)])).toEqual([
      ore(3.5),
      furniture(1),
    ]);
  });
});

describe('cargoCapacityAfterDamage', () => {
  it('subtracts destroyed Cargo-card boxes from the design hold', () => {
    const build = {
      armor: { id: 'wood', name: 'wood', massPct: 0, ac: 15, hpMult: 1 },
      components: [
        { id: 'cargo', name: 'Cargo', mass: 1, crew: 0, cost: 0, hittable: true, effect: null, builtIn: true, canCombine: true, dt: 15 },
      ],
      weaponsCatalog: [],
      totalMass: 20,
      helm: 0,
      commandBridge: 0,
      sails: 0,
      rudders: 0,
      reinforcement: 0,
      cargoArea: 4,
      templateComponents: [],
      templateWeapons: [],
      deckLayout: {
        version: 2,
        bow: [],
        stern: [],
        port: [],
        body: [[{ cardKey: 'component:cargo' }]],
        starboard: [],
      },
    } as any;
    const full = cargoCapacityAfterDamage(build, {});
    expect(full.destroyedCargoBoxes).toBe(0);
    expect(full.effectiveCapacity).toBe(full.designCapacity);
    const damaged = cargoCapacityAfterDamage(build, { 'component:cargo': 2 });
    expect(damaged.destroyedCargoBoxes).toBe(2);
    expect(damaged.effectiveCapacity).toBe(full.designCapacity - 2);
  });
});
