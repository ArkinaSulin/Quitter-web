import { describe, it, expect } from 'vitest';
import { applyFormationChange, isFormationChangeAffordable, nextLowerFormation } from './formationCost';

const budget = (movementPointsAvailable: number, actionsAvailable: number) => ({
  movementPointsAvailable,
  actionsAvailable,
});

describe('applyFormationChange', () => {
  it('deducts 2 MP per org-level step before rescaling', () => {
    // Scattered 4 MP (max 4) -> Open Order (max 3), 1 step: (4-2) * 3/4 = 1.5 -> 1
    expect(applyFormationChange(budget(4, 0), 1, 4, 3)).toEqual({ movementPointsAvailable: 1, actionsAvailable: 0 });
  });

  it('keeps MP integer across a same-max formation change', () => {
    // Open Order (max 3) -> Close Order (max 3), 1 step: (2-2) * 3/3 = 0
    expect(applyFormationChange(budget(2, 0), 1, 3, 3)).toEqual({ movementPointsAvailable: 0, actionsAvailable: 0 });
  });

  it('rescales down when the new formation is slower', () => {
    // Close Order (max 3) -> Phalanx (max 1), 1 step: (3-2) * 1/3 = 0.33 -> 0
    expect(applyFormationChange(budget(3, 0), 1, 3, 1)).toEqual({ movementPointsAvailable: 0, actionsAvailable: 0 });
  });

  it('spends materialized MP first and leaves leftover actions untouched', () => {
    // 4 MP (max 4) covers a 2 MP cost -> 2 MP left, both actions kept.
    expect(applyFormationChange(budget(4, 1), 1, 4, 4)).toEqual({ movementPointsAvailable: 2, actionsAvailable: 1 });
  });

  it('refills from one action when materialized MP is insufficient', () => {
    // 1 MP materialized, 1 action (pool 4), 1 step = 2 MP:
    // spend the 1 leftover, then convert the action to a full pool (4) and spend 1 of it -> 3 left.
    expect(applyFormationChange(budget(1, 1), 1, 4, 4)).toEqual({ movementPointsAvailable: 3, actionsAvailable: 0 });
  });

  it('rescales a freshly-refilled remainder to the new effective max', () => {
    // Open Order (max 3) -> Scattered (max 6), 0 MP + 1 action, 1 step = 2 MP:
    // convert action -> pool 3, spend 2 -> 1 left, rescale 1 * 6/3 = 2.
    expect(applyFormationChange(budget(0, 1), 1, 3, 6)).toEqual({ movementPointsAvailable: 2, actionsAvailable: 0 });
  });

  it('keeps leftover whole pools as actions', () => {
    // 0 MP + 2 actions (pool 4), 2 steps = 4 MP -> 4 MP left (exactly 1 whole pool -> 1 action, 0 MP remainder).
    expect(applyFormationChange(budget(0, 2), 2, 4, 4)).toEqual({ movementPointsAvailable: 0, actionsAvailable: 1 });
  });

  it('never goes negative on MP when the budget covers the cost', () => {
    // 0 MP + 2 actions (pool 3), 3 steps = 6 MP -> exactly consumed.
    expect(applyFormationChange(budget(0, 2), 3, 3, 3)).toEqual({ movementPointsAvailable: 0, actionsAvailable: 0 });
  });

  it('goes negative on actions only when the whole budget is exhausted (soft enforcement)', () => {
    // 1 MP + 0 actions (pool 4), 2 steps = 4 MP: over budget -> actions -1, MP stays 1 (fresh-pool remainder).
    expect(applyFormationChange(budget(1, 0), 2, 4, 4)).toEqual({ movementPointsAvailable: 1, actionsAvailable: -1 });
  });

  it('floors the fractional remainder', () => {
    // (4-2) * 3/4 = 1.5 -> 1
    expect(applyFormationChange(budget(4, 0), 1, 4, 3)).toEqual({ movementPointsAvailable: 1, actionsAvailable: 0 });
  });
});

describe('isFormationChangeAffordable', () => {
  it('is true when materialized MP covers the cost', () => {
    expect(isFormationChangeAffordable(budget(4, 0), 1, 4)).toBe(true);
  });

  it('is true when an action can refill the shortfall', () => {
    expect(isFormationChangeAffordable(budget(1, 1), 1, 4)).toBe(true);
  });

  it('is false when MP + action pools fall short', () => {
    expect(isFormationChangeAffordable(budget(0, 0), 1, 4)).toBe(false);
    expect(isFormationChangeAffordable(budget(1, 0), 2, 4)).toBe(false);
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
