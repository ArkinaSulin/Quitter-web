import { describe, expect, it } from 'vitest';
import {
  advanceShipReload,
  fireShipWeapon,
  manualShipWeaponLoad,
  planShipWeaponAutoLoad,
  pickShipComponent,
  rollShipDamage,
  shipArcAllowed,
  shipAttackMode,
  shipCollisionDamage,
  shipRamDamage,
  shipRangeBand,
  shipTargetArc,
  survivingSailRudder,
  componentTonsForDamage,
  cappedComponentTons,
} from '@/packages/ships';
import { HEX_DIRS } from '@/packages/primitives';
import type { ShipBuild } from '@/packages/ships';
import type { ShipComponent } from '@/types/ship';

const COMPONENTS: ShipComponent[] = [
  { id: 'comp-hull', name: 'Hull', mass: 0, crew: 0, cost: 0, hittable: false, effect: null, builtIn: true, canCombine: true, dt: 15 },
  { id: 'comp-sail', name: 'Sail', mass: 1, crew: 0, cost: 0, hittable: true, effect: null, builtIn: true, canCombine: true, dt: 15 },
  { id: 'comp-rudder', name: 'Rudder', mass: 1.5, crew: 0.5, cost: 0, hittable: true, effect: null, builtIn: true, canCombine: true, dt: 15 },
];

function sailRudderBuild(sails: number, rudders: number): ShipBuild {
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

const weapon = { minRange: 1, range: 3, maxRange: 10 };

describe('shipRangeBand', () => {
  it('rejects inside minimum and beyond max', () => {
    expect(shipRangeBand(0, weapon)).toBe('tooClose');
    expect(shipRangeBand(1, weapon)).toBe('tooClose');
    expect(shipRangeBand(11, weapon)).toBe('outOfRange');
  });

  it('normal inside range, disadvantage to max', () => {
    expect(shipRangeBand(2, weapon)).toBe('normal');
    expect(shipRangeBand(3, weapon)).toBe('normal');
    expect(shipRangeBand(4, weapon)).toBe('disadvantage');
    expect(shipRangeBand(10, weapon)).toBe('disadvantage');
  });
});

describe('firing arcs', () => {
  const origin = { q: 0, r: 0, s: 0 };
  const at = (dir: number) => ({ q: HEX_DIRS[dir].q, r: HEX_DIRS[dir].r, s: -HEX_DIRS[dir].q - HEX_DIRS[dir].r });

  it('maps front dirs to bow, rear dirs to stern, sides to port/starboard', () => {
    expect(shipTargetArc(origin, 0, at(4))).toBe('bow');
    expect(shipTargetArc(origin, 0, at(5))).toBe('bow');
    expect(shipTargetArc(origin, 0, at(1))).toBe('stern');
    expect(shipTargetArc(origin, 0, at(2))).toBe('stern');
    expect(shipTargetArc(origin, 0, at(3))).toBe('port');
    expect(shipTargetArc(origin, 0, at(0))).toBe('starboard');
  });

  it('resolves the same sectors at any range', () => {
    const far = (q: number, r: number) => ({ q, r, s: -q - r });
    expect(shipTargetArc(origin, 0, far(3, 0))).toBe('starboard');
    expect(shipTargetArc(origin, 0, far(-3, 0))).toBe('port');
    expect(shipTargetArc(origin, 0, far(0, -3))).toBe('bow');
    expect(shipTargetArc(origin, 0, far(0, 3))).toBe('stern');
    expect(shipTargetArc(origin, 0, far(3, -3))).toBe('bow');
    expect(shipTargetArc(origin, 0, far(-3, 3))).toBe('stern');
  });

  it('allows a weapon arc against a distant target on that side', () => {
    const east = { q: 3, r: 0, s: -3 };
    expect(shipAttackMode(3, weapon, ['starboard'], origin, 0, east).mode).toBe('normal');
    expect(shipAttackMode(3, weapon, ['port'], origin, 0, east).mode).toBe('none');
  });

  it('respects arc lists, and arcs off is 360', () => {
    expect(shipArcAllowed(['bow'], 'bow')).toBe(true);
    expect(shipArcAllowed(['bow'], 'stern')).toBe(false);
    expect(shipArcAllowed(['bow'], 'stern', false)).toBe(true);
  });

  it('combines range and arc', () => {
    expect(shipAttackMode(2, weapon, ['bow'], origin, 0, at(4)).mode).toBe('normal');
    expect(shipAttackMode(2, weapon, ['stern'], origin, 0, at(4)).mode).toBe('none');
    expect(shipAttackMode(5, weapon, ['bow'], origin, 0, at(4)).mode).toBe('disadvantage');
    expect(shipAttackMode(11, weapon, ['bow'], origin, 0, at(4)).mode).toBe('none');
  });
});

describe('damage formulas', () => {
  it('uses min(floor(ton/10),16)d(speed)', () => {
    expect(shipRamDamage(80, 7)).toEqual({ count: 8, faces: 7 });
    expect(shipRamDamage(400, 9)).toEqual({ count: 16, faces: 9 });
    expect(shipRamDamage(4, 5)).toEqual({ count: 1, faces: 5 });
  });

  it('collision is half the ram dice count (min 1)', () => {
    expect(shipCollisionDamage(80, 7)).toEqual({ count: 4, faces: 7 });
    expect(shipCollisionDamage(4, 5)).toEqual({ count: 1, faces: 5 });
  });

  it('rolls deterministic dice', () => {
    expect(rollShipDamage(2, 6, () => 0)).toBe(2);
    expect(rollShipDamage(2, 6, () => 0.999)).toBe(12);
  });
});

describe('component selection', () => {
  it('weights by tons and skips safe cards', () => {
    const cards = [
      { key: 'hull', name: 'Hull', tons: 10 },
      { key: 'armor', name: 'Armor', tons: 50, safe: true },
      { key: 'weapon', name: 'Ballista', tons: 2, kind: 'weapon' as const },
    ];
    expect(pickShipComponent(cards, () => 0)?.key).toBe('hull');
    expect(pickShipComponent(cards, () => 0.99)?.key).toBe('weapon');
    expect(pickShipComponent([{ key: 'armor', name: 'Armor', tons: 50, safe: true }])).toBeNull();
  });
});

describe('reload', () => {
  it('arms after reloadSteps loading steps', () => {
    let state = { progress: 0, armed: false };
    for (let i = 0; i < 4; i += 1) state = advanceShipReload(state, 4);
    expect(state).toEqual({ progress: 4, armed: true });
  });

  it('reload 0 is armed immediately and firing resets', () => {
    expect(advanceShipReload({ progress: 0, armed: false }, 0)).toEqual({ progress: 0, armed: true });
    expect(fireShipWeapon()).toEqual({ progress: 0, armed: false });
  });

  it('an armed weapon stays armed until fired', () => {
    expect(advanceShipReload({ progress: 4, armed: true }, 4)).toEqual({ progress: 4, armed: true });
  });
});

describe('manualShipWeaponLoad', () => {
  it('advances one reload step and arms at the reload maximum', () => {
    expect(manualShipWeaponLoad({ progress: 0, armed: false }, 2)).toEqual({
      progress: 1,
      armed: false,
    });
    expect(manualShipWeaponLoad({ progress: 1, armed: false }, 2)).toEqual({
      progress: 2,
      armed: true,
    });
  });
});

describe('planShipWeaponAutoLoad', () => {
  const base = { reloadSteps: 4,
    maxTargets: 1, fullCrew: true, hasHero: false, cardStepsRemaining: 5 };

  it('loads one step per ship step in wildspace', () => {
    expect(planShipWeaponAutoLoad({ progress: 0, armed: false }, { ...base, mode: 'wildspace' })).toEqual({
      state: { progress: 1, armed: false },
      loads: 1,
    });
  });

  it('batches up to the remaining card steps at the start of an atmosphere turn', () => {
    expect(planShipWeaponAutoLoad({ progress: 0, armed: false }, { ...base, mode: 'atmosphere' })).toEqual({
      state: { progress: 4, armed: true },
      loads: 4,
    });
  });

  it('a hero on the card suppresses auto-load', () => {
    expect(planShipWeaponAutoLoad(
      { progress: 1, armed: false },
      { ...base, mode: 'wildspace', hasHero: true },
    )).toEqual({ state: { progress: 1, armed: false }, loads: 0 });
  });

  it('never loads more than the remaining card steps', () => {
    expect(planShipWeaponAutoLoad(
      { progress: 0, armed: false },
      { ...base, reloadSteps: 5, mode: 'atmosphere', cardStepsRemaining: 1 },
    )).toEqual({ state: { progress: 1, armed: false }, loads: 1 });
  });
});

describe('component damage', () => {
  it('uses one ton per full 10 damage', () => {
    expect(componentTonsForDamage(9)).toBe(0);
    expect(componentTonsForDamage(10)).toBe(1);
    expect(componentTonsForDamage(15)).toBe(1);
    expect(componentTonsForDamage(21)).toBe(2);
    expect(componentTonsForDamage(49)).toBe(4);
  });

  it('caps at the struck card remaining boxes', () => {
    expect(cappedComponentTons(4, 49)).toBe(4);
    expect(cappedComponentTons(1, 49)).toBe(1);
    expect(cappedComponentTons(0, 49)).toBe(0);
  });
});

describe('surviving sails and rudders', () => {
  it('sail boxes map one-to-one and rudders use surviving tonnage', () => {
    const build = sailRudderBuild(10, 7);
    expect(survivingSailRudder(build, {})).toEqual({ sails: 10, rudders: 7 });
    // 10 sails - 4 boxes = 6 sails; 10.5 t - 1 t = 9.5 t ? ceil(6.33) = 7 rudders.
    expect(survivingSailRudder(build, {
      'component:comp-sail': 4,
      'component:comp-rudder': 1,
    })).toEqual({ sails: 6, rudders: 7 });
    // Two rudder tons: 8.5 / 1.5 = 5.67 ? 6.
    expect(survivingSailRudder(build, {
      'component:comp-sail': 4,
      'component:comp-rudder': 2,
    })).toEqual({ sails: 6, rudders: 6 });
    // Three rudder tons: 7.5 / 1.5 = 5 exactly.
    expect(survivingSailRudder(build, {
      'component:comp-sail': 4,
      'component:comp-rudder': 3,
    })).toEqual({ sails: 6, rudders: 5 });
  });

  it('falls back to the design counts without a deck layout', () => {
    const build = sailRudderBuild(10, 7);
    build.deckLayout = undefined;
    expect(survivingSailRudder(build, { 'component:comp-sail': 99 })).toEqual({ sails: 10, rudders: 7 });
  });
});
