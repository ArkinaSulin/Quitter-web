import { describe, it, expect } from 'vitest';
import { getShieldPenalty } from './unitStats';

describe('getShieldPenalty', () => {
  it('returns 0 for a unit without a shield', () => {
    expect(getShieldPenalty({ isShielded: false, weaponString: 'Greatsword,5,2d6,false,1,0,0,false,false,false,true,1,true,Dex', activeWeaponIndex: 0, isRouting: false })).toEqual({ penalty: 0 });
  });

  it('returns 0 for a shielded unit using a one-handed weapon', () => {
    expect(getShieldPenalty({ isShielded: true, weaponString: 'Longsword,5,1d8,false,1,0,0,false,false,false,false,1,true,Dex', activeWeaponIndex: 0, isRouting: false })).toEqual({ penalty: 0 });
  });

  it('returns 2 (two-handed) for a shielded unit using a two-handed weapon', () => {
    expect(getShieldPenalty({ isShielded: true, weaponString: 'Greatsword,5,2d6,false,1,0,0,false,false,false,true,1,true,Dex', activeWeaponIndex: 0, isRouting: false })).toEqual({ penalty: 2, reason: 'two-handed' });
  });

  it('uses the active weapon index, not the first weapon', () => {
    const string = 'Longsword,5,1d8,false,1,0,0,false,false,false,false,1,true,Dex;Greatsword,5,2d6,false,1,0,0,false,false,false,true,1,true,Dex';
    expect(getShieldPenalty({ isShielded: true, weaponString: string, activeWeaponIndex: 0, isRouting: false })).toEqual({ penalty: 0 });
    expect(getShieldPenalty({ isShielded: true, weaponString: string, activeWeaponIndex: 1, isRouting: false })).toEqual({ penalty: 2, reason: 'two-handed' });
  });

  it('returns 2 (routing) for a shielded unit that is routing regardless of weapon', () => {
    expect(getShieldPenalty({ isShielded: true, weaponString: 'Longsword,5,1d8,false,1,0,0,false,false,false,false,1,true,Dex', activeWeaponIndex: 0, isRouting: true })).toEqual({ penalty: 2, reason: 'routing' });
  });

  it('returns 0 for a routing unit without a shield', () => {
    expect(getShieldPenalty({ isShielded: false, weaponString: 'Longsword,5,1d8,false,1,0,0,false,false,false,false,1,true,Dex', activeWeaponIndex: 0, isRouting: true })).toEqual({ penalty: 0 });
  });

  it('defaults to the first weapon when activeWeaponIndex is missing', () => {
    expect(getShieldPenalty({ isShielded: true, weaponString: 'Greatsword,5,2d6,false,1,0,0,false,false,false,true,1,true,Dex', activeWeaponIndex: undefined as any, isRouting: false })).toEqual({ penalty: 2, reason: 'two-handed' });
  });
});
