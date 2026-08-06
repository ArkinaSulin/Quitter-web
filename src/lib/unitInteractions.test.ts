import { describe, it, expect } from 'vitest';
import { isUnitInteractable } from './unitInteractions';

const base = { isDeleted: false, attachedToUnitId: null, currentUnitHp: 10, isHero: false };

describe('isUnitInteractable', () => {
  it('live units are interactable', () => {
    expect(isUnitInteractable(base)).toBe(true);
  });

  it('an annihilated (dead) non-hero unit is not interactable', () => {
    expect(isUnitInteractable({ ...base, currentUnitHp: 0 })).toBe(false);
  });

  it('a downed hero (HP 0) stays interactable', () => {
    expect(isUnitInteractable({ ...base, currentUnitHp: 0, isHero: true })).toBe(true);
  });

  it('deleted units are never interactable', () => {
    expect(isUnitInteractable({ ...base, isDeleted: true })).toBe(false);
    expect(isUnitInteractable({ ...base, isDeleted: true, currentUnitHp: 0, isHero: true })).toBe(false);
  });

  it('attached units are not hit-testable', () => {
    expect(isUnitInteractable({ ...base, attachedToUnitId: 'host' })).toBe(false);
  });
});
