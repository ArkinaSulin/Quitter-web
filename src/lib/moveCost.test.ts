import { describe, it, expect } from 'vitest';
import { computeReachableMap, computeChargeReachable, computeMoveBudget, computeMovePool, computeMoveCapacity, applyMoveCost, applyMpSpend, isMoveAffordable, heroMovePerAction, computeHeroMoveBudget, computeHeroMovePool, applyHeroMoveCost, isHeroMoveAffordable, applyHeroMpSpend } from './moveCost';
import { Hex } from '@/types/gameProtocol';

const h = (q: number, r: number): Hex => ({ q, r, s: -q - r });

const formedUnit = {
  hex: h(0, 0),
  facing: 0,
  currentFormation: 'Close Order',
};

// Facing 0 front dirs are HEX_DIRS[4]=(0,-1) and HEX_DIRS[5]=(1,-1).

describe('computeReachableMap — formed units', () => {
  it('costs 1 MP per front-arc step, straight ahead (no turn)', () => {
    const map = computeReachableMap(formedUnit, 3, new Set(), new Set());
    expect(map.get('0,-1')).toMatchObject({ cost: 1, needsTurn: false });
    expect(map.get('1,-1')).toMatchObject({ cost: 1, needsTurn: false });
    expect(map.get('0,-2')?.cost).toBe(2);
  });

  it('marks off-axis hexes as needsTurn, costing steps + turns (cone)', () => {
    // (1,0) is not in the front arc of facing 0 — reachable only by one 60° turn
    // (1 MP) then one step (1 MP) = cost 2. Hint only; never droppable.
    const map = computeReachableMap(formedUnit, 3, new Set(), new Set());
    const entry = map.get('1,0');
    expect(entry).toBeDefined();
    expect(entry!.needsTurn).toBe(true);
    expect(entry!.cost).toBe(2);
  });

  it('keeps straight-ahead hexes white even when they are also in the hint area', () => {
    const map = computeReachableMap(formedUnit, 3, new Set(), new Set());
    expect(map.get('1,-1')?.needsTurn).toBe(false);
    expect(map.get('2,-2')?.needsTurn).toBe(false);
    expect(map.get('3,-3')?.needsTurn).toBe(false);
  });

  it('fills the interior of the front wedge white (zig-zag straight movement)', () => {
    // (1,-2) is reached by stepping (0,-1) then (1,-1) — both front-arc moves, no
    // turn — so it must be white (droppable), not grey.
    const map = computeReachableMap(formedUnit, 3, new Set(), new Set());
    expect(map.get('1,-2')).toMatchObject({ cost: 2, needsTurn: false });
    expect(map.get('1,-3')).toMatchObject({ cost: 3, needsTurn: false });
  });

  it('charges the about-turn as a single maneuver (foot: 1 MP, default)', () => {
    // Reaching a rear hex needs a 180° about-turn; the foot cost is 1 MP by
    // default, so (0,1) shows a grey hint at cost 2 (about-turn + 1 step).
    const map = computeReachableMap(formedUnit, 4, new Set(), new Set());
    const entry = map.get('0,1');
    expect(entry).toBeDefined();
    expect(entry!.needsTurn).toBe(true);
    expect(entry!.cost).toBe(2);
  });

  it('mounted Close Order cannot about-turn: rear hex costs 3 (no about-turn discount)', () => {
    // A foot unit reaches the rear hex in 2 (about-turn 1 MP + 1 step). A mounted
    // Close Order unit is "unable to turn around" — no about-turn edge — so the
    // rear hex costs 3 (two 60° turns + 1 step), and the unit can never end a
    // move facing directly rearward.
    const mountedClose = { ...formedUnit, mountId: 'mount-1', mountName: 'Horse' };
    const map = computeReachableMap(mountedClose, 4, new Set(), new Set());
    expect(map.get('0,1')?.needsTurn).toBe(true);
    expect(map.get('0,1')?.cost).toBe(3);
  });

  it('allows about-turn for mounted units outside Close Order', () => {
    const mountedOpen = { ...formedUnit, currentFormation: 'Open Order', mountId: 'mount-1', mountName: 'Horse' };
    const map = computeReachableMap(mountedOpen, 4, new Set(), new Set());
    expect(map.get('0,1')?.needsTurn).toBe(true);
  });

  it('honors maxMP for both white and grey hexes', () => {
    // At 1 MP only the straight-ahead hex is reachable; an off-axis hex needs a
    // turn + a step (2 MP), so it appears only once the pool allows it.
    const map1 = computeReachableMap(formedUnit, 1, new Set(), new Set());
    expect(map1.get('0,-1')?.needsTurn).toBe(false);
    expect(map1.has('1,0')).toBe(false); // turn + step > 1 MP
    expect(map1.has('0,-2')).toBe(false); // beyond the pool

    const map2 = computeReachableMap(formedUnit, 2, new Set(), new Set());
    expect(map2.get('1,0')?.needsTurn).toBe(true);
  });

  it('excludes occupied hexes', () => {
    const occupied = new Set(['0,-1']);
    const map = computeReachableMap(formedUnit, 4, occupied, new Set());
    expect(map.has('0,-1')).toBe(false);
  });

  it('allows stopping on a threat hex but never passing through', () => {
    const threats = new Set(['0,-1', '1,-1']); // both front-arc hexes block the rays
    const map = computeReachableMap(formedUnit, 2, new Set(), threats);
    expect(map.get('0,-1')?.cost).toBe(1); // reachable as a destination
    expect(map.get('1,-1')?.cost).toBe(1);
    expect(map.has('0,-2')).toBe(false); // beyond the blocked front
    expect(map.has('1,-2')).toBe(false);
  });

  it('returns an empty map at 0 MP', () => {
    const map = computeReachableMap(formedUnit, 0, new Set(), new Set());
    expect(map.size).toBe(0);
  });
});

describe('computeReachableMap — routed / scattered', () => {
  const looseUnit = { ...formedUnit, currentFormation: 'Routed' };

  it('moves in any direction at 1 MP per hex (no facing)', () => {
    const map = computeReachableMap(looseUnit, 4, new Set(), new Set());
    expect(map.get('1,0')).toMatchObject({ cost: 1, needsTurn: false });
    expect(map.get('0,1')).toMatchObject({ cost: 1, needsTurn: false });
    expect(map.get('0,-1')).toMatchObject({ cost: 1, needsTurn: false });
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
    expect(map.get('1,0')).toMatchObject({ cost: 1, needsTurn: false }); // behind the facing — no turn needed
    expect(map.get('0,1')).toMatchObject({ cost: 1, needsTurn: false });
    expect(map.get('0,-1')).toMatchObject({ cost: 1, needsTurn: false }); // front arc
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
  it('is a full pool only when MP is exhausted and an action remains', () => {
    expect(computeMovePool({ movementPointsAvailable: 0, actionsAvailable: 2 }, 5)).toBe(5);
    expect(computeMovePool({ movementPointsAvailable: 0, actionsAvailable: 1 }, 5)).toBe(5);
  });

  it('reflects leftover MP once MP is on hand, even with actions remaining', () => {
    expect(computeMovePool({ movementPointsAvailable: 2, actionsAvailable: 1 }, 5)).toBe(2);
    expect(computeMovePool({ movementPointsAvailable: 3, actionsAvailable: 2 }, 5)).toBe(3);
  });

  it('falls back to leftover MP when no actions remain', () => {
    expect(computeMovePool({ movementPointsAvailable: 2, actionsAvailable: 0 }, 5)).toBe(2);
    expect(computeMovePool({ movementPointsAvailable: 0, actionsAvailable: 0 }, 5)).toBe(0);
  });

  it('clamps to maxMP', () => {
    expect(computeMovePool({ movementPointsAvailable: 9, actionsAvailable: 0 }, 5)).toBe(5);
    expect(computeMovePool({ movementPointsAvailable: 9, actionsAvailable: 2 }, 5)).toBe(5);
  });
});

describe('computeMoveCapacity — true remaining capacity (no soft-enforcement fudge)', () => {
  it('sums leftover MP plus every remaining action as a full pool', () => {
    expect(computeMoveCapacity({ movementPointsAvailable: 0, actionsAvailable: 2 }, 5)).toBe(10);
    expect(computeMoveCapacity({ movementPointsAvailable: 3, actionsAvailable: 1 }, 5)).toBe(8);
    expect(computeMoveCapacity({ movementPointsAvailable: 2, actionsAvailable: 0 }, 5)).toBe(2);
  });

  it('is 0 when a unit has no MP and no actions', () => {
    expect(computeMoveCapacity({ movementPointsAvailable: 0, actionsAvailable: 0 }, 5)).toBe(0);
  });

  it('never goes negative', () => {
    expect(computeMoveCapacity({ movementPointsAvailable: -3, actionsAvailable: -1 }, 5)).toBe(0);
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

describe('hero movement — 5 actions = 1 full movement, prorated with fraction carry', () => {
  it('heroMovePerAction: maxMP/5 rounded to 1 decimal', () => {
    expect(heroMovePerAction(3)).toBe(0.6);   // user example: 1 action = 0.6 MP
    expect(heroMovePerAction(6)).toBe(1.2);   // horse example: 1 action = 1.2 MP
    expect(heroMovePerAction(5)).toBe(1);
    expect(heroMovePerAction(4)).toBe(0.8);
    expect(heroMovePerAction(0)).toBe(0.2);   // clamp: never 0
  });

  it('computeHeroMoveBudget: materialized MP + actions at the prorated rate', () => {
    expect(computeHeroMoveBudget({ movementPointsAvailable: 0, actionsAvailable: 5 }, 3)).toBe(3);   // 5 actions = full move
    expect(computeHeroMoveBudget({ movementPointsAvailable: 0.6, actionsAvailable: 4 }, 3)).toBe(3);  // 0.6 + 4×0.6 = 3
    expect(computeHeroMoveBudget({ movementPointsAvailable: 0, actionsAvailable: 0 }, 3)).toBe(0);
    expect(computeHeroMovePool({ movementPointsAvailable: 0, actionsAvailable: 5 }, 3)).toBe(3);
  });

  it('applyHeroMoveCost: spends materialized MP first, no conversion', () => {
    expect(applyHeroMoveCost({ movementPointsAvailable: 1.2, actionsAvailable: 5 }, 1, 3))
      .toEqual({ movementPointsAvailable: 0.2, actionsAvailable: 5 });
  });

  it('applyHeroMoveCost: converts ceil(need/per) actions, fraction carries (user example)', () => {
    // maxMP 3: converting 1 action grants 0.6 MP (display +0), a 2nd grants 1.2 (display +1).
    const one = applyHeroMoveCost({ movementPointsAvailable: 0, actionsAvailable: 5 }, 1, 3);
    expect(one.movementPointsAvailable).toBe(0.2); // 2 actions → 1.2 − 1
    expect(one.actionsAvailable).toBe(3);
  });

  it('applyHeroMoveCost: converts enough actions to cover the cost', () => {
    // cost 1, maxMP 3: ceil(1 / 0.6) = 2 actions → 1.2 MP − 1 = 0.2 left
    expect(applyHeroMoveCost({ movementPointsAvailable: 0, actionsAvailable: 5 }, 1, 3))
      .toEqual({ movementPointsAvailable: 0.2, actionsAvailable: 3 });
    // cost 2, maxMP 3: ceil(2 / 0.6) = 4 actions → 2.4 − 2 = 0.4 left
    expect(applyHeroMoveCost({ movementPointsAvailable: 0, actionsAvailable: 5 }, 2, 3))
      .toEqual({ movementPointsAvailable: 0.4, actionsAvailable: 1 });
    // cost 3, maxMP 3: 5 actions → exactly 3.0 MP, 0 left
    expect(applyHeroMoveCost({ movementPointsAvailable: 0, actionsAvailable: 5 }, 3, 3))
      .toEqual({ movementPointsAvailable: 0, actionsAvailable: 0 });
  });

  it('applyHeroMoveCost: combines leftover MP with conversions', () => {
    // 0.6 on hand, cost 2, maxMP 3: ceil(1.4 / 0.6) = 3 actions → 0.6+1.8−2 = 0.4
    expect(applyHeroMoveCost({ movementPointsAvailable: 0.6, actionsAvailable: 5 }, 2, 3))
      .toEqual({ movementPointsAvailable: 0.4, actionsAvailable: 2 });
  });

  it('applyHeroMoveCost: may go negative on actions (soft enforcement)', () => {
    // cost 3 needs ceil(3/0.6) = 5 actions; only 1 on hand → −4, MP exact 0
    expect(applyHeroMoveCost({ movementPointsAvailable: 0, actionsAvailable: 1 }, 3, 3))
      .toEqual({ movementPointsAvailable: 0, actionsAvailable: -4 });
  });

  it('isHeroMoveAffordable: false when conversions would go negative', () => {
    // 2 actions × 0.6 = 1.2 < 2 → cannot afford
    expect(isHeroMoveAffordable({ movementPointsAvailable: 0, actionsAvailable: 2 }, 2, 3)).toBe(false);
    // 4 actions × 0.6 = 2.4 ≥ 2 → affordable
    expect(isHeroMoveAffordable({ movementPointsAvailable: 0, actionsAvailable: 4 }, 2, 3)).toBe(true);
    // 3 actions × 0.6 = 1.8 < 2 → cannot afford
    expect(isHeroMoveAffordable({ movementPointsAvailable: 0, actionsAvailable: 3 }, 2, 3)).toBe(false);
    // materialized MP counts first: 1.2 on hand covers a 1-MP move
    expect(isHeroMoveAffordable({ movementPointsAvailable: 1.2, actionsAvailable: 0 }, 1, 3)).toBe(true);
  });

  it('applyHeroMpSpend: spends MP when sufficient', () => {
    expect(applyHeroMpSpend({ movementPointsAvailable: 1.2, actionsAvailable: 5 }, 1, 3))
      .toEqual({ movementPointsAvailable: 0.2, actionsAvailable: 5 });
  });

  it('applyHeroMpSpend: converts ceil(need/per) actions to make up the spend', () => {
    // 0.6 on hand, spend 1: ceil(0.4/0.6) = 1 action → 0.6+0.6−1 = 0.2
    expect(applyHeroMpSpend({ movementPointsAvailable: 0.6, actionsAvailable: 5 }, 1, 3))
      .toEqual({ movementPointsAvailable: 0.2, actionsAvailable: 4 });
    // 0 on hand, spend 1: ceil(1/0.6) = 2 actions → 1.2−1 = 0.2
    expect(applyHeroMpSpend({ movementPointsAvailable: 0, actionsAvailable: 5 }, 1, 3))
      .toEqual({ movementPointsAvailable: 0.2, actionsAvailable: 3 });
  });

  it('applyHeroMpSpend: converts even past 0 actions (soft — the UI asked first)', () => {
    // 0 MP, 0 actions, spend 1: converts ceil(1/0.6) = 2 actions → 1.2 − 1 = 0.2, actions −2
    expect(applyHeroMpSpend({ movementPointsAvailable: 0, actionsAvailable: 0 }, 1, 3))
      .toEqual({ movementPointsAvailable: 0.2, actionsAvailable: -2 });
  });

  it('horse example: 4 actions → 4.8 (display +4), 5th → 6.0 (display +6)', () => {
    // maxMP 6 (mounted): converting 4 actions then moving 4 MP
    const four = applyHeroMoveCost({ movementPointsAvailable: 0, actionsAvailable: 5 }, 4, 6);
    expect(four.movementPointsAvailable).toBe(0.8); // 4×1.2 − 4
    const fifth = applyHeroMoveCost({ movementPointsAvailable: 0.8, actionsAvailable: 1 }, 2, 6);
    expect(fifth).toEqual({ movementPointsAvailable: 0, actionsAvailable: 0 }); // 0.8 + 1.2 − 2 = 0
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
