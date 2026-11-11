import { describe, expect, it } from 'vitest';
import { ShipArmor, ShipComponent, ShipTemplate, ShipWeapon } from '@/types/ship';
import { buildShipFromTemplate, createDefaultDeckLayout } from '@/packages/ships';

const ARMORS: ShipArmor[] = [
  { id: 'wood', name: 'wood', massPct: 0, ac: 15, hpMult: 1 },
];

const COMPONENTS: ShipComponent[] = [
  { id: 'hull', name: 'Hull', mass: 0, crew: 0, cost: 0, hittable: false, effect: null, builtIn: true, canCombine: true, dt: 15 },
  { id: 'helm', name: 'Helm', mass: 1, crew: 1, cost: 0, hittable: true, effect: null, builtIn: true, canCombine: false, dt: 15 },
  { id: 'sail', name: 'Sail', mass: 1, crew: 0, cost: 0, hittable: true, effect: null, builtIn: true, canCombine: true, dt: 15 },
  { id: 'rudder', name: 'Rudder', mass: 1.5, crew: 0.5, cost: 0, hittable: true, effect: null, builtIn: true, canCombine: true, dt: 15 },
  { id: 'cargo', name: 'Cargo', mass: 1, crew: 0, cost: 0, hittable: true, effect: null, builtIn: true, canCombine: true, dt: 15 },
  { id: 'quarters', name: 'Crew quarters', mass: 1, crew: 0, cost: 0, hittable: true, effect: null, builtIn: true, canCombine: true, dt: 15 },
];

const WEAPONS: ShipWeapon[] = [
  { id: 'ballista', name: 'Ballista', mass: 1, damage: '1d10', damageFormula: null, minRange: 0, range: 5, maxRange: 10, reloadSteps: 1, magicDimension: 0, shape: 'circle', savingThrow: 'Dex', saveDC: 10, onSaveHalfOrNeg: true, dt: 15, crew: 1, cost: 100, ammoCost: null, special: null, ac: 10 },
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
  crewQuarters: 1,
  weaponCapacity: 2,
  deckLayout: createDefaultDeckLayout(),
  reinforcements: ['weapon:w1:0', 'component:stale'],
  weaponArcs: {},
  atmosphericSpeed: 4,
  damageThreshold: 15,
  imageUrl: 'ship.png',
  keelLength: 100,
  imageOffsetY: 0,
  cargoArea: 1,
  optionalComponents: [{ componentId: 'cargo', count: 1 }],
  weapons: [{ id: 'w1', weaponId: 'ballista', count: 1 }],
  crews: [],
  createdAt: '',
  updatedAt: '',
};

describe('buildShipFromTemplate', () => {
  it('builds catalogs, deck cards, and filters stale reinforcements', () => {
    const build = buildShipFromTemplate(TEMPLATE, ARMORS, COMPONENTS, WEAPONS);
    expect(build).not.toBeNull();
    expect(build!.armor.id).toBe('wood');
    expect(build!.templateComponents).toEqual(TEMPLATE.optionalComponents);
    expect(build!.templateWeapons).toEqual(TEMPLATE.weapons);
    expect(build!.reinforcements).toEqual(['weapon:w1:0']);
    expect(build!.deckLayout!.bow.some(slot => slot.cardKey?.startsWith('weapon:'))).toBe(true);
    expect(build!.deckLayout!.body.some(slot => slot.cardKey?.startsWith('component:'))).toBe(true);
  });

  it('returns null when no armor is available', () => {
    expect(buildShipFromTemplate(TEMPLATE, [], COMPONENTS, WEAPONS)).toBeNull();
  });
});
