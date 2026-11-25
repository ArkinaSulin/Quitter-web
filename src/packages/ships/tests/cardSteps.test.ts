import { describe, expect, it } from 'vitest';
import {
  canSpendCardStep,
  cardCommandBonus,
  cardStepsRemaining,
  cardStepsUsed,
  cardStepUsedInStep,
  clearCardCommandBonus,
  clearCommandBonuses,
  normalizeCardStepState,
  setCardCommandBonus,
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

describe('card command bonus', () => {
  it('stores one pending Int captaincy bonus on a card', () => {
    const state = setCardCommandBonus({}, 'weapon:1:0', 3, 2, 4);
    expect(cardCommandBonus(state, 'weapon:1:0', 3)).toBe(4);
    expect(cardCommandBonus(state, 'weapon:1:0', 4)).toBeUndefined();
  });

  it('keeps negative bonuses (Int + PB − 5 may be below zero)', () => {
    const state = setCardCommandBonus({}, 'sail', 1, 1, -2);
    expect(cardCommandBonus(state, 'sail', 1)).toBe(-2);
  });

  it('clears the pending bonus when the card rolls', () => {
    const withBonus = setCardCommandBonus({}, 'helm', 2, 1, 3);
    const cleared = clearCardCommandBonus(withBonus, 'helm', 2);
    expect(cardCommandBonus(cleared, 'helm', 2)).toBeUndefined();
  });

  it('preserves a pending bonus when another card step is spent', () => {
    const withBonus = setCardCommandBonus({}, 'sail', 2, 1, 2);
    const spent = spendCardSteps(withBonus, 'sail', 2, 2, 'wildspace');
    expect(cardCommandBonus(spent, 'sail', 2)).toBe(2);
    expect(cardStepsUsed(spent, 'sail', 2)).toBe(1);
  });

  it('drops every pending bonus at end of turn', () => {
    const state = {
      ...setCardCommandBonus({}, 'sail', 2, 1, 3),
      ...setCardCommandBonus({}, 'hull', 2, 1, -1),
    };
    const cleared = clearCommandBonuses(state);
    expect(cardCommandBonus(cleared, 'sail', 2)).toBeUndefined();
    expect(cardCommandBonus(cleared, 'hull', 2)).toBeUndefined();
  });

  it('round-trips through the stored card-state sanitiser', () => {
    const normalized = normalizeCardStepState({
      sail: { turn: 2, step: 1, stepsUsed: 1, commandBonus: 4 },
    });
    expect(cardCommandBonus(normalized, 'sail', 2)).toBe(4);
    expect(cardStepsUsed(normalized, 'sail', 1)).toBe(0);
    expect(cardStepsUsed(normalized, 'sail', 2)).toBe(1);
  });
});
