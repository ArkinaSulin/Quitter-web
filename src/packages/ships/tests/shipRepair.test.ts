import { describe, expect, it } from 'vitest';
import { ShipArmor, ShipComponent, ShipTemplate, ShipWeapon } from '@/types/ship';
import {
  buildShipFromTemplate,
  computeMassBreakdown,
  computeShipPatchDamage,
  createDefaultDeckLayout,
  effectiveShipHp,
  minHpAfterDamage,
  repairHpCap,
  repairOneBox,
  shipDamagedCards,
  shipHasRepairableDamage,
  shipHullBoxes,
  shipHullCardKey,
  shipHullDestroyed,
} from '@/packages/ships';

const ARMORS: ShipArmor[] = [
  { id: 'wood', name: 'wood', massPct: 0, ac: 15, hpMult: 1 },
];

const COMPONENTS: ShipComponent[] = [
  { id: 'hull', name: 'Hull', mass: 0, crew: 0, cost: 0, hittable: true, effect: null, builtIn: true, canCombine: true, dt: 15 },
  { id: 'helm', name: 'Helm', mass: 1, crew: 1, cost: 0, hittable: true, effect: null, builtIn: true, canCombine: false, dt: 15 },
  { id: 'sail', name: 'Sail', mass: 1, crew: 0, cost: 0, hittable: true, effect: null, builtIn: true, canCombine: true, dt: 15 },
  { id: 'rudder', name: 'Rudder', mass: 1.5, crew: 0.5, cost: 0, hittable: true, effect: null, builtIn: true, canCombine: true, dt: 15 },
  { id: 'cargo', name: 'Cargo', mass: 1, crew: 0, cost: 0, hittable: true, effect: null, builtIn: true, canCombine: true, dt: 15 },
];

const WEAPONS: ShipWeapon[] = [
  { id: 'ballista', name: 'Ballista', mass: 1, damage: '1d10', minRange: 0, range: 5, maxRange: 10, reloadSteps: 1,
    maxTargets: 1, magicDimension: 0, shape: 'circle', savingThrow: 'Dex', saveDC: 10, onSaveHalfOrNeg: true, dt: 15, crew: 1, cost: 100, ammoCost: null, special: null, ac: 10 },
];

const TEMPLATE: ShipTemplate = {
  id: 't1',
  name: 'Test ship',
  role: 'Scout',
  armorId: 'wood',
  totalMass: 20,
  helm: 1,
  commandBridge: 0,
  sails: 2,
  rudders: 1,
  reinforcement: 1,
  weaponCapacity: 2,
  deckLayout: createDefaultDeckLayout(),
  reinforcements: [],
  weaponArcs: {},
  atmosphericSpeed: 4,
  damageThreshold: 15,
  imageUrl: '',
  keelLength: 100,
  imageOffsetY: 0,
  cargoArea: 1,
  optionalComponents: [],
  weapons: [],
  crews: [],
  manifest: [],
  createdAt: '',
  updatedAt: '',
};

function build() {
  const value = buildShipFromTemplate(TEMPLATE, ARMORS, COMPONENTS, WEAPONS);
  if (!value) throw new Error('build failed');
  return value;
}

function snapshot(value = build()) {
  return { template: TEMPLATE, build: value, stats: { shipHp: 100 } as any };
}

describe('shipRepair', () => {
  it('finds the hull card and its box count', () => {
    const b = build();
    const key = shipHullCardKey(b);
    expect(key).toBe(`component:${b.components.find(c => c.name === 'Hull')!.id}`);
    expect(shipHullBoxes(b)).toBe(Math.round(computeMassBreakdown(b).hull));
  });

  it('a destroyed hull forces ship HP to 0', () => {
    const b = build();
    const hullKey = shipHullCardKey(b)!;
    const boxState = { [hullKey]: shipHullBoxes(b) };
    expect(shipHullDestroyed(snapshot(b), boxState)).toBe(true);
    expect(effectiveShipHp(snapshot(b), boxState, 50)).toBe(0);
    expect(effectiveShipHp(snapshot(b), {}, 50)).toBe(50);
  });

  it('lists damaged cards and restores one box, reviving a destroyed card', () => {
    const b = build();
    const hullKey = shipHullCardKey(b)!;
    const boxState = { [hullKey]: 2 };
    expect(shipDamagedCards(b, boxState).map(c => c.key)).toContain(hullKey);
    expect(repairOneBox(boxState, hullKey)).toEqual({ [hullKey]: 1 });
    expect(repairOneBox({ [hullKey]: 1 }, hullKey)).toEqual({});
    expect(repairOneBox({}, hullKey)).toEqual({});
  });

  it('tracks the lowest HP reached and never raises it', () => {
    expect(minHpAfterDamage(undefined, 70)).toBe(70);
    expect(minHpAfterDamage(70, 40)).toBe(40);
    expect(minHpAfterDamage(40, 75)).toBe(40);
    expect(minHpAfterDamage(40, 0)).toBe(0);
  });

  it('separates patched HP from underlying damage at dry dock', () => {
    expect(computeShipPatchDamage({ currentHp: 80, minHp: 30, maxHp: 100 })).toMatchObject({
      currentHp: 80,
      minHp: 30,
      maxHp: 100,
      patchedHp: 50,
      damageHp: 70,
    });
    expect(computeShipPatchDamage({ currentHp: 80, minHp: null, maxHp: 100 })).toMatchObject({
      patchedHp: 0,
      damageHp: 20,
    });
    expect(computeShipPatchDamage({ currentHp: 120, minHp: -5, maxHp: 100 })).toMatchObject({
      currentHp: 100,
      minHp: 0,
      patchedHp: 100,
      damageHp: 100,
    });
  });

  it('repair is available below the 80% cap or when a box is damaged', () => {
    const b = build();
    const snap = snapshot(b);
    expect(repairHpCap(100)).toBe(80);
    expect(shipHasRepairableDamage(snap, {}, 79, 100)).toBe(true);
    expect(shipHasRepairableDamage(snap, {}, 80, 100)).toBe(false);
    const hullKey = shipHullCardKey(b)!;
    expect(shipHasRepairableDamage(snap, { [hullKey]: 1 }, 80, 100)).toBe(true);
    expect(shipHasRepairableDamage(snap, { [hullKey]: shipHullBoxes(b) }, 0, 100)).toBe(false);
  });
});
