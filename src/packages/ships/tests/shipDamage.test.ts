import { describe, expect, it } from 'vitest';
import {
  isValidShipDamageFormula,
  resolveShipWeaponDamage,
} from '@/packages/ships';

const weapon = (damage: string, damageFormula: string | null) => ({
  damage,
  damageFormula,
});

describe('ship weapon damage formula', () => {
  it('resolves {mass/10}d10 from total mass, rounding the die count up', () => {
    expect(resolveShipWeaponDamage(weapon('', '{mass/10}d10'), 70)).toBe('7d10');
    expect(resolveShipWeaponDamage(weapon('', '{mass/10}d10'), 75)).toBe('8d10');
    expect(resolveShipWeaponDamage(weapon('', '{mass/10}d10'), 5)).toBe('1d10');
  });

  it('uses literal damage when no formula is set', () => {
    expect(resolveShipWeaponDamage(weapon('6d10', null), 70)).toBe('6d10');
  });

  it('accepts only the supported formula syntax', () => {
    expect(isValidShipDamageFormula('')).toBe(true);
    expect(isValidShipDamageFormula('{mass/10}d10')).toBe(true);
    expect(isValidShipDamageFormula('{ mass / 20 } d12')).toBe(true);
    expect(isValidShipDamageFormula('mass/10d10')).toBe(false);
    expect(isValidShipDamageFormula('{mass/10}d')).toBe(false);
  });
});
