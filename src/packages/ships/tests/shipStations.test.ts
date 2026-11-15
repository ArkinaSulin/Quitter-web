import { describe, expect, it } from 'vitest';
import { ShipComponent, ShipWeapon } from '@/types/ship';
import { ShipBuild, shipStationCards, shipStationStat } from '@/packages/ships';

const COMPONENTS: ShipComponent[] = [
  { id: 'comp-hull', name: 'Hull', mass: 0, crew: 0, cost: 0, hittable: false, effect: null, builtIn: true, canCombine: true, dt: 15 },
  { id: 'comp-deck', name: 'Deck', mass: 0, crew: 0, cost: 0, hittable: true, effect: null, builtIn: true, canCombine: true, dt: 15 },
  { id: 'comp-helm', name: 'Helm', mass: 1, crew: 1, cost: 0, hittable: true, effect: null, builtIn: true, canCombine: false, dt: 15 },
  { id: 'comp-bridge', name: 'Command bridge', mass: 3, crew: 5, cost: 0, hittable: true, effect: null, builtIn: true, canCombine: false, dt: 15 },
  { id: 'comp-sail', name: 'Sail', mass: 1, crew: 0, cost: 0, hittable: true, effect: null, builtIn: true, canCombine: true, dt: 15 },
  { id: 'comp-rudder', name: 'Rudder', mass: 1.5, crew: 0.5, cost: 0, hittable: true, effect: null, builtIn: true, canCombine: true, dt: 15 },
  { id: 'comp-quarters', name: 'Crew quarters', mass: 1, crew: 5, cost: 0, hittable: true, effect: null, builtIn: true, canCombine: true, dt: 15 },
];

const WEAPON: ShipWeapon = {
  id: 'wpn-ballista', name: 'Ballista', mass: 1, damage: '2d10', damageFormula: null,
  minRange: 0, range: 3, maxRange: 10, reloadSteps: 2, magicDimension: 0, shape: 'circle',
  savingThrow: 'Dex', saveDC: 10, onSaveHalfOrNeg: true, dt: 15, crew: 2, cost: 500,
  ammoCost: 1, special: null,
};

function build(overrides: Partial<ShipBuild> = {}): ShipBuild {
  return {
    armor: { id: 'wood', name: 'wood', massPct: 0, ac: 15, hpMult: 1 },
    components: COMPONENTS,
    weaponsCatalog: [WEAPON],
    totalMass: 20,
    helm: 1,
    commandBridge: 1,
    sails: 8,
    rudders: 4,
    reinforcement: 0,
    crewQuarters: 2,
    cargoArea: 1,
    templateComponents: [],
    templateWeapons: [{ id: 'Fore', weaponId: WEAPON.id, count: 2 }],
    ...overrides,
  };
}

describe('shipStationCards', () => {
  it('uses aggregate Sail/Rudder crew and per-weapon crew', () => {
    const cards = shipStationCards(build());
    const byKind = (kind: string) => cards.filter(c => c.kind === kind);
    expect(byKind('helm').map(c => c.crewRequired)).toEqual([1]);
    expect(byKind('bridge').map(c => c.crewRequired)).toEqual([5]);
    expect(byKind('sail').map(c => c.crewRequired)).toEqual([2]);
    expect(byKind('rudder').map(c => c.crewRequired)).toEqual([2]);
    expect(byKind('weapon').map(c => c.crewRequired)).toEqual([2, 2]);
    expect(byKind('weapon').map(c => c.key)).toEqual(['weapon:Fore:0', 'weapon:Fore:1']);
  });

  it('excludes hull, deck, quarters and cargo', () => {
    const names = shipStationCards(build()).map(c => c.name);
    expect(names).not.toContain('Hull');
    expect(names).not.toContain('Deck');
    expect(names).not.toContain('Crew quarters');
    expect(names).not.toContain('Cargo');
  });

  it('maps station kinds to their check stat', () => {
    expect(shipStationStat('helm')).toBe('wis');
    expect(shipStationStat('bridge')).toBe('int');
    expect(shipStationStat('rudder')).toBe('int');
    expect(shipStationStat('sail')).toBe('con');
    expect(shipStationStat('weapon')).toBe('dex');
  });
});
