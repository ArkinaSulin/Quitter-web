import { describe, expect, it } from 'vitest';
import { ShipComponent, ShipWeapon } from '@/types/ship';
import { ShipBuild, needsStationReplacement, shipStationCards, shipStationStat, shipStationStats } from '@/packages/ships';

const COMPONENTS: ShipComponent[] = [
  { id: 'comp-hull', name: 'Hull', mass: 0, crew: 0, cost: 0, hittable: false, builtIn: true, canCombine: true, dt: 15 },
  { id: 'comp-deck', name: 'Deck', mass: 0, crew: 0, cost: 0, hittable: true, builtIn: true, canCombine: true, dt: 15 },
  { id: 'comp-helm', name: 'Helm', mass: 1, crew: 1, cost: 0, hittable: true, builtIn: true, canCombine: false, dt: 15 },
  { id: 'comp-bridge', name: 'Command bridge', mass: 3, crew: 5, cost: 0, hittable: true, builtIn: true, canCombine: false, dt: 15 },
  { id: 'comp-sail', name: 'Sail', mass: 1, crew: 0, cost: 0, hittable: true, builtIn: true, canCombine: true, dt: 15 },
  { id: 'comp-rudder', name: 'Rudder', mass: 1.5, crew: 0.5, cost: 0, hittable: true, builtIn: true, canCombine: true, dt: 15 },
  { id: 'comp-quarters', name: 'Crew quarters', mass: 1, crew: 5, cost: 0, hittable: true, builtIn: true, canCombine: true, dt: 15 },
];

const WEAPON: ShipWeapon = {
  id: 'wpn-ballista', name: 'Ballista', mass: 1, damage: '2d10',
  minRange: 0, range: 3, maxRange: 10, reloadSteps: 2,
    maxTargets: 1, magicDimension: 0, shape: 'circle',
  savingThrow: 'Dex', saveDC: 10, onSaveHalfOrNeg: true, dt: 15, crew: 2, cost: 500,
  ammoCost: 1,
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

  it('shrinks Sail/Rudder crew requirements with box damage', () => {
    const build8 = build({
      sails: 8,
      rudders: 4,
      deckLayout: {
        version: 2,
        bow: [],
        stern: [],
        port: [{ cardKey: 'component:comp-sail' }],
        body: [[{ cardKey: 'component:comp-rudder' }]],
        starboard: [],
      },
    });
    const damaged = shipStationCards(build8, { boxState: { 'component:comp-sail': 4 } });
    expect(damaged.filter(c => c.kind === 'sail').map(c => c.crewRequired)).toEqual([1]);
    expect(damaged.filter(c => c.kind === 'rudder').map(c => c.crewRequired)).toEqual([2]);
  });

  it('sets crew requirement to 0 on a destroyed Helm/Bridge card', () => {
    const withStations = build({
      armor: { id: 'wood', name: 'wood', massPct: 0, ac: 15, hpMult: 1 },
      deckLayout: {
        version: 2,
        bow: [],
        stern: [],
        port: [{ cardKey: 'component:comp-helm' }],
        body: [[{ cardKey: 'component:comp-bridge' }]],
        starboard: [],
      },
    } as any);
    const cards = shipStationCards(withStations, {
      boxState: { 'component:comp-helm': 1, 'component:comp-bridge': 3 },
    });
    expect(cards.filter(c => c.kind === 'helm').map(c => c.crewRequired)).toEqual([0]);
    expect(cards.filter(c => c.kind === 'bridge').map(c => c.crewRequired)).toEqual([0]);
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

  it('gives the Helmsman the higher of Wisdom or Intelligence', () => {
    expect(shipStationStats('helm')).toEqual(['wis', 'int']);
    expect(shipStationStats('rudder')).toEqual(['int']);
    expect(shipStationStats('weapon')).toEqual(['dex']);
  });
});

describe('needsStationReplacement', () => {
  it('pulls only for exactly one free slot', () => {
    expect(needsStationReplacement(1, 0)).toBe(true);
    expect(needsStationReplacement(1, 1)).toBe(false);
    expect(needsStationReplacement(3, 2)).toBe(true);
    expect(needsStationReplacement(3, 1)).toBe(false);
    expect(needsStationReplacement(3, 0)).toBe(false);
    expect(needsStationReplacement(3, 3)).toBe(false);
  });

  it('never pulls for unlimited or zero-capacity cards', () => {
    expect(needsStationReplacement(Number.POSITIVE_INFINITY, 0)).toBe(false);
    expect(needsStationReplacement(0, 0)).toBe(false);
    expect(needsStationReplacement(-1, 0)).toBe(false);
  });

  it('treats negative occupant counts as empty', () => {
    expect(needsStationReplacement(1, -3)).toBe(true);
  });
});
