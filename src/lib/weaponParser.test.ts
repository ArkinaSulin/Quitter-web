import { describe, it, expect } from 'vitest';
import { parseWeapons, stringifyWeapons, formatWeaponDisplay, isAreaWeapon, isOffensiveWeapon, Weapon } from './weaponParser';

describe('parseWeapons', () => {
  it('parses a single weapon from CSV string', () => {
    const result = parseWeapons('Spear,3,1d6+1,false,1,0,0,false,false,false,false,1,true,Dex,circle');

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      name: 'Spear',
      attackBonus: 3,
      damageDice: '1d6+1',
      isHealing: false,
      range: 1,
      maxRange: 1, // 0 in the string resolves to the weapon's range
      magicDimension: 0,
      shape: 'circle', reach: false,
      noRetaliation: false,
      freeAction: false,
      isTwoHanded: false,
      numberOfAttacks: 1,
      onSaveHalfOrNeg: true,
      savingThrow: 'Dex',
    });
  });

  it('parses multiple weapons separated by semicolons', () => {
    const result = parseWeapons('Spear,3,1d6+1,false,1,0,0,false,false,false,false,1,true,Dex;Longbow,3,1d8,false,4,8,0,false,false,false,false,1,true,Dex,circle');

    expect(result).toHaveLength(2);
    expect(result[0].name).toBe('Spear');
    expect(result[1].name).toBe('Longbow');
  });

  it('returns empty array for empty string', () => {
    expect(parseWeapons('')).toEqual([]);
    expect(parseWeapons('   ')).toEqual([]);
  });

  it('parses reach flag correctly', () => {
    const withReach = parseWeapons('Pike,2,1d10,false,2,4,0,true,false,false,false,1');
    const withoutReach = parseWeapons('Shortsword,3,1d6,false,1,0,0,false,false,false,false,1');

    expect(withReach[0].reach).toBe(true);
    expect(withoutReach[0].reach).toBe(false);
  });

  it('parses magic radius (area is derived from magicDimension > 0)', () => {
    const result = parseWeapons('Fireball,7,8d6,false,4,8,2,false,false,false,false,2');

    expect(result[0].magicDimension).toBe(2);
    expect(isAreaWeapon(result[0])).toBe(true);
    expect(isAreaWeapon(parseWeapons('Spear,3,1d6+1,false,1,0,0,false,false,false,false,1')[0])).toBe(false);
  });

  it('isOffensiveWeapon = !isHealing', () => {
    expect(isOffensiveWeapon({ isHealing: false })).toBe(true);
    expect(isOffensiveWeapon({ isHealing: true })).toBe(false);
    expect(isOffensiveWeapon(parseWeapons('Sword,3,1d8,false,1,1,0,false,false,false,false,1')[0])).toBe(true);
    expect(isOffensiveWeapon(parseWeapons('Healing Touch,0,2d6,true,1,1,0,false,false,false,false,1')[0])).toBe(false);
  });

  it('parses maxRange (field 5)', () => {
    const result = parseWeapons('Longbow,3,1d8,false,4,8,0,false,false,false,false,1');

    expect(result[0].range).toBe(4);
    expect(result[0].maxRange).toBe(8);
  });

  it('resolves a stored 0 maxRange to the weapon range', () => {
    const result = parseWeapons('Longbow,3,1d8,false,4,0,0,false,false,false,false,1');

    expect(result[0].range).toBe(4);
    expect(result[0].maxRange).toBe(4);
  });

  it('parses noRetaliation and freeAction flags', () => {
    const flagged = parseWeapons('Butt End,2,1d4,false,1,0,0,false,true,true,false,1');
    const onlyNoRet = parseWeapons('Shield Bash,1,1d4,false,1,0,0,false,true,false,false,1');

    expect(flagged[0].noRetaliation).toBe(true);
    expect(flagged[0].freeAction).toBe(true);
    expect(onlyNoRet[0].noRetaliation).toBe(true);
    expect(onlyNoRet[0].freeAction).toBe(false);
  });

  it('parses isTwoHanded flag (field 10)', () => {
    const twoHanded = parseWeapons('Greatsword,5,2d6,false,1,0,0,false,false,false,true,1');
    const oneHanded = parseWeapons('Longsword,5,1d8,false,1,0,0,false,false,false,false,1');

    expect(twoHanded[0].isTwoHanded).toBe(true);
    expect(oneHanded[0].isTwoHanded).toBe(false);
  });

  it('defaults missing trailing flags for older short strings', () => {
    const old = parseWeapons('Pike,2,1d10,false,2,4,0,true');

    expect(old[0].reach).toBe(true);
    expect(old[0].noRetaliation).toBe(false);
    expect(old[0].freeAction).toBe(false);
    expect(old[0].isTwoHanded).toBe(false);
    expect(old[0].numberOfAttacks).toBe(1);
    expect(old[0].isHealing).toBe(false);
    expect(old[0].onSaveHalfOrNeg).toBe(true);
    expect(old[0].savingThrow).toBe('Dex');
  });

  it('parses the 11th field as numberOfAttacks', () => {
    const result = parseWeapons('Flame Blade,5,2d6,false,1,0,0,false,false,false,false,3');

    expect(result[0].numberOfAttacks).toBe(3);
  });

  it('parses isHealing (field 3)', () => {
    const heal = parseWeapons('Cure Wounds,5,1d8,true,1,0,0,false,false,false,false,1,true,Dex,circle');
    const damage = parseWeapons('Longsword,5,1d8,false,1,0,0,false,false,false,false,1,true,Dex,circle');

    expect(heal[0].isHealing).toBe(true);
    expect(damage[0].isHealing).toBe(false);
  });

  it('parses onSaveHalfOrNeg and savingThrow (fields 12-13)', () => {
    const halfDex = parseWeapons('Fireball,7,8d6,false,4,8,2,false,false,false,false,2,true,Dex,circle');
    const negateCon = parseWeapons('Cone of Cold,7,8d8,false,4,8,2,false,false,false,false,2,false,Con,circle');

    expect(halfDex[0].onSaveHalfOrNeg).toBe(true);
    expect(halfDex[0].savingThrow).toBe('Dex');
    expect(negateCon[0].onSaveHalfOrNeg).toBe(false);
    expect(negateCon[0].savingThrow).toBe('Con');
  });

  it('parses the area shape (field 14), defaulting to circle', () => {
    const circle = parseWeapons('Fireball,7,8d6,false,4,8,2,false,false,false,false,2,true,Dex');
    const cube = parseWeapons('Web,5,2d6,false,4,8,2,false,false,false,false,1,true,Dex,cube');
    const cone = parseWeapons('Cone of Cold,7,8d8,false,4,8,2,false,false,false,false,2,false,Con,cone');

    expect(circle[0].shape).toBe('circle');
    expect(cube[0].shape).toBe('cube');
    expect(cone[0].shape).toBe('cone');
  });

  it('falls back to defaults for missing fields', () => {
    const result = parseWeapons(',,,,,false,false,false,false,1');

    expect(result[0].name).toBe('Unknown');
    expect(result[0].attackBonus).toBe(0);
    expect(result[0].damageDice).toBe('1d2');
    expect(result[0].isHealing).toBe(false);
    expect(result[0].range).toBe(1);
    expect(result[0].maxRange).toBe(1);
    expect(result[0].magicDimension).toBe(0);
    expect(result[0].reach).toBe(false);
    expect(result[0].noRetaliation).toBe(false);
    expect(result[0].freeAction).toBe(false);
    expect(result[0].isTwoHanded).toBe(false);
  });
});

describe('stringifyWeapons', () => {
  it('converts a weapon back to CSV string', () => {
    const weapons: Weapon[] = [
      { name: 'Spear', attackBonus: 3, damageDice: '1d6+1', isHealing: false, range: 1, maxRange: 0, magicDimension: 0, shape: 'circle', reach: false, noRetaliation: false, freeAction: false, isTwoHanded: false, numberOfAttacks: 1, onSaveHalfOrNeg: true, savingThrow: 'Dex' },
    ];

    expect(stringifyWeapons(weapons)).toBe('Spear,3,1d6+1,false,1,0,0,false,false,false,false,1,true,Dex,circle');
  });

  it('roundtrips a long-range weapon', () => {
    const weapons: Weapon[] = [
      { name: 'Longbow', attackBonus: 3, damageDice: '1d8', isHealing: false, range: 4, maxRange: 8, magicDimension: 0, shape: 'circle', reach: false, noRetaliation: true, freeAction: false, isTwoHanded: false, numberOfAttacks: 1, onSaveHalfOrNeg: true, savingThrow: 'Dex' },
    ];

    expect(stringifyWeapons(weapons)).toBe('Longbow,3,1d8,false,4,8,0,false,true,false,false,1,true,Dex,circle');
  });

  it('roundtrips isTwoHanded', () => {
    const weapons: Weapon[] = [
      { name: 'Greatsword', attackBonus: 5, damageDice: '2d6', isHealing: false, range: 1, maxRange: 0, magicDimension: 0, shape: 'circle', reach: false, noRetaliation: false, freeAction: false, isTwoHanded: true, numberOfAttacks: 1, onSaveHalfOrNeg: true, savingThrow: 'Dex' },
    ];

    expect(stringifyWeapons(weapons)).toBe('Greatsword,5,2d6,false,1,0,0,false,false,false,true,1,true,Dex,circle');
  });

  it('roundtrips a healing weapon', () => {
    const weapons: Weapon[] = [
      { name: 'Cure Wounds', attackBonus: 5, damageDice: '1d8', isHealing: true, range: 1, maxRange: 0, magicDimension: 0, shape: 'circle', reach: false, noRetaliation: false, freeAction: false, isTwoHanded: false, numberOfAttacks: 1, onSaveHalfOrNeg: true, savingThrow: 'Dex' },
    ];

    expect(stringifyWeapons(weapons)).toBe('Cure Wounds,5,1d8,true,1,0,0,false,false,false,false,1,true,Dex,circle');
  });

  it('returns empty string for empty array', () => {
    expect(stringifyWeapons([])).toBe('');
  });

  it('roundtrips: stringify(parse(input)) === input for canonical input', () => {
    const input = 'Spear,3,1d6+1,false,1,1,0,false,false,false,false,1,true,Dex,circle;Longbow,3,1d8,false,4,8,0,false,true,false,false,1,false,Con,circle';
    expect(stringifyWeapons(parseWeapons(input))).toBe(input);
  });
});

describe('formatWeaponDisplay', () => {
  it('formats a melee weapon', () => {
    const weapon: Weapon = { name: 'Spear', attackBonus: 3, damageDice: '1d6+1', isHealing: false, range: 1, maxRange: 0, magicDimension: 0, shape: 'circle', reach: false, noRetaliation: false, freeAction: false, isTwoHanded: false, numberOfAttacks: 1, onSaveHalfOrNeg: true, savingThrow: 'Dex' };

    expect(formatWeaponDisplay(weapon)).toBe('Spear 1x +3 1d6+1 1hex');
  });

  it('formats a ranged weapon with max range', () => {
    const weapon: Weapon = { name: 'Longbow', attackBonus: 3, damageDice: '1d8', isHealing: false, range: 4, maxRange: 8, magicDimension: 0, shape: 'circle', reach: false, noRetaliation: false, freeAction: false, isTwoHanded: false, numberOfAttacks: 1, onSaveHalfOrNeg: true, savingThrow: 'Dex' };

    expect(formatWeaponDisplay(weapon)).toBe('Longbow 1x +3 1d8 4hex');
  });

  it('formats an area weapon with radius', () => {
    const weapon: Weapon = { name: 'Fireball', attackBonus: 7, damageDice: '8d6', isHealing: false, range: 4, maxRange: 8, magicDimension: 2, shape: 'circle', reach: false, noRetaliation: false, freeAction: false, isTwoHanded: false, numberOfAttacks: 2, onSaveHalfOrNeg: true, savingThrow: 'Dex' };

    expect(formatWeaponDisplay(weapon)).toBe('Fireball 2x +7 8d6 4hex 2ft');
  });

  it('shows a (h) appendix for healing weapons', () => {
    const weapon: Weapon = { name: 'Cure Wounds', attackBonus: 5, damageDice: '1d8', isHealing: true, range: 1, maxRange: 0, magicDimension: 0, shape: 'circle', reach: false, noRetaliation: false, freeAction: false, isTwoHanded: false, numberOfAttacks: 1, onSaveHalfOrNeg: true, savingThrow: 'Dex' };

    expect(formatWeaponDisplay(weapon)).toBe('Cure Wounds 1x +5 1d8(h) 1hex');
  });

  it('shows attacks when a weapon makes more than one per round', () => {
    const weapon: Weapon = { name: 'Flame Blade', attackBonus: 5, damageDice: '2d6', isHealing: false, range: 1, maxRange: 0, magicDimension: 0, shape: 'circle', reach: false, noRetaliation: false, freeAction: false, isTwoHanded: false, numberOfAttacks: 3, onSaveHalfOrNeg: true, savingThrow: 'Dex' };

    expect(formatWeaponDisplay(weapon)).toBe('Flame Blade 3x +5 2d6 1hex');
  });
});
