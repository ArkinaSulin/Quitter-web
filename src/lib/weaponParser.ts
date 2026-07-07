// src/lib/weaponParser.ts

export interface Weapon {
  name: string;
  targetType: 'single' | 'area';
  damageDice: string;
  range: number;  // 1 = adjacent (melee), >1 = ranged
}

/**
 * Parse a weapon string into an array of Weapon objects
 * Format: "Name,TargetType,DamageDice,Range;Name2,TargetType2,DamageDice2,Range2"
 * Example: "Longsword,single,1d8,1;Shortbow,single,1d6,6"
 */
export function parseWeapons(weaponString: string): Weapon[] {
  if (!weaponString || weaponString.trim() === '') {
    return [];
  }

  return weaponString
    .split(';')
    .filter(item => item.trim() !== '')
    .map(item => {
      const parts = item.split(',').map(p => p.trim());
      return {
        name: parts[0] || 'Unknown',
        targetType: (parts[1] === 'area' ? 'area' : 'single') as 'single' | 'area',
        damageDice: parts[2] || '1d2',
        range: parseInt(parts[3]) || 1,
      };
    });
}

/**
 * Convert an array of Weapon objects to a string
 */
export function stringifyWeapons(weapons: Weapon[]): string {
  if (!weapons || weapons.length === 0) {
    return '';
  }
  return weapons
    .map(w => `${w.name},${w.targetType},${w.damageDice},${w.range}`)
    .join(';');
}

/**
 * Format a weapon for display
 */
export function formatWeaponDisplay(weapon: Weapon): string {
  const rangeDisplay = weapon.range === 1 ? 'Adjacent' : `${weapon.range} hexes`;
  return `${weapon.name} (${weapon.targetType}, ${weapon.damageDice}, ${rangeDisplay})`;
}

/**
 * Get a weapon's display text for the list
 */
export function getWeaponDisplayText(weapon: Weapon): string {
  const rangeDisplay = weapon.range === 1 ? 'Adjacent' : `${weapon.range} hex`;
  return `${weapon.name} | ${weapon.targetType} | ${weapon.damageDice} | ${rangeDisplay}`;
}