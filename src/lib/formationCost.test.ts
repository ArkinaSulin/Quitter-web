import { describe, it, expect } from 'vitest';
import { applyFormationChange, nextLowerFormation } from './formationCost';

describe('applyFormationChange', () => {
  it('deducts 1 MP per org-level step before rescaling', () => {
    // Scattered 4 MP (max 4) -> Open Order (max 3), 1 step: (4-1) * 3/4 = 2.25 -> 2
    expect(applyFormationChange(4, 1, 4, 3)).toBe(2);
  });

  it('keeps MP integer across a same-max formation change', () => {
    // Open Order (max 3) -> Close Order (max 3), 1 step: (2-1) * 3/3 = 1
    expect(applyFormationChange(2, 1, 3, 3)).toBe(1);
  });

  it('rescales down when the new formation is slower', () => {
    // Close Order (max 3) -> Phalanx (max 1), 1 step: (1-1) * 1/3 = 0
    expect(applyFormationChange(1, 1, 3, 1)).toBe(0);
  });

  it('clamps to the new effective max', () => {
    expect(applyFormationChange(5, 0, 3, 1)).toBe(1);
    expect(applyFormationChange(10, 0, 4, 4)).toBe(4);
  });

  it('never goes negative', () => {
    expect(applyFormationChange(0, 2, 3, 3)).toBe(0);
    expect(applyFormationChange(1, 4, 3, 3)).toBe(0);
  });

  it('floors the fractional remainder', () => {
    // (4-1) * 3/4 = 2.25 -> 2
    expect(applyFormationChange(4, 1, 4, 3)).toBe(2);
    // (5-1) * 2/4 = 2.0 -> 2
    expect(applyFormationChange(5, 1, 4, 2)).toBe(2);
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
