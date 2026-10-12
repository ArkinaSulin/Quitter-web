import { describe, it, expect } from 'vitest';
import { defaultAttackWeaponIndex } from '@/packages/combat/lib/weaponChoice';

describe('defaultAttackWeaponIndex', () => {
  it('prefers the active weapon when it can reach', () => {
    expect(defaultAttackWeaponIndex(1, [0, 1, 2])).toBe(1);
    expect(defaultAttackWeaponIndex(2, [2])).toBe(2);
  });

  it('falls back to the first usable weapon when the active one cannot reach', () => {
    expect(defaultAttackWeaponIndex(0, [1, 2])).toBe(1);
    expect(defaultAttackWeaponIndex(3, [0, 2])).toBe(0);
  });

  it('returns the active index when nothing is usable', () => {
    expect(defaultAttackWeaponIndex(2, [])).toBe(2);
  });
});
