import { describe, it, expect } from 'vitest';
import { parseWeapons, stringifyWeapons, formatWeaponDisplay, isAreaWeapon } from './weaponParser';

describe('parseWeapons', () => {
  it('parses a single weapon from CSV string', () => {
    const result = parseWeapons('Spear,3,1d6+1,1,0,0,false,false,false,false,1');

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      name: 'Spear',
      attackBonus: 3,
      damageDice: '1d6+1',
      range: 1,
      maxRange: 1, // 0 in the string resolves to the weapon's range
      magicRadius: 0,
      reach: false,
      noRetaliation: false,
      freeAction: false,
      isTwoHanded: false,
      numberOfAttacks: 1,
    });
  });

  it('parses multiple weapons separated by semicolons', () => {
    const result = parseWeapons('Spear,3,1d6+1,1,0,0,false,false,false,false,1;Longbow,3,1d8,4,8,0,false,false,false,false,1');

    expect(result).toHaveLength(2);
    expect(result[0].name).toBe('Spear');
    expect(result[1].name).toBe('Longbow');
  });

  it('returns empty array for empty string', () => {
    expect(parseWeapons('')).toEqual([]);
    expect(parseWeapons('   ')).toEqual([]);
  });

  it('parses reach flag correctly', () => {
    const withReach = parseWeapons('Pike,2,1d10,2,4,0,true,false,false,false,1');
    const withoutReach = parseWeapons('Shortsword,3,1d6,1,0,0,false,false,false,false,1');

    expect(withReach[0].reach).toBe(true);
    expect(withoutReach[0].reach).toBe(false);
  });

  it('parses magic radius (area is derived from magicRadius > 0)', () => {
    const result = parseWeapons('Fireball,7,8d6,4,8,2,false,false,false,false,2');

    expect(result[0].magicRadius).toBe(2);
    expect(isAreaWeapon(result[0])).toBe(true);
    expect(isAreaWeapon(parseWeapons('Spear,3,1d6+1,1,0,0,false,false,false,false,1')[0])).toBe(false);
  });

  it('parses maxRange (field 4)', () => {
    const result = parseWeapons('Longbow,3,1d8,4,8,0,false,false,false,false,1');

    expect(result[0].range).toBe(4);
    expect(result[0].maxRange).toBe(8);
  });

  it('resolves a stored 0 maxRange to the weapon range', () => {
    const result = parseWeapons('Longbow,3,1d8,4,0,0,false,false,false,false,1');

    expect(result[0].range).toBe(4);
    expect(result[0].maxRange).toBe(4);
  });

  it('parses noRetaliation and freeAction flags', () => {
    const flagged = parseWeapons('Butt End,2,1d4,1,0,0,false,true,true,false,1');
    const onlyNoRet = parseWeapons('Shield Bash,1,1d4,1,0,0,false,true,false,false,1');

    expect(flagged[0].noRetaliation).toBe(true);
    expect(flagged[0].freeAction).toBe(true);
    expect(onlyNoRet[0].noRetaliation).toBe(true);
    expect(onlyNoRet[0].freeAction).toBe(false);
  });

  it('parses isTwoHanded flag (field 9)', () => {
    const twoHanded = parseWeapons('Greatsword,5,2d6,1,0,0,false,false,false,true,1');
    const oneHanded = parseWeapons('Longsword,5,1d8,1,0,0,false,false,false,false,1');

    expect(twoHanded[0].isTwoHanded).toBe(true);
    expect(oneHanded[0].isTwoHanded).toBe(false);
  });

  it('defaults missing trailing flags for older short strings', () => {
    const old = parseWeapons('Pike,2,1d10,2,4,0,true');

    expect(old[0].reach).toBe(true);
    expect(old[0].noRetaliation).toBe(false);
    expect(old[0].freeAction).toBe(false);
    expect(old[0].isTwoHanded).toBe(false);
    expect(old[0].numberOfAttacks).toBe(1);
  });

  it('parses the 10th field as numberOfAttacks', () => {
    const result = parseWeapons('Flame Blade,5,2d6,1,0,0,false,false,false,false,3');

    expect(result[0].numberOfAttacks).toBe(3);
  });

  it('falls back to defaults for missing fields', () => {
    const result = parseWeapons(',,,,,false,false,false,false,1');

    expect(result[0].name).toBe('Unknown');
    expect(result[0].attackBonus).toBe(0);
    expect(result[0].damageDice).toBe('1d2');
    expect(result[0].range).toBe(1);
    expect(result[0].maxRange).toBe(1);
    expect(result[0].magicRadius).toBe(0);
    expect(result[0].reach).toBe(false);
    expect(result[0].noRetaliation).toBe(false);
    expect(result[0].freeAction).toBe(false);
    expect(result[0].isTwoHanded).toBe(false);
  });
});

describe('stringifyWeapons', () => {
  it('converts a weapon back to CSV string', () => {
    const weapons = [
      { name: 'Spear', attackBonus: 3, damageDice: '1d6+1', range: 1, maxRange: 0, magicRadius: 0, reach: false, noRetaliation: false, freeAction: false, isTwoHanded: false, numberOfAttacks: 1 },
    ];

    expect(stringifyWeapons(weapons)).toBe('Spear,3,1d6+1,1,0,0,false,false,false,false,1');
  });

  it('roundtrips a long-range weapon', () => {
    const weapons = [
      { name: 'Longbow', attackBonus: 3, damageDice: '1d8', range: 4, maxRange: 8, magicRadius: 0, reach: false, noRetaliation: true, freeAction: false, isTwoHanded: false, numberOfAttacks: 1 },
    ];

    expect(stringifyWeapons(weapons)).toBe('Longbow,3,1d8,4,8,0,false,true,false,false,1');
  });

  it('roundtrips isTwoHanded', () => {
    const weapons = [
      { name: 'Greatsword', attackBonus: 5, damageDice: '2d6', range: 1, maxRange: 0, magicRadius: 0, reach: false, noRetaliation: false, freeAction: false, isTwoHanded: true, numberOfAttacks: 1 },
    ];

    expect(stringifyWeapons(weapons)).toBe('Greatsword,5,2d6,1,0,0,false,false,false,true,1');
  });

  it('returns empty string for empty array', () => {
    expect(stringifyWeapons([])).toBe('');
  });

  it('roundtrips: stringify(parse(input)) === input for canonical input', () => {
    const input = 'Spear,3,1d6+1,1,1,0,false,false,false,false,1;Longbow,3,1d8,4,8,0,false,true,false,false,1';
    expect(stringifyWeapons(parseWeapons(input))).toBe(input);
  });
});

describe('formatWeaponDisplay', () => {
  it('formats a melee weapon', () => {
    const weapon = { name: 'Spear', attackBonus: 3, damageDice: '1d6+1', range: 1, maxRange: 0, magicRadius: 0, reach: false, noRetaliation: false, freeAction: false, isTwoHanded: false, numberOfAttacks: 1 };

    expect(formatWeaponDisplay(weapon)).toBe('Spear (+3 atk, 1d6+1, Adjacent)');
  });

  it('formats a ranged weapon with max range', () => {
    const weapon = { name: 'Longbow', attackBonus: 3, damageDice: '1d8', range: 4, maxRange: 8, magicRadius: 0, reach: false, noRetaliation: false, freeAction: false, isTwoHanded: false, numberOfAttacks: 1 };

    expect(formatWeaponDisplay(weapon)).toBe('Longbow (+3 atk, 1d8, 4 hexes)');
  });

  it('formats an area weapon with radius', () => {
    const weapon = { name: 'Fireball', attackBonus: 7, damageDice: '8d6', range: 4, maxRange: 8, magicRadius: 2, reach: false, noRetaliation: false, freeAction: false, isTwoHanded: false, numberOfAttacks: 2 };

    expect(formatWeaponDisplay(weapon)).toBe('Fireball (+7 atk, 8d6, 4 hexes, radius 2, 2 attacks)');
  });

  it('shows attacks when a weapon makes more than one per round', () => {
    const weapon = { name: 'Flame Blade', attackBonus: 5, damageDice: '2d6', range: 1, maxRange: 0, magicRadius: 0, reach: false, noRetaliation: false, freeAction: false, isTwoHanded: false, numberOfAttacks: 3 };

    expect(formatWeaponDisplay(weapon)).toBe('Flame Blade (+5 atk, 2d6, Adjacent, 3 attacks)');
  });
});
