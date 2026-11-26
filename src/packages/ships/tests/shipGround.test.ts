import { describe, expect, it } from 'vitest';
import {
  shipAtmospherePools,
  shipAtmosphereSpend,
  shipGroundCapability,
  shipIsGrounded,
} from '@/packages/ships';
import type { ShipRuntime } from '@/packages/ships';

function ship(over: Record<string, unknown>): ShipRuntime {
  return {
    id: 's1',
    hex: { q: 0, r: 0, s: 0 },
    elevation: 0,
    mpSpent: 0,
    fpSpent: 0,
    boxState: {},
    snapshot: {
      build: {
        components: [],
        templateComponents: [],
        templateWeapons: [],
        weaponsCatalog: [],
        sails: 0,
        ...over,
      },
    },
  } as unknown as ShipRuntime;
}

describe('ship ground movement', () => {
  it('terrain legs grant MP and MC 0', () => {
    const s = ship({
      components: [{ id: 'legs', name: 'Terrain legs', mass: 1, terrainLegs: true, groundMp: 4, builtIn: true }],
    });
    expect(shipGroundCapability(s)).toEqual({ mp: 4, mcZero: true });
    const pools = shipAtmospherePools(s, { atmosphericSpeed: 2 } as never);
    expect(pools.mpMax).toBe(4);
    expect(pools.fpMax).toBe(2);
    expect(pools.mcZero).toBe(true);
  });

  it('sails use MP = FP; ships without sails/legs have MP 0', () => {
    const sailed = ship({ sails: 1 });
    const passive = ship({});
    expect(shipAtmospherePools(sailed, { atmosphericSpeed: 3 } as never).mpMax).toBe(3);
    expect(shipAtmospherePools(passive, { atmosphericSpeed: 3 } as never).mpMax).toBe(0);
  });

  it('grounded detection uses the hex surface', () => {
    expect(shipIsGrounded(0, 0)).toBe(true);
    expect(shipIsGrounded(10, 10)).toBe(true);
    expect(shipIsGrounded(10, 0)).toBe(false);
  });

  it('spending one pool drains the other at the ratio (floor)', () => {
    const pools = { mpSpent: 0, fpSpent: 0, mpMax: 5, fpMax: 5 };
    expect(shipAtmosphereSpend(pools, 'mp', 1, 1)).toEqual({ mpSpent: 1, fpSpent: 1 });
    expect(shipAtmosphereSpend(pools, 'fp', 1, 0.5)).toEqual({ mpSpent: 0, fpSpent: 1 });
    expect(shipAtmosphereSpend(pools, 'mp', 2, 0.5)).toEqual({ mpSpent: 2, fpSpent: 1 });
  });
});
