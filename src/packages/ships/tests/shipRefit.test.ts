import { describe, expect, it } from 'vitest';
import {
  ShipArmor,
  ShipCargoItem,
  ShipComponent,
  ShipTemplate,
  ShipWeapon,
} from '@/types/ship';
import {
  computeShipRefitInvoice,
  createDefaultDeckLayout,
} from '@/packages/ships';

const ARMORS: ShipArmor[] = [
  { id: 'wood', name: 'Wood', massPct: 0, ac: 15, hpMult: 1, costPerTon: 0 },
  { id: 'ceramic', name: 'Ceramic', massPct: 0.05, ac: 13, hpMult: 2, costPerTon: 200 },
];

const COMPONENTS: ShipComponent[] = [
  { id: 'hull', name: 'Hull', mass: 0, crew: 0, cost: 0, hittable: true, effect: null, builtIn: true, canCombine: true, dt: 15 },
  { id: 'helm', name: 'Helm', mass: 1, crew: 1, cost: 1000, hittable: true, effect: null, builtIn: true, canCombine: false, dt: 15 },
  { id: 'bridge', name: 'Command bridge', mass: 3, crew: 5, cost: 1500, hittable: true, effect: null, builtIn: true, canCombine: false, dt: 15 },
  { id: 'sail', name: 'Sail', mass: 1, crew: 0, cost: 100, hittable: true, effect: null, builtIn: true, canCombine: true, dt: 15 },
  { id: 'rudder', name: 'Rudder', mass: 1.5, crew: 0.5, cost: 1000, hittable: true, effect: null, builtIn: true, canCombine: true, dt: 15 },
  { id: 'reinforcement', name: 'Reinforcement', mass: 1, crew: 0, cost: 200, hittable: true, effect: null, builtIn: true, canCombine: true, dt: 15 },
  { id: 'cargo', name: 'Cargo', mass: 1, crew: 0, cost: 50, hittable: true, effect: null, builtIn: true, canCombine: true, dt: 15 },
  { id: 'capacity', name: 'Weapon capacity', mass: 1, crew: 0, cost: 100, hittable: true, effect: 'Weapon capacity', builtIn: true, canCombine: true, dt: 15 },
  { id: 'armory', name: 'Armory', mass: 2, crew: 1, cost: 700, hittable: true, effect: '', builtIn: false, canCombine: true, dt: 15 },
];

const WEAPONS: ShipWeapon[] = [
  { id: 'ballista', name: 'Ballista light', mass: 1, damage: '1d10', damageFormula: null, minRange: 0, range: 5, maxRange: 10, reloadSteps: 1,
    maxTargets: 1, magicDimension: 0, shape: 'circle', savingThrow: 'Dex', saveDC: 10, onSaveHalfOrNeg: true, dt: 15, crew: 1, cost: 100, ammoCost: null, special: null, ac: 10 },
  { id: 'catapult', name: 'Catapult', mass: 1, damage: '2d6', damageFormula: null, minRange: 0, range: 4, maxRange: 8, reloadSteps: 2,
    maxTargets: 1, magicDimension: 0, shape: 'circle', savingThrow: 'Dex', saveDC: 10, onSaveHalfOrNeg: true, dt: 15, crew: 1, cost: 200, ammoCost: null, special: null, ac: 10 },
];

const CARGO: ShipCargoItem[] = [
  { id: 'ore', name: 'Ore', category: 'general_cargo', unit: 'ton', unitMass: 1, unitCost: 20, notes: null },
];

const REPAIR_NONE = { currentHp: 0, minHp: 0, maxHp: 0 };

function template(overrides: Partial<ShipTemplate> = {}): ShipTemplate {
  return {
    id: 't1',
    name: 'Test ship',
    role: 'Scout',
    armorId: 'wood',
    totalMass: 100,
    helm: 1,
    commandBridge: 0,
    sails: 0,
    rudders: 0,
    reinforcement: 0,
    weaponCapacity: 0,
    deckLayout: createDefaultDeckLayout(),
    reinforcements: [],
    weaponArcs: {},
    atmosphericSpeed: 4,
    damageThreshold: 15,
    imageUrl: '',
    keelLength: 100,
    imageOffsetY: 0,
    cargoArea: 0,
    optionalComponents: [],
    weapons: [],
    crews: [],
    manifest: [],
    createdAt: '',
    updatedAt: '',
    ...overrides,
  };
}

function invoice(before: Partial<ShipTemplate>, after: Partial<ShipTemplate>, repair = REPAIR_NONE, cargoCatalog = CARGO) {
  return computeShipRefitInvoice({
    before: template(before),
    after: template(after),
    armors: ARMORS,
    components: COMPONENTS,
    weapons: WEAPONS,
    cargoCatalog,
    repair,
  });
}

describe('shipRefit invoice', () => {
  it('prices 3 sails removed and 2 rudders added at 2,600 gp', () => {
    const result = invoice({ sails: 3, rudders: 0 }, { sails: 0, rudders: 2 });
    expect(result.removedTons).toBe(3);
    expect(result.addedTons).toBe(3);
    expect(result.lines.find(l => l.kind === 'labour_removal')?.subtotal).toBe(300);
    expect(result.lines.find(l => l.kind === 'labour_addition')?.subtotal).toBe(300);
    expect(result.lines.find(l => l.kind === 'equipment_component' && l.label.startsWith('Rudder'))?.subtotal).toBe(2000);
    expect(result.total).toBe(2600);
  });

  it('prices an added ballista at 200 gp even when capacity is spare', () => {
    const result = invoice(
      { weaponCapacity: 4, weapons: [] },
      { weaponCapacity: 4, weapons: [{ id: 'w1', weaponId: 'ballista', count: 1 }] },
    );
    expect(result.addedTons).toBe(1);
    expect(result.lines.find(l => l.kind === 'labour_addition')?.subtotal).toBe(100);
    expect(result.lines.find(l => l.kind === 'equipment_weapon')?.subtotal).toBe(100);
    expect(result.total).toBe(200);
  });

  it('pays both sides for a same-mass weapon swap', () => {
    const result = invoice(
      { weaponCapacity: 4, weapons: [{ id: 'w1', weaponId: 'ballista', count: 1 }] },
      { weaponCapacity: 4, weapons: [{ id: 'w1', weaponId: 'catapult', count: 1 }] },
    );
    expect(result.removedTons).toBe(1);
    expect(result.addedTons).toBe(1);
    expect(result.lines.find(l => l.kind === 'labour_removal')?.subtotal).toBe(100);
    expect(result.lines.find(l => l.kind === 'labour_addition')?.subtotal).toBe(100);
    expect(result.lines.find(l => l.kind === 'equipment_weapon')?.subtotal).toBe(200);
    expect(result.total).toBe(400);
  });

  it('prices an armor swap from wood to 5% ceramic', () => {
    const result = invoice({ armorId: 'wood' }, { armorId: 'ceramic' });
    expect(result.removedTons).toBe(0);
    expect(result.addedTons).toBe(5);
    expect(result.lines.find(l => l.kind === 'labour_addition')?.subtotal).toBe(500);
    expect(result.lines.find(l => l.kind === 'equipment_armor')?.subtotal).toBe(1000);
    expect(result.total).toBe(1500);
  });

  it('charges patch removal and repair from the worst HP', () => {
    const result = invoice(
      {},
      {},
      { currentHp: 80, minHp: 30, maxHp: 100 },
    );
    expect(result.patchedHp).toBe(50);
    expect(result.damageHp).toBe(70);
    expect(result.lines.find(l => l.kind === 'labour_remove_patch')?.subtotal).toBe(2500);
    expect(result.lines.find(l => l.kind === 'repair')?.subtotal).toBe(7000);
    expect(result.total).toBe(9500);
  });

  it('charges added crew one week of their weekly cost', () => {
    const result = invoice(
      { crews: [] },
      { crews: [{ id: 'c1', name: 'Rook', level: 5, hp: 40, str: 12, dex: 14, con: 14, int: 10, wis: 12, cha: 8, cost: 50 }] },
    );
    expect(result.lines.find(l => l.kind === 'crew')).toMatchObject({ rate: 50, quantity: 1, subtotal: 50 });
  });

  it('prices added cargo from ship_cargo and warns when unpriced', () => {
    const priced = invoice(
      {},
      { manifest: [{ name: 'Ore', category: 'general_cargo', quantity: 10 }] },
    );
    expect(priced.lines.find(l => l.kind === 'cargo')?.subtotal).toBe(200);

    const unpriced = invoice(
      {},
      { manifest: [{ name: 'Mystery', category: 'general_cargo', quantity: 2 }] },
    );
    expect(unpriced.lines.find(l => l.kind === 'cargo')?.subtotal).toBe(0);
    expect(unpriced.warnings.some(w => w.includes('No ship_cargo price'))).toBe(true);
  });

  it('never refunds a removed part', () => {
    const result = invoice({ sails: 2 }, { sails: 0 });
    expect(result.lines.map(l => l.kind)).toEqual(['labour_removal']);
    expect(result.total).toBe(200);
  });

  it('prices an added optional component by its cost per ton', () => {
    const result = invoice(
      { optionalComponents: [] },
      { optionalComponents: [{ componentId: 'armory', count: 1 }] },
    );
    expect(result.addedTons).toBe(2);
    expect(result.lines.find(l => l.kind === 'labour_addition')?.subtotal).toBe(200);
    expect(result.lines.find(l => l.kind === 'equipment_component' && l.label.includes('Armory'))?.subtotal).toBe(700);
    expect(result.total).toBe(900);
  });

  it('warns when total mass changes', () => {
    const result = invoice({ totalMass: 100 }, { totalMass: 120 });
    expect(result.warnings).toContain('Total ship mass changed; dry-dock refits must keep the declared mass.');
  });
});
