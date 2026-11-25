import { describe, expect, it } from 'vitest';
import {
  formatShipAttackDetail,
  formatShipCheckDetail,
  formatShipDamageDetail,
  formatShipMaxTargetDetail,
} from '@/packages/ships';

describe('formatShipAttackDetail', () => {
  it('shows the d20, bonus, and AC', () => {
    expect(formatShipAttackDetail([17], 6, 15)).toBe('{D20+6 vs AC 15: 17}');
  });

  it('shows both dice and the chosen lower roll on disadvantage', () => {
    expect(formatShipAttackDetail([17, 9], 6, 15, true))
      .toBe('{D20+6 vs AC 15 (disadvantage): 17,9 → 9}');
  });
});

describe('formatShipCheckDetail', () => {
  it('rolls against a Difficulty Class, never Armour Class', () => {
    expect(formatShipCheckDetail([7], 6, 15)).toBe('{D20+6 vs DC 15: 7}');
  });

  it('shows negative check bonuses', () => {
    expect(formatShipCheckDetail([18], -1, 16)).toBe('{D20-1 vs DC 16: 18}');
  });
});

describe('formatShipDamageDetail', () => {
  it('shows the total and every die face', () => {
    expect(formatShipDamageDetail('2d10', [9, 7, 7], 23)).toBe('23 damage {2d10: 9,7,7}');
  });

  it('shows a flat total when there are no dice', () => {
    expect(formatShipDamageDetail('1', [], 1)).toBe('1 damage');
  });
});

describe('formatShipMaxTargetDetail', () => {
  it('shows the max-target die and the capped hit count', () => {
    expect(formatShipMaxTargetDetail(3, 2, 2, 5)).toBe('{1d3: 2} → 2 crew hit');
  });

  it('calls out an empty card', () => {
    expect(formatShipMaxTargetDetail(1, 1, 0, 0))
      .toBe('{1d1: 1} → 0 crew hit (no crew available)');
  });
});
