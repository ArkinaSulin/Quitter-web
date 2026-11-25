import { describe, expect, it } from 'vitest';
import type { ShipBuild, ShipRuntime } from '@/packages/ships';
import { effectiveShipStats, shipSailRudderManning } from '@/packages/ships';
import type { ShipComponent } from '@/types/ship';
import type { Unit } from '@/types/gameProtocol';

const COMPONENTS: ShipComponent[] = [
  { id: 'comp-hull', name: 'Hull', mass: 0, crew: 0, cost: 0, hittable: false, effect: null, builtIn: true, canCombine: true, dt: 15 },
  { id: 'comp-sail', name: 'Sail', mass: 1, crew: 0, cost: 0, hittable: true, effect: null, builtIn: true, canCombine: true, dt: 15 },
  { id: 'comp-rudder', name: 'Rudder', mass: 1.5, crew: 0.5, cost: 0, hittable: true, effect: null, builtIn: true, canCombine: true, dt: 15 },
];

function build(sails: number, rudders: number): ShipBuild {
  return {
    armor: { id: 'wood', name: 'wood', massPct: 0, ac: 15, hpMult: 1 },
    components: COMPONENTS,
    weaponsCatalog: [],
    totalMass: 30,
    helm: 1,
    commandBridge: 0,
    sails,
    rudders,
    reinforcement: 0,
    cargoArea: 0,
    templateComponents: [],
    templateWeapons: [],
    deckLayout: {
      version: 2,
      bow: [{ cardKey: null }],
      stern: [{ cardKey: null }],
      port: [{ cardKey: 'component:comp-rudder' }],
      body: [[{ cardKey: 'component:comp-sail' }], [{ cardKey: null }]],
      starboard: [{ cardKey: null }],
    },
  } as unknown as ShipBuild;
}

function ship(b: ShipBuild, stations: ShipRuntime['stations'], boxState: Record<string, unknown> = {}): ShipRuntime {
  return {
    id: 'ship-1',
    boxState,
    stations,
    crewState: {},
    snapshot: {
      build: b,
      stats: {
        totalMass: 30, performanceMass: 30, accel: 0, mcRaw: 0, mcBands: [],
        minCrew: 1, fullCrew: 1,
      } as never,
      template: {} as never,
    },
  } as unknown as ShipRuntime;
}

const hero = (id: string, shipId: string): Unit => ({
  id,
  isHero: true,
  isDeleted: false,
  attachedToShipId: shipId,
  currentUnitHp: 10,
} as unknown as Unit);

describe('shipSailRudderManning', () => {
  it('counts living crew on the Sail card and covers the rudder from spare capacity', () => {
    const manning = shipSailRudderManning(
      ship(build(2, 1), { 'component:comp-sail': { crewIds: ['c1'] } }),
      [],
    );
    expect(manning).toMatchObject({
      survivingSails: 2,
      survivingRudders: 1,
      sailCrew: 1,
      rudderCrew: 0,
      effectiveSails: 2,
      effectiveRudders: 1,
      undermanned: false,
    });
  });

  it('reports undermanned when one crew cannot cover every surviving unit', () => {
    const manning = shipSailRudderManning(
      ship(build(6, 5), { 'component:comp-sail': { crewIds: ['c1'] } }),
      [],
    );
    expect(manning.effectiveSails).toBe(4);
    expect(manning.effectiveRudders).toBe(0);
    expect(manning.undermanned).toBe(true);
  });

  it('counts a living hero and ignores a dead one', () => {
    const withHero = shipSailRudderManning(
      ship(build(2, 1), { 'component:comp-sail': { heroIds: ['h1'] } }),
      [hero('h1', 'ship-1')],
    );
    expect(withHero.sailCrew).toBe(1);
    const dead = hero('h1', 'ship-1');
    dead.currentUnitHp = 0;
    expect(shipSailRudderManning(
      ship(build(2, 1), { 'component:comp-sail': { heroIds: ['h1'] } }),
      [dead],
    ).sailCrew).toBe(0);
  });

  it('uses surviving hardware after box damage', () => {
    const manning = shipSailRudderManning(
      ship(
        build(10, 7),
        { 'component:comp-sail': { crewIds: ['c1'] } },
        { 'component:comp-sail': 4, 'component:comp-rudder': 2 },
      ),
      [],
    );
    expect(manning.survivingSails).toBe(6);
    expect(manning.survivingRudders).toBe(6);
    expect(manning.effectiveSails).toBe(4);
    expect(manning.undermanned).toBe(true);
  });
});

describe('effectiveShipStats', () => {
  it('recomputes acceleration and MC from the manned counts', () => {
    const stats = effectiveShipStats(
      ship(build(2, 1), { 'component:comp-sail': { crewIds: ['c1'] } }),
      [],
    );
    // 2 sails + 1 rudder over 30 t: (3 / 30) × 15 = 1.5; MC x=0.33 → 1/0.33 + 2 = 5.
    expect(stats?.accel).toBe(1.5);
    expect(stats?.mcRaw).toBe(5);
  });

  it('returns null without a snapshot', () => {
    expect(effectiveShipStats({ snapshot: null } as unknown as ShipRuntime, [])).toBeNull();
  });
});
