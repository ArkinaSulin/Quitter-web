import { describe, it, expect } from 'vitest';
import { getShieldPenalty, effectiveAc } from './unitStats';
import { Formation } from '@/types/gameProtocol';

describe('getShieldPenalty', () => {
  it('returns 0 for a unit without a shield', () => {
    expect(getShieldPenalty({ isShielded: false, weaponString: 'Greatsword,5,2d6,false,1,0,0,false,false,false,true,1,true,Dex', activeWeaponIndex: 0, currentFormation: 'Open Order' })).toEqual({ penalty: 0 });
  });

  it('returns 0 for a shielded unit using a one-handed weapon', () => {
    expect(getShieldPenalty({ isShielded: true, weaponString: 'Longsword,5,1d8,false,1,0,0,false,false,false,false,1,true,Dex', activeWeaponIndex: 0, currentFormation: 'Open Order' })).toEqual({ penalty: 0 });
  });

  it('returns 2 (two-handed) for a shielded unit using a two-handed weapon', () => {
    expect(getShieldPenalty({ isShielded: true, weaponString: 'Greatsword,5,2d6,false,1,0,0,false,false,false,true,1,true,Dex', activeWeaponIndex: 0, currentFormation: 'Open Order' })).toEqual({ penalty: 2, reason: 'two-handed' });
  });

  it('uses the active weapon index, not the first weapon', () => {
    const string = 'Longsword,5,1d8,false,1,0,0,false,false,false,false,1,true,Dex;Greatsword,5,2d6,false,1,0,0,false,false,false,true,1,true,Dex';
    expect(getShieldPenalty({ isShielded: true, weaponString: string, activeWeaponIndex: 0, currentFormation: 'Open Order' })).toEqual({ penalty: 0 });
    expect(getShieldPenalty({ isShielded: true, weaponString: string, activeWeaponIndex: 1, currentFormation: 'Open Order' })).toEqual({ penalty: 2, reason: 'two-handed' });
  });

  it('returns 2 (routing) for a shielded unit that is routing regardless of weapon', () => {
    expect(getShieldPenalty({ isShielded: true, weaponString: 'Longsword,5,1d8,false,1,0,0,false,false,false,false,1,true,Dex', activeWeaponIndex: 0, currentFormation: 'Routed' })).toEqual({ penalty: 2, reason: 'routing' });
  });

  it('returns 0 for a routing unit without a shield', () => {
    expect(getShieldPenalty({ isShielded: false, weaponString: 'Longsword,5,1d8,false,1,0,0,false,false,false,false,1,true,Dex', activeWeaponIndex: 0, currentFormation: 'Routed' })).toEqual({ penalty: 0 });
  });

  it('defaults to the first weapon when activeWeaponIndex is missing', () => {
    expect(getShieldPenalty({ isShielded: true, weaponString: 'Greatsword,5,2d6,false,1,0,0,false,false,false,true,1,true,Dex', activeWeaponIndex: undefined as any, currentFormation: 'Open Order' })).toEqual({ penalty: 2, reason: 'two-handed' });
  });
});

describe('effectiveAc', () => {
  const oneHand = 'Longsword,5,1d8,false,1,0,0,false,false,false,false,1,true,Dex';
  const f = (melee_ac_modifier: number, range_ac_modifier = 0) => ({ name: 'X', melee_ac_modifier, range_ac_modifier } as unknown as Formation);
  const unit = (over: Partial<Parameters<typeof effectiveAc>[0]> = {}) => ({
    baselineAc: 16, isShielded: true, weaponString: oneHand, activeWeaponIndex: 0, currentFormation: 'Close Order', isHero: false, ...over,
  });

  it('applies formation AC from the front/flank', () => {
    expect(effectiveAc(unit(), f(2), 'front')).toBe(18);
    expect(effectiveAc(unit(), f(2), 'flank')).toBe(18);
  });

  it('gives NO formation AC from the rear (uniform rule)', () => {
    expect(effectiveAc(unit(), f(2), 'rear')).toBe(16);
  });

  it('keeps the 360 shield at the rear', () => {
    // baseline includes the shield; rear only loses the formation term.
    expect(effectiveAc(unit({ isShielded: true }), f(2), 'rear')).toBe(16);
  });

  it('drops the shield for a two-handed active weapon (every direction)', () => {
    const twoHand = { ...unit(), weaponString: 'Greatsword,5,2d6,false,1,0,0,false,false,false,true,1,true,Dex' };
    expect(effectiveAc(twoHand, f(1), 'front')).toBe(15); // 16 + 1 - 2
    expect(effectiveAc(twoHand, f(1), 'rear')).toBe(14);  // 16 + 0 - 2
  });

  it('treats heroes as all-front (no rear penalty)', () => {
    expect(effectiveAc(unit({ isHero: true }), f(2), 'rear')).toBe(18);
  });

  it('uses range_ac_modifier for ranged attacks (melee vs ranged split)', () => {
    expect(effectiveAc(unit(), f(2, 4), 'front', true)).toBe(20); // 16 + 4
    expect(effectiveAc(unit(), f(2, 4), 'flank', true)).toBe(20);
    expect(effectiveAc(unit(), f(2, 4), 'rear', true)).toBe(16);  // rear loses it
    expect(effectiveAc(unit(), f(2, 4), 'front', false)).toBe(18); // melee uses the melee term
    // range defaults to 0 (data-driven) → no formation term vs ranged
    expect(effectiveAc(unit(), f(2), 'front', true)).toBe(16);
  });
});
