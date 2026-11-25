import { describe, expect, it } from 'vitest';
import {
  ramDamageDice,
  resolveShipWeaponDamage,
} from '@/packages/ships';

describe('ship weapon damage', () => {
  it('uses the authored Damage field', () => {
    expect(resolveShipWeaponDamage({ damage: '6d10' })).toBe('6d10');
    expect(resolveShipWeaponDamage({ damage: '' })).toBe('—');
  });
});

describe('ram damage dice', () => {
  it('rolls floor(effective mass / 10) dice with distance faces', () => {
    expect(ramDamageDice(40, 6)).toEqual({ count: 4, faces: 6, dice: '4d6' });
    expect(ramDamageDice(75, 3).dice).toBe('7d3');
  });

  it('clamps dice count to 1–16 and faces to 1–12', () => {
    expect(ramDamageDice(4, 0)).toEqual({ count: 1, faces: 1, dice: '1d1' });
    expect(ramDamageDice(500, 30)).toEqual({ count: 16, faces: 12, dice: '16d12' });
  });
});
