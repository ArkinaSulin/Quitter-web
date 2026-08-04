import { describe, it, expect } from 'vitest';
import { computeReachableMap, computeChargeReachable, computeMoveBudget, computeMovePool, applyMoveCost, applyMpSpend, isMoveAffordable } from './moveCost';
import { Hex } from '@/types/gameProtocol';

const h = (q: number, r: number): Hex => ({ q, r, s: -q - r });

const formedUnit = {
  hex: h(0, 0),
  facing: 0,
  isRouting: false,
  currentFormation: 'Close Order',
};

// Facing 0 front dirs are HEX_DIRS[4]=(0,-1) and HEX_DIRS[5]=(1,-1).

describe('computeReachableMap — formed units', () => {
  it('costs 1 MP per front-arc step', () => {
    const map = computeReachableMap(formedUnit, 3, new Set(), new Set());
    expect(map.get('0,-1')?.cost).toBe(1);
    expect(map.get('1,-1')?.cost).toBe(1);
  });

  it('costs 1 MP per 60° turn', () => {
    // (1,0) is not in the front arc of facing 0 — needs one turn then a step.
    const map = computeReachableMap(formedUnit, 4, new Set(), new Set());
    const entry = map.get('1,0');
    expect(entry).toBeDefined();
    expect(entry!.cost).toBe(2);
    expect(entry!.path).toEqual([h(1, 0)]);
    expect(entry!.finalFacing).toBe(1);
  });

  it('picks the min-cost path to a hex', () => {
    // (1,-1) is directly in the front arc → cost 1, never higher.
    const map = computeReachableMap(formedUnit, 4, new Set(), new Set());
    expect(map.get('1,-1')?.cost).toBe(1);
  });

  it('honors maxMP', () => {
    const map = computeReachableMap(formedUnit, 1, new Set(), new Set());
    expect(map.has('0,-1')).toBe(true);
    expect(map.has('1,0')).toBe(false); // needs 2 MP
  });

  it('excludes occupied hexes', () => {
    const occupied = new Set(['0,-1']);
    const map = computeReachableMap(formedUnit, 4, occupied, new Set());
    expect(map.has('0,-1')).toBe(false);
  });

  it('allows stopping on a threat hex but never passing through', () => {
    const threats = new Set(['0,-1']);
    const map = computeReachableMap(formedUnit, 4, new Set(), threats);
    expect(map.get('0,-1')?.cost).toBe(1); // reachable as a destination
    map.forEach((entry) => {
      const intermediate = entry.path.slice(0, -1);
      for (const hex of intermediate) {
        expect(threats.has(`${hex.q},${hex.r}`)).toBe(false);
      }
    });
  });

  it('returns an empty map at 0 MP', () => {
    const map = computeReachableMap(formedUnit, 0, new Set(), new Set());
    expect(map.size).toBe(0);
  });
});

describe('computeReachableMap — routed / scattered', () => {
  const looseUnit = { ...formedUnit, isRouting: true };

  it('moves in any direction at 1 MP per hex (no facing)', () => {
    const map = computeReachableMap(looseUnit, 4, new Set(), new Set());
    expect(map.get('1,0')?.cost).toBe(1);
    expect(map.get('0,1')?.cost).toBe(1);
    expect(map.get('0,-1')?.cost).toBe(1);
    expect(map.get('0,-2')?.cost).toBe(2);
  });

  it('cannot move onto occupied hexes', () => {
    const occupied = new Set(['1,0']);
    const map = computeReachableMap(looseUnit, 4, occupied, new Set());
    expect(map.has('1,0')).toBe(false);
  });
});

describe('computeReachableMap — heroes move like Scattered (omnidirectional)', () => {
  const heroUnit = { ...formedUnit, currentFormation: 'Hero', isHero: true };

  it('moves in any direction at 1 MP per hex, no turning cost', () => {
    const map = computeReachableMap(heroUnit, 3, new Set(), new Set());
    expect(map.get('1,0')?.cost).toBe(1); // behind the facing — no turn needed
    expect(map.get('0,1')?.cost).toBe(1);
    expect(map.get('0,-1')?.cost).toBe(1); // front arc
    expect(map.get('0,-2')?.cost).toBe(2);
  });

  it('Hero formation alone (without isHero flag) is also loose', () => {
    const map = computeReachableMap({ ...formedUnit, currentFormation: 'Hero' }, 2, new Set(), new Set());
    expect(map.get('1,0')?.cost).toBe(1);
  });
});

describe('computeMoveBudget — 1 action = 1 full MP pool', () => {
  it('budget = leftover MP + actions × maxMP when actions ≥ 1', () => {
    expect(computeMoveBudget({ movementPointsAvailable: 0, actionsAvailable: 2 }, 5)).toBe(10);
    expect(computeMoveBudget({ movementPointsAvailable: 0, actionsAvailable: 1 }, 5)).toBe(5);
    expect(computeMoveBudget({ movementPointsAvailable: 3, actionsAvailable: 1 }, 5)).toBe(8);
  });

  it('shows leftover MP + one pool when actions = 0 (for soft-enforcement confirm)', () => {
    expect(computeMoveBudget({ movementPointsAvailable: 0, actionsAvailable: 0 }, 5)).toBe(5);
    expect(computeMoveBudget({ movementPointsAvailable: 2, actionsAvailable: 0 }, 5)).toBe(7);
  });
});

describe('computeMovePool — pool available for the current move', () => {
  it('is a full pool whenever an action remains (MP materializes on move)', () => {
    expect(computeMovePool({ movementPointsAvailable: 0, actionsAvailable: 2 }, 5)).toBe(5);
    expect(computeMovePool({ movementPointsAvailable: 2, actionsAvailable: 1 }, 5)).toBe(5);
  });

  it('falls back to leftover MP only when no actions remain', () => {
    expect(computeMovePool({ movementPointsAvailable: 2, actionsAvailable: 0 }, 5)).toBe(2);
    expect(computeMovePool({ movementPointsAvailable: 0, actionsAvailable: 0 }, 5)).toBe(0);
  });

  it('clamps to maxMP', () => {
    expect(computeMovePool({ movementPointsAvailable: 9, actionsAvailable: 0 }, 5)).toBe(5);
  });
});

describe('applyMoveCost — MP spent first, actions convert pools on demand', () => {
  it('spends an action to create a pool from a 0-MP start, keeping the remainder', () => {
    const res = applyMoveCost({ movementPointsAvailable: 0, actionsAvailable: 2 }, 1, 3);
    expect(res).toEqual({ movementPointsAvailable: 2, actionsAvailable: 1 });
  });

  it('uses leftover MP without spending another action', () => {
    const res = applyMoveCost({ movementPointsAvailable: 2, actionsAvailable: 1 }, 1, 3);
    expect(res).toEqual({ movementPointsAvailable: 1, actionsAvailable: 1 });
  });

  it('converts the next action only when a pool is exhausted', () => {
    const res = applyMoveCost({ movementPointsAvailable: 1, actionsAvailable: 1 }, 2, 3);
    expect(res).toEqual({ movementPointsAvailable: 2, actionsAvailable: 0 });
  });

  it('ends at 0 MP / 0 actions when both pools are exactly consumed', () => {
    const res = applyMoveCost({ movementPointsAvailable: 0, actionsAvailable: 2 }, 6, 3);
    expect(res).toEqual({ movementPointsAvailable: 0, actionsAvailable: 0 });
  });

  it('a 2-action unit can cross into its second pool', () => {
    const res = applyMoveCost({ movementPointsAvailable: 0, actionsAvailable: 2 }, 9, 5);
    expect(res).toEqual({ movementPointsAvailable: 1, actionsAvailable: 0 });
  });

  it('spends MP first and never wastes leftover on an in-budget move', () => {
    const res = applyMoveCost({ movementPointsAvailable: 5, actionsAvailable: 2 }, 3, 5);
    expect(res).toEqual({ movementPointsAvailable: 2, actionsAvailable: 2 });
  });

  it('goes negative on actions when over budget (soft enforcement)', () => {
    const res = applyMoveCost({ movementPointsAvailable: 0, actionsAvailable: 0 }, 1, 3);
    expect(res.actionsAvailable).toBe(-1);
    expect(res.movementPointsAvailable).toBe(2);
  });
});

describe('applyMpSpend — single-MP spends with refill', () => {
  it('deducts MP when sufficient, no action spent', () => {
    expect(applyMpSpend({ movementPointsAvailable: 3, actionsAvailable: 2 }, 1, 5))
      .toEqual({ movementPointsAvailable: 2, actionsAvailable: 2 });
  });

  it('converts an action to a full pool when MP is insufficient', () => {
    expect(applyMpSpend({ movementPointsAvailable: 0, actionsAvailable: 2 }, 1, 5))
      .toEqual({ movementPointsAvailable: 4, actionsAvailable: 1 });
  });

  it('goes negative without an action when none remain', () => {
    expect(applyMpSpend({ movementPointsAvailable: 0, actionsAvailable: 0 }, 1, 5))
      .toEqual({ movementPointsAvailable: -1, actionsAvailable: 0 });
  });
});

describe('isMoveAffordable', () => {
  it('true when leftover MP + actions cover the cost', () => {
    expect(isMoveAffordable({ movementPointsAvailable: 5, actionsAvailable: 2 }, 9, 5)).toBe(true);
    expect(isMoveAffordable({ movementPointsAvailable: 5, actionsAvailable: 1 }, 4, 5)).toBe(true);
    expect(isMoveAffordable({ movementPointsAvailable: 5, actionsAvailable: 0 }, 1, 5)).toBe(true);
  });

  it('false when cost exceeds leftover MP + actions (confirm modal)', () => {
    expect(isMoveAffordable({ movementPointsAvailable: 0, actionsAvailable: 0 }, 1, 5)).toBe(false);
    expect(isMoveAffordable({ movementPointsAvailable: 2, actionsAvailable: 0 }, 3, 5)).toBe(false);
  });
});

describe('computeChargeReachable — front-arc BFS wedge', () => {
  it('fans out a wedge: 1 step -> 2 hexes, 2 steps -> 3, 3 steps -> 4', () => {
    const map = computeChargeReachable({ hex: h(0, 0), facing: 0 }, new Set(), 3);
    // facing 0 front dirs: (0,-1) and (1,-1)
    expect(map.get('0,-1')).toBe(1);
    expect(map.get('1,-1')).toBe(1);
    expect(map.get('0,-2')).toBe(2);
    expect(map.get('1,-2')).toBe(2);
    expect(map.get('2,-2')).toBe(2);
    expect(map.get('0,-3')).toBe(3);
    expect(map.get('1,-3')).toBe(3);
    expect(map.get('2,-3')).toBe(3);
    expect(map.get('3,-3')).toBe(3);
    expect(map.size).toBe(2 + 3 + 4);
  });

  it('blocks an occupied hex and everything reachable only through it', () => {
    const occupied = new Set(['1,-1']);
    const map = computeChargeReachable({ hex: h(0, 0), facing: 0 }, occupied, 3);
    expect(map.has('1,-1')).toBe(false);
    // Only reachable via (1,-1): gone. (1,-2) is still reachable via (0,-1)->(1,-2).
    expect(map.has('2,-2')).toBe(false);
    expect(map.has('3,-3')).toBe(false);
    // the rest of the wedge survives
    expect(map.get('0,-1')).toBe(1);
    expect(map.get('0,-2')).toBe(2);
    expect(map.get('1,-2')).toBe(2);
    expect(map.get('0,-3')).toBe(3);
    expect(map.get('1,-3')).toBe(3);
    expect(map.get('2,-3')).toBe(3);
    expect(map.size).toBe(6);
  });

  it('honors maxHexes (one action pool)', () => {
    const map = computeChargeReachable({ hex: h(0, 0), facing: 0 }, new Set(), 1);
    expect(map.get('0,-1')).toBe(1);
    expect(map.get('1,-1')).toBe(1);
    expect(map.has('0,-2')).toBe(false);
    expect(map.size).toBe(2);
  });
});
