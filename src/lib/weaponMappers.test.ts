import { describe, it, expect } from 'vitest';
import { mapWeaponRow, mapWeaponToRow, LibraryWeapon } from './weaponMappers';
import { validateWeapon, blankWeapon, isValidDamageDice } from './weaponParser';

describe('weaponMappers', () => {
  it('maps a row with sane defaults', () => {
    const w = mapWeaponRow({
      id: 'w1', name: 'Longsword', damage_dice: '1d8', attack_bonus: 2,
      range: 1, max_range: 0, magic_dimension: 0, shape: 'circle',
      saving_throw: 'Dex', cost_gp: 15, notes: 'sharp',
    });
    expect(w.id).toBe('w1');
    expect(w.name).toBe('Longsword');
    expect(w.damageDice).toBe('1d8');
    expect(w.attackBonus).toBe(2);
    expect(w.range).toBe(1);
    expect(w.numberOfAttacks).toBe(1);
    expect(w.onSaveHalfOrNeg).toBe(true);
    expect(w.savingThrow).toBe('Dex');
    expect(w.costGp).toBe(15);
    expect(w.notes).toBe('sharp');
  });

  it('falls back for bad shape/save and missing numbers', () => {
    const w = mapWeaponRow({ id: 'w2', name: 'X', shape: 'blob', saving_throw: 'Luck' });
    expect(w.shape).toBe('circle');
    expect(w.savingThrow).toBe('Dex');
    expect(w.range).toBe(1);
    expect(w.costGp).toBe(0);
  });

  it('mapWeaponToRow clamps ranges/attacks and trims', () => {
    const w: LibraryWeapon = {
      ...blankWeapon(), id: '', notes: 'n', costGp: 3,
      name: '  Axe  ', damageDice: ' 1d6 ', range: 0, maxRange: 0, numberOfAttacks: 0,
    };
    const row = mapWeaponToRow(w);
    expect(row.name).toBe('Axe');
    expect(row.damage_dice).toBe('1d6');
    expect(row.range).toBe(1);
    expect(row.max_range).toBe(1);
    expect(row.number_of_attacks).toBe(1);
    expect(row.cost_gp).toBe(3);
  });
});

describe('weapon validation', () => {
  it('accepts a blank weapon dice default', () => {
    expect(isValidDamageDice('1d6')).toBe(true);
    expect(isValidDamageDice('2d6+2')).toBe(true);
    expect(isValidDamageDice('1d4+2d6')).toBe(true);
    expect(isValidDamageDice('nope')).toBe(false);
  });

  it('requires a name and valid dice', () => {
    expect(validateWeapon(blankWeapon())).toMatch(/name/i);
    expect(validateWeapon({ ...blankWeapon(), name: 'Bow', damageDice: 'x' })).toMatch(/dice/i);
    expect(validateWeapon({ ...blankWeapon(), name: 'Bow', damageDice: '1d8' })).toBeNull();
  });
});
