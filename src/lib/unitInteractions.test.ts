import { describe, it, expect } from 'vitest';
import { isUnitInteractable, isProtectedHero } from './unitInteractions';

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

describe('isProtectedHero', () => {
  it('a hero attached at the back is protected', () => {
    expect(isProtectedHero({ isHero: true, attachedToUnitId: 'host', attachedPosition: 'back' })).toBe(true);
  });

  it('a front-attached hero is NOT protected (fights openly)', () => {
    expect(isProtectedHero({ isHero: true, attachedToUnitId: 'host', attachedPosition: 'front' })).toBe(false);
  });

  it('an unattached hero is not protected', () => {
    expect(isProtectedHero({ isHero: true, attachedToUnitId: null, attachedPosition: null })).toBe(false);
  });

  it('a regular unit (even behind another) is not a protected hero', () => {
    expect(isProtectedHero({ isHero: false, attachedToUnitId: 'host', attachedPosition: 'back' })).toBe(false);
  });
});
