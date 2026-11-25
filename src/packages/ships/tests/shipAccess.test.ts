import { describe, expect, it } from 'vitest';
import type { Unit } from '@/types/gameProtocol';
import type { ShipBuild } from '@/packages/ships/lib/shipStats';
import type { ShipRuntime } from '@/packages/ships/lib/shipRuntime';
import { shipCardFunctionHeroes, shipCardLeaderTeam, shipCommandHero, shipHasPilot, shipHelmOwner, shipViewerAccess } from '@/packages/ships/lib/shipAccess';

const COMPONENTS = [
  { id: 'helm', name: 'Helm', mass: 1, crew: 1, cost: 0, hittable: true, effect: null, builtIn: true, canCombine: false, dt: 15 },
  { id: 'bridge', name: 'Command bridge', mass: 3, crew: 5, cost: 0, hittable: true, effect: null, builtIn: true, canCombine: false, dt: 15 },
  { id: 'sail', name: 'Sail', mass: 1, crew: 0, cost: 0, hittable: true, effect: null, builtIn: true, canCombine: true, dt: 15 },
  { id: 'rudder', name: 'Rudder', mass: 1.5, crew: 0.5, cost: 0, hittable: true, effect: null, builtIn: true, canCombine: true, dt: 15 },
] as ShipBuild['components'];

const WEAPON = {
  id: 'w1', name: 'Ballista', mass: 1, damage: '2d10',
  minRange: 0, range: 3, maxRange: 10, reloadSteps: 2,
    maxTargets: 1, magicDimension: 0,
  shape: 'circle', savingThrow: 'Dex', saveDC: 10, onSaveHalfOrNeg: true,
  dt: 15, crew: 2, cost: 500, ammoCost: 1, special: null,
} as any;

function build(): ShipBuild {
  return {
    components: COMPONENTS,
    weaponsCatalog: [WEAPON],
    armor: { id: 'wood', name: 'wood', massPct: 0, ac: 15, hpMult: 1 },
    totalMass: 20,
    helm: 1,
    commandBridge: 1,
    sails: 1,
    rudders: 1,
    reinforcement: 0,
    cargoArea: 0,
    templateComponents: [],
    templateWeapons: [{ id: 'row', weaponId: 'w1', count: 1 }],
    deckLayout: {
      version: 2,
      bow: [],
      stern: [],
      port: [{ cardKey: 'component:helm' }],
      body: [[{ cardKey: 'component:bridge' }]],
      starboard: [],
    },
  } as unknown as ShipBuild;
}

function ship(
  stations: ShipRuntime['stations'],
  boxState: Record<string, unknown> = {},
): ShipRuntime {
  return {
    id: 's1',
    snapshot: { build: build() } as ShipRuntime['snapshot'],
    stations,
    crewState: {},
    boxState,
  } as ShipRuntime;
}

function hero(id: string, station: string, team = 'red'): Unit {
  return {
    id,
    unitName: id,
    isHero: true,
    isDeleted: false,
    attachedToShipId: 's1',
    shipStationKey: station,
    team,
  } as Unit;
}

const HELM = 'component:helm';
const BRIDGE = 'component:bridge';
const WEAPON_CARD = 'weapon:row:0';

describe('shipViewerAccess', () => {
  it('gives the DM every card and full management', () => {
    const access = shipViewerAccess(ship({}), [], 'red', true);
    expect(access.revealAllCards).toBe(true);
    expect(access.manageAllCards).toBe(true);
  });

  it('gives a player with no hero aboard no cards', () => {
    const access = shipViewerAccess(ship({}), [], 'red', false);
    expect(access.revealAllCards).toBe(false);
    expect(access.manageAllCards).toBe(false);
    expect(access.visibleCardKeys).toEqual([]);
    expect(access.manageableCardKeys).toEqual([]);
  });

  it('treats a hero on a full bridge as captain (sees and manages all)', () => {
    const access = shipViewerAccess(
      ship({ [BRIDGE]: { heroId: 'h1', crewIds: ['c1', 'c2', 'c3', 'c4'] } }),
      [hero('h1', BRIDGE)],
      'red',
      false,
    );
    expect(access.bridgeFull).toBe(true);
    expect(access.captainExists).toBe(true);
    expect(access.revealAllCards).toBe(true);
    expect(access.manageAllCards).toBe(true);
  });

  it('does not make a bridge hero captain when the bridge is not full', () => {
    const access = shipViewerAccess(
      ship({ [BRIDGE]: { heroId: 'h1', crewIds: ['c1', 'c2', 'c3'] } }),
      [hero('h1', BRIDGE)],
      'red',
      false,
    );
    expect(access.bridgeFull).toBe(false);
    expect(access.revealAllCards).toBe(false);
    expect(access.manageAllCards).toBe(false);
    expect(access.visibleCardKeys).toEqual([BRIDGE]);
    expect(access.manageableCardKeys).toEqual([BRIDGE]);
  });

  it('lets a helmsman see and manage every card when no captain exists', () => {
    const access = shipViewerAccess(ship({ [HELM]: { heroId: 'h1' } }), [hero('h1', HELM)], 'red', false);
    expect(access.revealAllCards).toBe(true);
    expect(access.manageAllCards).toBe(true);
  });

  it('keeps a helmsman seeing all but managing only the helm when a captain exists', () => {
    const access = shipViewerAccess(
      ship({
        [HELM]: { heroId: 'helm-hero' },
        [BRIDGE]: { heroId: 'captain', crewIds: ['c1', 'c2', 'c3', 'c4'] },
      }),
      [hero('helm-hero', HELM), hero('captain', BRIDGE, 'blue')],
      'red',
      false,
    );
    expect(access.captainExists).toBe(true);
    expect(access.revealAllCards).toBe(true);
    expect(access.manageAllCards).toBe(false);
    expect(access.manageableCardKeys).toEqual([HELM]);
  });

  it('does not give a destroyed Bridge captain access', () => {
    const access = shipViewerAccess(
      ship(
        { [BRIDGE]: { heroId: 'h1', crewIds: ['c1', 'c2', 'c3', 'c4'] } },
        { [BRIDGE]: 3 },
      ),
      [hero('h1', BRIDGE)],
      'red',
      false,
    );
    expect(access.bridgeFull).toBe(false);
    expect(access.captainExists).toBe(false);
    expect(access.revealAllCards).toBe(false);
    expect(access.manageAllCards).toBe(false);
    expect(access.visibleCardKeys).toEqual([BRIDGE]);
  });

  it('does not let a destroyed Helm reveal or manage every card', () => {
    const access = shipViewerAccess(
      ship({ [HELM]: { heroId: 'h1' } }, { [HELM]: 1 }),
      [hero('h1', HELM)],
      'red',
      false,
    );
    expect(access.revealAllCards).toBe(false);
    expect(access.manageAllCards).toBe(false);
    expect(access.visibleCardKeys).toEqual([HELM]);
    expect(access.manageableCardKeys).toEqual([HELM]);
  });

  it('limits a weapon-station hero to that card', () => {
    const access = shipViewerAccess(
      ship({ [WEAPON_CARD]: { heroId: 'h1' } }),
      [hero('h1', WEAPON_CARD)],
      'red',
      false,
    );
    expect(access.revealAllCards).toBe(false);
    expect(access.manageAllCards).toBe(false);
    expect(access.visibleCardKeys).toEqual([WEAPON_CARD]);
    expect(access.manageableCardKeys).toEqual([WEAPON_CARD]);
  });

  it('uses the viewer team to identify their hero', () => {
    const access = shipViewerAccess(
      ship({ [HELM]: { heroId: 'h1' } }),
      [hero('h1', HELM, 'blue')],
      'red',
      false,
    );
    expect(access.revealAllCards).toBe(false);
    expect(access.visibleCardKeys).toEqual([]);
  });
});

describe('shipCommandHero', () => {
  it('returns the captain when the bridge is full', () => {
    const units = [hero('captain', BRIDGE), hero('helm', HELM)];
    const value = shipCommandHero(
      ship({ [BRIDGE]: { heroId: 'captain', crewIds: ['c1', 'c2', 'c3', 'c4'] } }),
      units,
    );
    expect(value?.id).toBe('captain');
  });

  it('falls back to the helmsman when there is no captain', () => {
    const units = [hero('captain', BRIDGE), hero('helm', HELM)];
    const value = shipCommandHero(
      ship({ [BRIDGE]: { heroId: 'captain', crewIds: ['c1'] } }),
      units,
    );
    expect(value?.id).toBe('helm');
  });

  it('returns null when no hero commands the ship', () => {
    expect(shipCommandHero(ship({ [HELM]: { crewIds: ['c1'] } }), [])).toBeNull();
  });

  it('does not fall back to a hero on a destroyed Helm', () => {
    const units = [hero('helm', HELM)];
    expect(shipCommandHero(
      ship({ [HELM]: { heroId: 'helm' } }, { [HELM]: 1 }),
      units,
    )).toBeNull();
  });
});

describe('shipCardFunctionHeroes', () => {
  it('returns every living hero on the card', () => {
    const units = [hero('a', HELM), hero('b', HELM), hero('c', BRIDGE)];
    expect(shipCardFunctionHeroes(ship({ [HELM]: { heroIds: ['a', 'b'] } }), units, HELM).map(u => u.id))
      .toEqual(['a', 'b']);
  });

  it('falls back to the captain when no hero is on the card', () => {
    const units = [hero('captain', BRIDGE)];
    const value = shipCardFunctionHeroes(
      ship({ [BRIDGE]: { heroId: 'captain', crewIds: ['c1', 'c2', 'c3', 'c4'] } }),
      units,
      HELM,
    );
    expect(value.map(u => u.id)).toEqual(['captain']);
  });

  it('returns nobody when the card and command are unheroed', () => {
    expect(shipCardFunctionHeroes(ship({ [HELM]: { crewIds: ['c1'] } }), [], HELM)).toEqual([]);
  });
});

describe('shipHelmOwner', () => {
  it('uses the helm hero team', () => {
    const owner = shipHelmOwner(ship({ [HELM]: { heroId: 'h1' } }), [hero('h1', HELM, 'blue')]);
    expect(owner.hero?.id).toBe('h1');
    expect(owner.team).toBe('blue');
  });

  it('falls back to the crew team when the helm is unheroed', () => {
    const runtime = ship({ [HELM]: { crewIds: ['c1'] } });
    runtime.crewTeam = 'green';
    expect(shipHelmOwner(runtime, []).team).toBe('green');
  });

  it('returns no owner for an empty helm', () => {
    const owner = shipHelmOwner(ship({ [HELM]: { crewIds: [] } }), []);
    expect(owner.team).toBeNull();
    expect(owner.hero).toBeNull();
  });
});

describe('shipCardLeaderTeam', () => {
  it('uses the hero on the card', () => {
    const runtime = ship({ [WEAPON_CARD]: { heroId: 'h1' } });
    runtime.crewTeam = 'green';
    expect(shipCardLeaderTeam(runtime, [hero('h1', WEAPON_CARD, 'blue')], WEAPON_CARD)).toBe('blue');
  });

  it('uses the highest-level hero when several occupy the card', () => {
    const runtime = ship({ [WEAPON_CARD]: { heroIds: ['low', 'high'] } });
    const units = [
      { ...hero('low', WEAPON_CARD, 'blue'), level: 1 },
      { ...hero('high', WEAPON_CARD, 'red'), level: 5 },
    ] as Unit[];
    expect(shipCardLeaderTeam(runtime, units, WEAPON_CARD)).toBe('red');
  });

  it('falls back to the NPC crew team when no hero is on the card', () => {
    const runtime = ship({ [WEAPON_CARD]: { crewIds: ['c1'] } });
    runtime.crewTeam = 'green';
    expect(shipCardLeaderTeam(runtime, [], WEAPON_CARD)).toBe('green');
  });

  it('returns null when the card has neither a hero nor a crew team', () => {
    const runtime = ship({ [WEAPON_CARD]: { crewIds: ['c1'] } });
    runtime.crewTeam = null;
    expect(shipCardLeaderTeam(runtime, [], WEAPON_CARD)).toBeNull();
  });
});

describe('shipHasPilot', () => {
  it('is true with a hero or living crew on the helm', () => {
    expect(shipHasPilot(ship({ [HELM]: { heroId: 'h1' } }), [hero('h1', HELM)])).toBe(true);
    expect(shipHasPilot(ship({ [HELM]: { crewIds: ['c1'] } }), [])).toBe(true);
  });

  it('is false with an empty helm', () => {
    expect(shipHasPilot(ship({ [HELM]: { crewIds: [] } }), [])).toBe(false);
  });
});
