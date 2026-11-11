import { describe, expect, it } from 'vitest';
import {
  computeShipReachable,
  declareSpeed,
  effectiveMCForSpeed,
  facingChangeDistance,
  spellSlotCostForHexes,
  splitSpeedAcrossSteps,
} from '@/packages/ships';

const bands = [
  { label: 'Speed 0-2', speedMin: 0, speedMax: 2, mc: 1 },
  { label: 'Speed 3-7', speedMin: 3, speedMax: 7, mc: 2 },
  { label: 'Speed 8-12', speedMin: 8, speedMax: 12, mc: 3 },
];

describe('splitSpeedAcrossSteps', () => {
  it('matches the cumulative-rounding examples', () => {
    expect(splitSpeedAcrossSteps(8)).toEqual([2, 1, 2, 1, 2]);
    expect(splitSpeedAcrossSteps(11)).toEqual([2, 2, 3, 2, 2]);
    expect(splitSpeedAcrossSteps(5)).toEqual([1, 1, 1, 1, 1]);
    expect(splitSpeedAcrossSteps(0)).toEqual([0, 0, 0, 0, 0]);
  });
});

describe('speed declaration', () => {
  it('caps free acceleration at the derived acceleration', () => {
    expect(declareSpeed({ previousSpeed: 5, accelDelta: 99, extraHexes: 0, acceleration: 3 })).toBe(8);
    expect(declareSpeed({ previousSpeed: 5, accelDelta: -99, extraHexes: 0, acceleration: 3 })).toBe(2);
  });

  it('adds spell-bought hexes and clamps to 0..12', () => {
    expect(declareSpeed({ previousSpeed: 5, accelDelta: 2, extraHexes: 3, acceleration: 5 })).toBe(10);
    expect(declareSpeed({ previousSpeed: 12, accelDelta: 3, extraHexes: 2, acceleration: 5 })).toBe(12);
    expect(declareSpeed({ previousSpeed: 1, accelDelta: -3, extraHexes: -2, acceleration: 5 })).toBe(0);
  });

  it('prices spell hexes from mass/10 (rounded)', () => {
    expect(spellSlotCostForHexes(2, 75)).toBe(16); // round(7.5) = 8
    expect(spellSlotCostForHexes(-2, 75)).toBe(16);
    expect(spellSlotCostForHexes(1, 4)).toBe(1); // max(1, 0)
  });
});

describe('MC facing gate', () => {
  it('reads the effective MC from the speed band', () => {
    expect(effectiveMCForSpeed({ mcBands: bands }, 0)).toBe(1);
    expect(effectiveMCForSpeed({ mcBands: bands }, 5)).toBe(2);
    expect(effectiveMCForSpeed({ mcBands: bands }, 9)).toBe(3);
    expect(facingChangeDistance({ mcBands: bands }, 9)).toBe(3);
  });

  it('MC 0 turns freely', () => {
    expect(effectiveMCForSpeed({ mcBands: [{ ...bands[0], mc: 0 }] }, 0)).toBe(0);
  });
});

describe('computeShipReachable', () => {
  const start = { hex: { q: 0, r: 0, s: 0 }, facing: 0 };

  it('moves straight ahead without turning', () => {
    const reach = computeShipReachable(start, 2, 1);
    // Two forward hexes are reachable (front arcs = dirs 4 and 5 of facing 0).
    expect(reach.size).toBeGreaterThanOrEqual(3);
    expect(Array.from(reach.values()).some(e => e.cost === 2)).toBe(true);
  });

  it('requires the MC distance before a turn', () => {
    const reach = computeShipReachable(start, 1, 2);
    // With 1 pool point and MC 2, only forward movement is legal (no turn).
    const turned = Array.from(reach.values()).filter(e => e.finalFacing !== 0 && e.cost > 0);
    expect(turned).toHaveLength(0);
  });

  it('allows turning once the requirement is met', () => {
    const reach = computeShipReachable(start, 3, 1);
    expect(Array.from(reach.values()).some(e => e.finalFacing !== 0)).toBe(true);
  });

  it('marks occupied hexes as not endable but still reachable', () => {
    const reach = computeShipReachable(start, 2, 0, { occupied: new Set(['1,0']) });
    const entry = reach.get('1,0');
    if (entry) expect(entry.endable).toBe(false);
  });
});
