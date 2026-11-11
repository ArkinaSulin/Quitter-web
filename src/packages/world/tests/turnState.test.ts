import { describe, it, expect } from 'vitest';
import { ALLIANCE_ORDER, getActiveGroups, advanceTurn, advanceShipStep } from '@/packages/world/lib/turnState';

describe('getActiveGroups', () => {
  it('returns friendly only when no teams are assigned to other groups', () => {
    const alliances = { blue: 'friendly', yellow: 'friendly', black: 'friendly' } as const;
    expect(getActiveGroups(alliances)).toEqual(['friendly']);
  });

  it('preserves canonical order friendly, enemy, neutral', () => {
    const alliances = {
      blue: 'neutral',
      yellow: 'friendly',
      black: 'enemy',
      green: 'enemy',
    } as const;
    expect(getActiveGroups(alliances)).toEqual(['friendly', 'enemy', 'neutral']);
  });

  it('includes all three groups when present', () => {
    const alliances = {
      blue: 'friendly',
      yellow: 'enemy',
      violet: 'neutral',
    } as const;
    expect(getActiveGroups(alliances)).toEqual(ALLIANCE_ORDER);
  });
});

describe('advanceTurn', () => {
  it('starts at the first active group from free play (null)', () => {
    expect(advanceTurn(null, ['friendly', 'enemy'])).toEqual({ next: 'friendly', wrapped: false });
  });

  it('advances friendly -> enemy without wrapping', () => {
    expect(advanceTurn('friendly', ['friendly', 'enemy', 'neutral'])).toEqual({ next: 'enemy', wrapped: false });
  });

  it('advances enemy -> neutral without wrapping', () => {
    expect(advanceTurn('enemy', ['friendly', 'enemy', 'neutral'])).toEqual({ next: 'neutral', wrapped: false });
  });

  it('wraps neutral -> friendly and reports full cycle', () => {
    expect(advanceTurn('neutral', ['friendly', 'enemy', 'neutral'])).toEqual({ next: 'friendly', wrapped: true });
  });

  it('skips empty groups (friendly -> neutral when enemy absent)', () => {
    expect(advanceTurn('friendly', ['friendly', 'neutral'])).toEqual({ next: 'neutral', wrapped: false });
    expect(advanceTurn('neutral', ['friendly', 'neutral'])).toEqual({ next: 'friendly', wrapped: true });
  });

  it('wraps a single-group cycle on every advance', () => {
    expect(advanceTurn('friendly', ['friendly'])).toEqual({ next: 'friendly', wrapped: true });
  });

  it('falls back to the full order when no groups are active', () => {
    expect(advanceTurn(null, [])).toEqual({ next: 'friendly', wrapped: false });
  });

  it('treats an unknown current group as free play', () => {
    expect(advanceTurn('enemy' as any, ['friendly'])).toEqual({ next: 'friendly', wrapped: false });
  });
});

describe('advanceShipStep (wildspace)', () => {
  it('starts at step 1 when leaving free play', () => {
    expect(advanceShipStep(3, false, true)).toEqual({ step: 1, wrapped: false });
  });

  it('stays on the same step inside an alliance cycle', () => {
    expect(advanceShipStep(2, false, false)).toEqual({ step: 2, wrapped: false });
  });

  it('advances the step when the alliance cycle wraps', () => {
    expect(advanceShipStep(2, true, false)).toEqual({ step: 3, wrapped: false });
  });

  it('wraps step 5 -> 1 and completes the round', () => {
    expect(advanceShipStep(5, true, false)).toEqual({ step: 1, wrapped: true });
  });

  it('clamps an out-of-range step', () => {
    expect(advanceShipStep(9, false, false)).toEqual({ step: 5, wrapped: false });
    expect(advanceShipStep(0, false, false)).toEqual({ step: 1, wrapped: false });
  });
});
