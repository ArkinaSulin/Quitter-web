// src/lib/weaponParser.ts

export interface Weapon {
  name: string;
  attackBonus: number;
  targetType: 'single' | 'area';
  damageDice: string;
  range: number; // in hexes (1 = adjacent)
  magicRadius: number; // in hexes (0 for non-area)
}

/**
 * Parse a weapon string into an array of Weapon objects.
 * Format: "Name,AttackBonus,TargetType,DamageDice,Range,MagicRadius"
 * Example: "Longsword,5,single,1d8,1,0;Fireball,7,area,8d6,4,2"
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
        attackBonus: parseInt(parts[1]) || 0,
        targetType: (parts[2] === 'area' ? 'area' : 'single') as 'single' | 'area',
        damageDice: parts[3] || '1d2',
        range: parseInt(parts[4]) || 1,
        magicRadius: parseInt(parts[5]) || 0,
      };
    });
}

/**
 * Convert an array of Weapon objects to a string.
 */
export function stringifyWeapons(weapons: Weapon[]): string {
  if (!weapons || weapons.length === 0) {
    return '';
  }
  return weapons
    .map(w =>
      `${w.name},${w.attackBonus},${w.targetType},${w.damageDice},${w.range},${w.magicRadius}`
    )
    .join(';');
}

/**
 * Format a weapon for display (used in lists).
 */
export function formatWeaponDisplay(weapon: Weapon): string {
  const rangeDisplay = weapon.range === 1 ? 'Adjacent' : `${weapon.range} hexes`;
  const radiusDisplay = weapon.magicRadius > 0 ? `radius ${weapon.magicRadius}` : '';
  return `${weapon.name} (+${weapon.attackBonus} atk, ${weapon.damageDice}, ${rangeDisplay}${radiusDisplay ? ', ' + radiusDisplay : ''})`;
}

/**
 * Get a short display text for the weapon list.
 */
export function getWeaponDisplayText(weapon: Weapon): string {
  const rangeDisplay = weapon.range === 1 ? 'Adj' : `${weapon.range}h`;
  const radiusDisplay = weapon.magicRadius > 0 ? `, r${weapon.magicRadius}` : '';
  return `${weapon.name} | +${weapon.attackBonus} | ${weapon.damageDice} | ${rangeDisplay}${radiusDisplay}`;
}