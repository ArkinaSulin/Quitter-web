import { describe, it, expect } from 'vitest';
import { parseWeapons, stringifyWeapons, formatWeaponDisplay } from './weaponParser';

describe('parseWeapons', () => {
  it('parses a single weapon from CSV string', () => {
    const result = parseWeapons('Spear,3,single,1d6+1,1,0,false');

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      name: 'Spear',
      attackBonus: 3,
      targetType: 'single',
      damageDice: '1d6+1',
      range: 1,
      magicRadius: 0,
      reach: false,
    });
  });

  it('parses multiple weapons separated by semicolons', () => {
    const result = parseWeapons('Spear,3,single,1d6+1,1,0,false;Javelin,4,single,1d6,2,0,false');

    expect(result).toHaveLength(2);
    expect(result[0].name).toBe('Spear');
    expect(result[1].name).toBe('Javelin');
  });

  it('returns empty array for empty string', () => {
    expect(parseWeapons('')).toEqual([]);
    expect(parseWeapons('   ')).toEqual([]);
  });

  it('parses reach flag correctly', () => {
    const withReach = parseWeapons('Pike,2,single,1d10,2,0,true');
    const withoutReach = parseWeapons('Shortsword,3,single,1d6,1,0,false');

    expect(withReach[0].reach).toBe(true);
    expect(withoutReach[0].reach).toBe(false);
  });

  it('parses area target type', () => {
    const result = parseWeapons('Fireball,7,area,8d6,4,2,false');

    expect(result[0].targetType).toBe('area');
    expect(result[0].magicRadius).toBe(2);
  });

  it('falls back to defaults for missing fields', () => {
    const result = parseWeapons(',,,,,');

    expect(result[0].name).toBe('Unknown');
    expect(result[0].attackBonus).toBe(0);
    expect(result[0].targetType).toBe('single');
    expect(result[0].damageDice).toBe('1d2');
    expect(result[0].range).toBe(1);
    expect(result[0].magicRadius).toBe(0);
    expect(result[0].reach).toBe(false);
  });
});

describe('stringifyWeapons', () => {
  it('converts a weapon back to CSV string', () => {
    const weapons = [
      { name: 'Spear', attackBonus: 3, targetType: 'single' as const, damageDice: '1d6+1', range: 1, magicRadius: 0, reach: false },
    ];

    expect(stringifyWeapons(weapons)).toBe('Spear,3,single,1d6+1,1,0,false');
  });

  it('returns empty string for empty array', () => {
    expect(stringifyWeapons([])).toBe('');
  });

  it('roundtrips: stringify(parse(input)) === input for canonical input', () => {
    const input = 'Spear,3,single,1d6+1,1,0,false;Pike,2,single,1d10,2,0,true';
    expect(stringifyWeapons(parseWeapons(input))).toBe(input);
  });
});

describe('formatWeaponDisplay', () => {
  it('formats a melee weapon', () => {
    const weapon = { name: 'Spear', attackBonus: 3, targetType: 'single' as const, damageDice: '1d6+1', range: 1, magicRadius: 0, reach: false };

    expect(formatWeaponDisplay(weapon)).toBe('Spear (+3 atk, 1d6+1, Adjacent)');
  });

  it('formats a ranged weapon', () => {
    const weapon = { name: 'Javelin', attackBonus: 4, targetType: 'single' as const, damageDice: '1d6', range: 2, magicRadius: 0, reach: false };

    expect(formatWeaponDisplay(weapon)).toBe('Javelin (+4 atk, 1d6, 2 hexes)');
  });

  it('formats an area weapon with radius', () => {
    const weapon = { name: 'Fireball', attackBonus: 7, targetType: 'area' as const, damageDice: '8d6', range: 4, magicRadius: 2, reach: false };

    expect(formatWeaponDisplay(weapon)).toBe('Fireball (+7 atk, 8d6, 4 hexes, radius 2)');
  });
});
