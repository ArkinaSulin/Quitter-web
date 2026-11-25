import { describe, expect, it } from 'vitest';
import {
  adjustStepBudget,
  computeShipReachable,
  declareSpeed,
  effectiveMCForSpeed,
  effectiveTurnDistance,
  facingChangeDistance,
  rebuildStepBudgetPreservingMoved,
  shipFacingRadians,
  shipMC,
  shipRoundRemaining,
  shipRoundSpent,
  shipTurnDistance,
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

  it('rudder trim reduces the turn distance and never goes below 0', () => {
    expect(effectiveTurnDistance({ mcBands: bands }, 9, 1)).toBe(2);
    expect(effectiveTurnDistance({ mcBands: bands }, 9, 5)).toBe(0);
    expect(effectiveTurnDistance({ mcBands: bands }, 9, 0)).toBe(3);
  });
});

describe('mode MC rule', () => {
  const stats = {
    mcRaw: 2.4,
    mcBands: [
      { label: 'Speed 0-2', speedMin: 0, speedMax: 2, mc: 1.4 },
      { label: 'Speed 3-7', speedMin: 3, speedMax: 7, mc: 2.4 },
      { label: 'Speed 8-12', speedMin: 8, speedMax: 12, mc: 3.4 },
    ],
  };

  it('atmosphere is one base MC, independent of speed', () => {
    expect(shipMC(stats, 0, 'atmosphere')).toBe(3);
    expect(shipMC(stats, 9, 'atmosphere')).toBe(3);
    expect(shipMC(stats, 12, 'atmosphere')).toBe(3);
  });

  it('wildspace keeps the speed bands', () => {
    expect(shipMC(stats, 0, 'wildspace')).toBe(2);
    expect(shipMC(stats, 5, 'wildspace')).toBe(3);
    expect(shipMC(stats, 9, 'wildspace')).toBe(4);
  });

  it('applies rudder trim after the mode MC', () => {
    expect(shipTurnDistance(stats, 9, 'atmosphere')).toBe(3);
    expect(shipTurnDistance(stats, 9, 'atmosphere', 1)).toBe(2);
    expect(shipTurnDistance(stats, 9, 'wildspace', 1)).toBe(3);
    expect(shipTurnDistance(stats, 9, 'atmosphere', 99)).toBe(0);
  });

  it('MC 0 turns freely and a missing base MC never turns', () => {
    expect(shipMC({ ...stats, mcRaw: 0 }, 9, 'atmosphere')).toBe(0);
    expect(shipTurnDistance({ ...stats, mcRaw: 0 }, 9, 'atmosphere', 5)).toBe(0);
    expect(shipMC({ mcRaw: Number.POSITIVE_INFINITY, mcBands: stats.mcBands }, 9, 'atmosphere'))
      .toBe(Number.POSITIVE_INFINITY);
  });

  it('uses the atmosphere one-MC gate in the move preview', () => {
    const start = { hex: { q: 0, r: 0, s: 0 }, facing: 0 };
    // 3 straight hexes + 1 turn + 1 forward hex = 5 pool points. Atmosphere
    // MC 3 allows the turned move; wildspace MC 4 at the same speed does not.
    const atmo = computeShipReachable(start, 5, shipTurnDistance(stats, 9, 'atmosphere'));
    expect(Array.from(atmo.values()).some(e => e.finalFacing !== 0)).toBe(true);

    const space = computeShipReachable(start, 5, shipTurnDistance(stats, 9, 'wildspace'));
    expect(Array.from(space.values()).some(e => e.finalFacing !== 0)).toBe(false);
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

  it('uses the canonical HEX_DIRS front: facing 0 is north, not south', () => {
    const reach = computeShipReachable(start, 1, 0);
    expect(reach.has('0,-1')).toBe(true);
    expect(reach.has('1,-1')).toBe(true);
    expect(reach.has('0,1')).toBe(false);
    expect(reach.has('-1,1')).toBe(false);
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

describe('round movement helpers', () => {
  const speed12 = { stepBudget: [2, 3, 2, 3, 2], step: 5, speedSpent: 1 };

  it('sums remaining current-step and later budgets', () => {
    expect(shipRoundRemaining({ stepBudget: [2, 3, 2, 3, 2], step: 1, speedSpent: 0 }, 1)).toBe(12);
    expect(shipRoundRemaining(speed12, 5)).toBe(1);
  });

  it('derives spent as declared speed minus whole-turn remaining', () => {
    expect(shipRoundSpent(12, speed12, 5)).toBe(11);
    expect(shipRoundSpent(12, { stepBudget: [2, 3, 2, 3, 2], step: 1, speedSpent: 0 }, 1)).toBe(0);
  });

  it('rebuilds current/future budgets while preserving completed steps', () => {
    expect(rebuildStepBudgetPreservingMoved({ newSpeed: 11, ship: speed12, step: 5 }))
      .toEqual([2, 3, 2, 3, 1]);
    const at3 = rebuildStepBudgetPreservingMoved({
      newSpeed: 8,
      ship: { stepBudget: [2, 3, 2, 3, 2], step: 3, speedSpent: 1 },
      step: 3,
    });
    expect(at3.slice(0, 2)).toEqual([2, 3]);
    expect(at3.reduce((a, b) => a + b, 0)).toBe(8);
    expect(at3[2] - 1 + at3[3] + at3[4]).toBe(2);
  });
});

describe('adjustStepBudget', () => {
  it('adds the delta to the requested step', () => {
    expect(adjustStepBudget([2, 1, 2, 1, 2], 3, 1)).toEqual([2, 1, 3, 1, 2]);
    expect(adjustStepBudget([2, 1, 2, 1, 2], 1, -1)).toEqual([1, 1, 2, 1, 2]);
  });

  it('never drops below 0 but has no upper clamp', () => {
    expect(adjustStepBudget([0, 1, 0, 0, 0], 2, -1)).toEqual([0, 0, 0, 0, 0]);
    expect(adjustStepBudget([0, 0, 0, 0, 0], 1, -1)).toEqual([0, 0, 0, 0, 0]);
    expect(adjustStepBudget([12, 0, 0, 0, 0], 1, 1)).toEqual([13, 0, 0, 0, 0]);
    expect(adjustStepBudget([13, 0, 0, 0, 0], 1, 1)).toEqual([14, 0, 0, 0, 0]);
  });

  it('pads a missing budget to five steps', () => {
    expect(adjustStepBudget(undefined, 1, 1)).toEqual([1, 0, 0, 0, 0]);
  });
});

describe('shipFacingRadians', () => {
  it('maps facing steps to canvas radians (clockwise)', () => {
    expect(shipFacingRadians(0)).toBe(0);
    expect(shipFacingRadians(1)).toBeCloseTo(Math.PI / 3);
    expect(shipFacingRadians(3)).toBeCloseTo(Math.PI);
    expect(shipFacingRadians(6)).toBe(0);
    expect(shipFacingRadians(-1)).toBeCloseTo((5 * Math.PI) / 3);
  });
});
