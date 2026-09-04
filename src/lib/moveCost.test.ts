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
  });

  it('computeHeroMovePool: floor of payable MP — a token moves only when it can pay the full 1 MP per hex', () => {
    // Fresh hero with FULL MP + 5 actions: the shading is ONE full move, not MP + all
    // conversions (that was the double-reach bug: 6 MP + 5×1.2 = 12).
    expect(computeHeroMovePool({ movementPointsAvailable: 6, actionsAvailable: 5 }, 6)).toBe(6);
    // Full pool stays exact.
    expect(computeHeroMovePool({ movementPointsAvailable: 0, actionsAvailable: 5 }, 5)).toBe(5);
    expect(computeHeroMovePool({ movementPointsAvailable: 0, actionsAvailable: 5 }, 3)).toBe(3);
    // No MP/actions → 0.
    expect(computeHeroMovePool({ movementPointsAvailable: 0, actionsAvailable: 0 }, 3)).toBe(0);
    // Leftover MP ≥ 1 hex drives the shade — floored, actions are NOT shown (units rule).
    expect(computeHeroMovePool({ movementPointsAvailable: 1.2, actionsAvailable: 4 }, 5)).toBe(1);   // 1.2 pays 1 hex
    expect(computeHeroMovePool({ movementPointsAvailable: 3, actionsAvailable: 5 }, 3)).toBe(3);     // capped at pool
    expect(computeHeroMovePool({ movementPointsAvailable: 1, actionsAvailable: 5 }, 3)).toBe(1);     // 1.0 is a full hex → MP branch
    // The bug case: 0 MP + 1 action converts to 1.2 MP — the shade is floor(1.2) = 1 hex,
    // NOT ceil = 2 (a hex costs a full 1 MP).
    expect(computeHeroMovePool({ movementPointsAvailable: 0, actionsAvailable: 1 }, 6)).toBe(1);
    // 0.6 MP can't pay a hex → nothing movable.
    expect(computeHeroMovePool({ movementPointsAvailable: 0, actionsAvailable: 1 }, 3)).toBe(0);
    expect(computeHeroMovePool({ movementPointsAvailable: 0, actionsAvailable: 2 }, 6)).toBe(2);     // floor(2.4)
    // Fractional MP below one hex does NOT dominate — it CARRIES into the conversion total,
    // floored at the end (the Davi rule; the old ceil(mp) branch collapsed the ring to 1 hex).
    expect(computeHeroMovePool({ movementPointsAvailable: 0.6, actionsAvailable: 5 }, 3)).toBe(3);   // floor(3.6) → 3
    expect(computeHeroMovePool({ movementPointsAvailable: 0.2, actionsAvailable: 4 }, 3)).toBe(2);   // floor(2.6) → 2, 0.6 can't pay
    expect(computeHeroMovePool({ movementPointsAvailable: 0.8, actionsAvailable: 1 }, 6)).toBe(2);   // floor(2.0)
    expect(computeHeroMovePool({ movementPointsAvailable: 0, actionsAvailable: 2 }, 5)).toBe(2);     // 2×1.0
    expect(computeHeroMovePool({ movementPointsAvailable: 0.5, actionsAvailable: 4 }, 6)).toBe(5);   // floor(5.3), 0.3 can't pay
    expect(computeHeroMovePool({ movementPointsAvailable: 0.4, actionsAvailable: 3 }, 5)).toBe(3);   // floor(3.4)
    expect(computeHeroMovePool({ movementPointsAvailable: 0.5, actionsAvailable: 5 }, 6)).toBe(6);   // floor(6.5) → 6, capped at one move
    // Tiny MP with no actions left → nothing to convert, no shade.
    expect(computeHeroMovePool({ movementPointsAvailable: 0.8, actionsAvailable: 0 }, 3)).toBe(0);
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

describe('computeReachableMap — per-hex terrain entry costs', () => {
  // costOfHex: default 1 everywhere; painted hexes pay extra on ENTRY.
  const costs = (c: Record<string, number>) => (q: number, r: number) => c[`${q},${r}`] ?? 1;

  it('formed unit pays the entry cost of each hex it steps into (front arc)', () => {
    const map = computeReachableMap(formedUnit, 4, new Set(), new Set(), costs({ '0,-1': 2 }));
    expect(map.get('0,-1')).toMatchObject({ cost: 2, needsTurn: false }); // expensive first step
    expect(map.get('1,-1')).toMatchObject({ cost: 1, needsTurn: false }); // cheap neighbor stays cheap
    // (0,-2) is only reachable through (0,-1): 2 + 1 = 3.
    expect(map.get('0,-2')?.cost).toBe(3);
    // (1,-2) is reachable through the cheap ray (1,-1) then (1,-2): 1 + 1 = 2.
    expect(map.get('1,-2')?.cost).toBe(2);
  });

  it('a 2-MP hex halves a 2-MP pool: one step only', () => {
    const map = computeReachableMap(formedUnit, 2, new Set(), new Set(), costs({ '0,-1': 2, '1,-1': 2 }));
    expect(map.get('0,-1')).toMatchObject({ cost: 2, needsTurn: false });
    expect(map.get('1,-1')).toMatchObject({ cost: 2, needsTurn: false });
    expect(map.has('0,-2')).toBe(false); // 2 + 1 > 2
    expect(map.has('1,-2')).toBe(false);
  });

  it('loose (routed/scattered) units pay terrain entry costs omnidirectionally', () => {
    const looseUnit = { ...formedUnit, currentFormation: 'Routed' };
    const map = computeReachableMap(looseUnit, 6, new Set(), new Set(), costs({ '1,0': 3 }));
    expect(map.get('1,0')).toMatchObject({ cost: 3, needsTurn: false });
    // (0,-1) has no terrain: still 1.
    expect(map.get('0,-1')).toMatchObject({ cost: 1, needsTurn: false });
  });

  it('heroes (omnidirectional) pay terrain entry costs', () => {
    const heroUnit = { ...formedUnit, currentFormation: 'Hero', isHero: true };
    const map = computeReachableMap(heroUnit, 4, new Set(), new Set(), costs({ '-1,0': 2 }));
    expect(map.get('-1,0')).toMatchObject({ cost: 2, needsTurn: false });
    expect(map.get('1,0')).toMatchObject({ cost: 1, needsTurn: false });
    expect(map.get('0,1')).toMatchObject({ cost: 1, needsTurn: false });
  });

  it('terrain applies inside the needs-turn (grey) hint pass too', () => {
    // (1,0) needs a turn (1 MP) + a step. Entry cost of (1,0) is 2 -> grey cost 3.
    const map = computeReachableMap(formedUnit, 4, new Set(), new Set(), costs({ '1,0': 2 }));
    const entry = map.get('1,0');
    expect(entry).toBeDefined();
    expect(entry!.needsTurn).toBe(true);
    expect(entry!.cost).toBe(3);
  });

  it('a 0-MP painted hex is free to enter (loose unit moves through freely)', () => {
    const costs = (c: Record<string, number>) => (q: number, r: number) => c[`${q},${r}`] ?? 1;
    const looseUnit = { ...formedUnit, currentFormation: 'Routed' };
    const map = computeReachableMap(looseUnit, 3, new Set(), new Set(), costs({ '1,0': 0 }));
    expect(map.get('1,0')).toMatchObject({ cost: 0, needsTurn: false });
    // A zero-cost chain stays bounded by maxMP in hex COUNT, not MP sum.
    const chain = computeReachableMap(looseUnit, 1, new Set(), new Set(), costs({ '1,0': 0, '2,0': 0, '3,0': 0 }));
    expect(chain.get('1,0')?.cost).toBe(0);
    expect(chain.has('2,0')).toBe(false); // 2 hexes away > pool of 1
  });

  it('formed units treat a 0-MP front hex as free too', () => {
    const costs = (c: Record<string, number>) => (q: number, r: number) => c[`${q},${r}`] ?? 1;
    const map = computeReachableMap(formedUnit, 2, new Set(), new Set(), costs({ '0,-1': 0, '0,-2': 1 }));
    expect(map.get('0,-1')).toMatchObject({ cost: 0, needsTurn: false });
    expect(map.get('0,-2')?.cost).toBe(1); // 0 + entry 1
  });

  it('allowBeyondBudget includes a too-expensive front hex at its true cost', () => {
    const costs = (c: Record<string, number>) => (q: number, r: number) => c[`${q},${r}`] ?? 1;
    // Default: excluded (cost 5 > pool 2).
    const payable = computeReachableMap(formedUnit, 2, new Set(), new Set(), costs({ '0,-1': 5 }));
    expect(payable.has('0,-1')).toBe(false);
    // allowBeyondBudget: present at its real cost, still hop-bounded.
    const over = computeReachableMap(formedUnit, 2, new Set(), new Set(), costs({ '0,-1': 5, '0,-2': 1 }), true);
    expect(over.get('0,-1')).toMatchObject({ cost: 5, needsTurn: false });
    expect(over.get('0,-2')).toMatchObject({ cost: 6, needsTurn: false }); // 5 + 1, within 2 hops
    expect(over.has('0,-3')).toBe(false); // hop 3 would exceed the 2-hop cap
  });

  it('allowBeyondBudget: hero/loose single high-cost hop is found, reach stays hop-bounded', () => {
    const costs = (c: Record<string, number>) => (q: number, r: number) => c[`${q},${r}`] ?? 1;
    const hero = { ...formedUnit, currentFormation: 'Hero', isHero: true };
    const payable = computeReachableMap(hero, 3, new Set(), new Set(), costs({ '1,0': 5 }));
    expect(payable.has('1,0')).toBe(false); // cost 5 > pool 3: excluded by default
    const over = computeReachableMap(hero, 3, new Set(), new Set(), costs({ '1,0': 5 }), true);
    expect(over.get('1,0')).toMatchObject({ cost: 5, needsTurn: false }); // real 5 MP entry
    expect(over.has('4,0')).toBe(false); // 4 hops would exceed the 3-hop cap
  });

  it('records the cheapest path even when a detour beats a straight expensive line', () => {
    const looseUnit = { ...formedUnit, currentFormation: 'Scattered' };
    // Straight into (1,0) costs 3, but looping through the untouched east face is
    // 1 + 1 + 1 = 3 too; a 5-MP straight wall forces a cheap roundabout.
    const map = computeReachableMap(looseUnit, 8, new Set(), new Set(), costs({ '1,0': 5, '1,-1': 5, '0,-1': 5 }));
    // (2,0) reachable via (1,1)? No — (2,0)'s neighbours include (1,0),(1,1),(2,-1),…
    // So Dijkstra must find the route through the cheap north-east wedge.
    expect(map.get('2,0')?.cost ?? Infinity).toBeLessThanOrEqual(5);
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

  it('cannot enter or pass through broken terrain (painted MP cost > 1)', () => {
    const costs = (c: Record<string, number>) => (q: number, r: number) => c[`${q},${r}`] ?? 1;
    const map = computeChargeReachable({ hex: h(0, 0), facing: 0 }, new Set(), 3, costs({ '0,-1': 2 }));
    expect(map.has('0,-1')).toBe(false); // mud at the front — no entry
    // Only reachable through (0,-1): gone. (1,-1) normal -> the rest of the wedge lives.
    expect(map.has('0,-2')).toBe(false);
    expect(map.has('0,-3')).toBe(false);
    expect(map.get('1,-1')).toBe(1);
    expect(map.get('1,-2')).toBe(2);
    expect(map.get('2,-2')).toBe(2);
  });

  it('still charges across free (0) and normal (1) terrain', () => {
    const costs = (c: Record<string, number>) => (q: number, r: number) => c[`${q},${r}`] ?? 1;
    const map = computeChargeReachable({ hex: h(0, 0), facing: 0 }, new Set(), 3, costs({ '0,-1': 0 }));
    expect(map.get('0,-1')).toBe(1); // free terrain chargeable
    expect(map.get('0,-2')).toBe(2);
  });
});
