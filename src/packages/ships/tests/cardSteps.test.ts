import { describe, expect, it } from 'vitest';
import {
  canSpendCardStep,
  cardStepsRemaining,
  cardStepsUsed,
  cardStepUsedInStep,
  SHIP_CARD_STEPS_PER_TURN,
  spendCardSteps,
} from '@/packages/ships';

describe('cardSteps', () => {
  it('resets when the turn changes', () => {
    const state = { 'component:sail': { turn: 2, step: 1, stepsUsed: 3 } };
    expect(cardStepsUsed(state, 'component:sail', 2)).toBe(3);
    expect(cardStepsUsed(state, 'component:sail', 3)).toBe(0);
  });

  it('keeps the turn total across wildspace steps', () => {
    const state = { 'component:sail': { turn: 2, step: 1, stepsUsed: 3 } };
    expect(cardStepsUsed(state, 'component:sail', 2)).toBe(3);
    expect(cardStepsRemaining(state, 'component:sail', 2)).toBe(2);
    expect(cardStepUsedInStep(state, 'component:sail', 2, 1, 'wildspace')).toBe(true);
    expect(cardStepUsedInStep(state, 'component:sail', 2, 2, 'wildspace')).toBe(false);
  });

  it('blocks a second wildspace use in the same step but not the next step', () => {
    const state = spendCardSteps({}, 'component:sail', 2, 1, 'wildspace');
    expect(canSpendCardStep(state, 'component:sail', 2, 1, 'wildspace')).toBe(false);
    expect(canSpendCardStep(state, 'component:sail', 2, 2, 'wildspace')).toBe(true);
  });

  it('in atmosphere allows all five within the turn', () => {
    let state = {};
    for (let i = 0; i < 5; i += 1) {
      expect(canSpendCardStep(state, 'component:sail', 2, 1, 'atmosphere')).toBe(true);
      state = spendCardSteps(state, 'component:sail', 2, 1, 'atmosphere');
    }
    expect(cardStepsUsed(state, 'component:sail', 2)).toBe(SHIP_CARD_STEPS_PER_TURN);
    expect(canSpendCardStep(state, 'component:sail', 2, 1, 'atmosphere')).toBe(false);
  });

  it('spends multiple steps at once for an atmosphere auto-load batch', () => {
    const state = spendCardSteps({}, 'weapon:w1:0', 1, 1, 'atmosphere', 3);
    expect(cardStepsUsed(state, 'weapon:w1:0', 1)).toBe(3);
  });
});
