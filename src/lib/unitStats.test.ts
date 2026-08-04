import { describe, it, expect } from 'vitest';
import { getShieldPenalty } from './unitStats';

describe('getShieldPenalty', () => {
  it('returns 0 for a unit without a shield', () => {
    expect(getShieldPenalty({ isShielded: false, weaponString: 'Greatsword,5,single,2d6,1,0,false,false,false,false,true', activeWeaponIndex: 0 })).toBe(0);
  });

  it('returns 0 for a shielded unit using a one-handed weapon', () => {
    expect(getShieldPenalty({ isShielded: true, weaponString: 'Longsword,5,single,1d8,1,0,false,false,false,false,false', activeWeaponIndex: 0 })).toBe(0);
  });

  it('returns 2 for a shielded unit using a two-handed weapon', () => {
    expect(getShieldPenalty({ isShielded: true, weaponString: 'Greatsword,5,single,2d6,1,0,false,false,false,false,true', activeWeaponIndex: 0 })).toBe(2);
  });

  it('uses the active weapon index, not the first weapon', () => {
    const string = 'Longsword,5,single,1d8,1,0,false,false,false,false,false;Greatsword,5,single,2d6,1,0,false,false,false,false,true';
    expect(getShieldPenalty({ isShielded: true, weaponString: string, activeWeaponIndex: 0 })).toBe(0);
    expect(getShieldPenalty({ isShielded: true, weaponString: string, activeWeaponIndex: 1 })).toBe(2);
  });

  it('defaults to the first weapon when activeWeaponIndex is missing', () => {
    expect(getShieldPenalty({ isShielded: true, weaponString: 'Greatsword,5,single,2d6,1,0,false,false,false,false,true', activeWeaponIndex: undefined as any })).toBe(2);
  });
});
