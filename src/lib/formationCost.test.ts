import { describe, it, expect } from 'vitest';
import { applyFormationChange, isFormationChangeAffordable, getFormationChangeMpCost, nextLowerFormation } from './formationCost';

const budget = (movementPointsAvailable: number, actionsAvailable: number) => ({
  movementPointsAvailable,
  actionsAvailable,
});

describe('getFormationChangeMpCost', () => {
  it('costs 50% of the current effective max, rounded up, floored at 1', () => {
    expect(getFormationChangeMpCost(4)).toBe(2); // Scattered eff 4
    expect(getFormationChangeMpCost(3)).toBe(2); // Open eff 3 -> 1.5 -> 2
    expect(getFormationChangeMpCost(2)).toBe(1); // Close eff 2
    expect(getFormationChangeMpCost(1)).toBe(1); // Phalanx eff 1 -> 0.5 -> 1
    expect(getFormationChangeMpCost(8)).toBe(4);
  });

  it('never costs more than the pool (one action)', () => {
    expect(getFormationChangeMpCost(10)).toBeLessThanOrEqual(10);
    expect(getFormationChangeMpCost(1)).toBeLessThanOrEqual(1);
  });
});

describe('applyFormationChange', () => {
  it('charges a flat % of the old effective max and rescales the leftover', () => {
    // Scattered 4 MP (max 4) -> Open Order (max 3): cost 2, leftover 2 -> 2 * 3/4 = 1.5 -> 1
    expect(applyFormationChange(budget(4, 0), 4, 3)).toEqual({ movementPointsAvailable: 1, actionsAvailable: 0 });
  });

  it('Open Order 3 MP (max 3) -> Close Order (max 2): cost 2, leftover 1 -> 1 * 2/3 = 0.67 -> 0', () => {
    expect(applyFormationChange(budget(3, 0), 3, 2)).toEqual({ movementPointsAvailable: 0, actionsAvailable: 0 });
  });

  it('Close Order 2 MP (max 2) -> Phalanx (max 1): cost 1, leftover 1 -> 1 * 1/2 = 0.5 -> 0', () => {
    expect(applyFormationChange(budget(2, 0), 2, 1)).toEqual({ movementPointsAvailable: 0, actionsAvailable: 0 });
  });

  it('Phalanx 1 MP (max 1) -> Scattered (max 4): cost 1, leftover 0 -> 0', () => {
    expect(applyFormationChange(budget(1, 0), 1, 4)).toEqual({ movementPointsAvailable: 0, actionsAvailable: 0 });
  });

  it('keeps MP integer across a same-max formation change', () => {
    // Open Order (max 3) -> same max, cost 2: (2-2) * 3/3 = 0
    expect(applyFormationChange(budget(2, 0), 3, 3)).toEqual({ movementPointsAvailable: 0, actionsAvailable: 0 });
  });

  it('rescales down when the new formation is slower', () => {
    // Close Order (max 3) -> Phalanx (max 1), cost 2: (3-2) * 1/3 = 0.33 -> 0
    expect(applyFormationChange(budget(3, 0), 3, 1)).toEqual({ movementPointsAvailable: 0, actionsAvailable: 0 });
  });

  it('spends materialized MP first and leaves leftover actions untouched', () => {
    // 4 MP (max 4) covers a 2 MP cost -> 2 MP left, both actions kept.
    expect(applyFormationChange(budget(4, 1), 4, 4)).toEqual({ movementPointsAvailable: 2, actionsAvailable: 1 });
  });

  it('refills from one action when materialized MP is insufficient', () => {
    // 1 MP materialized, 1 action (pool 4), cost 2:
    // spend the 1 leftover, then convert the action to a full pool (4) and spend 1 of it -> 3 left.
    expect(applyFormationChange(budget(1, 1), 4, 4)).toEqual({ movementPointsAvailable: 3, actionsAvailable: 0 });
  });

  it('rescales a freshly-refilled remainder to the new effective max', () => {
    // Open Order (max 3) -> Scattered (max 6), 0 MP + 1 action, cost 2:
    // convert action -> pool 3, spend 2 -> 1 left, rescale 1 * 6/3 = 2.
    expect(applyFormationChange(budget(0, 1), 3, 6)).toEqual({ movementPointsAvailable: 2, actionsAvailable: 0 });
  });

  it('keeps leftover whole pools as actions', () => {
    // 0 MP + 2 actions (pool 4), cost 2 -> 6 MP left (1 whole pool + 2 remainder).
    expect(applyFormationChange(budget(0, 2), 4, 4)).toEqual({ movementPointsAvailable: 2, actionsAvailable: 1 });
  });

  it('never goes negative on MP when the budget covers the cost', () => {
    // 0 MP + 1 action (pool 3), cost 2 -> 1 MP left, rescale 1 * 3/3 = 1.
    expect(applyFormationChange(budget(0, 1), 3, 3)).toEqual({ movementPointsAvailable: 1, actionsAvailable: 0 });
  });

  it('goes negative on actions only when the whole budget is exhausted (soft enforcement)', () => {
    // 1 MP + 0 actions (pool 4), cost 2: over budget -> actions -1, MP stays 3 (fresh-pool remainder).
    expect(applyFormationChange(budget(1, 0), 4, 4)).toEqual({ movementPointsAvailable: 3, actionsAvailable: -1 });
  });

  it('returns the new max when the old effective max is zero', () => {
    expect(applyFormationChange(budget(0, 1), 0, 2)).toEqual({ movementPointsAvailable: 2, actionsAvailable: 1 });
  });
});

describe('isFormationChangeAffordable', () => {
  it('is true when materialized MP covers the cost', () => {
    expect(isFormationChangeAffordable(budget(4, 0), 4)).toBe(true);
  });

  it('is true when an action can refill the shortfall', () => {
    expect(isFormationChangeAffordable(budget(1, 1), 4)).toBe(true);
  });

  it('is false when MP + action pools fall short', () => {
    expect(isFormationChangeAffordable(budget(0, 0), 4)).toBe(false);
    expect(isFormationChangeAffordable(budget(1, 0), 4)).toBe(false);
  });
});

describe('nextLowerFormation', () => {
  it('drops one organization level down the chain', () => {
    expect(nextLowerFormation('Phalanx')).toBe('Close Order');
    expect(nextLowerFormation('Shield Wall')).toBe('Close Order');
    expect(nextLowerFormation('Close Order')).toBe('Open Order');
    expect(nextLowerFormation('Open Order')).toBe('Scattered');
  });

  it('returns null at the floor (Scattered/Routed)', () => {
    expect(nextLowerFormation('Scattered')).toBeNull();
    expect(nextLowerFormation('Routed')).toBeNull();
  });
});
