// src/lib/weaponParser.ts

export interface Weapon {
  name: string;
  attackBonus: number;
  targetType: 'single' | 'area';
  damageDice: string;
  range: number; // in hexes (1 = adjacent)
  magicRadius: number; // in hexes (0 for non-area)
  reach: boolean;
  noRetaliation: boolean; // this attack provokes no retaliation and beats reach (fully safe)
  freeAction: boolean; // this attack does not cost an action
  ignoreAttackMultiplier: boolean; // this attack ignores the formation's attack-capacity multiplier
}

/**
 * Parse a weapon string into an array of Weapon objects.
 * Format: "Name,AttackBonus,TargetType,DamageDice,Range,MagicRadius,Reach,NoRetaliation,FreeAction,IgnoreAttackMultiplier"
 * Example: "Longsword,5,single,1d8,1,0,false,false,false,false;Fireball,7,area,8d6,4,2,false,false,false,false"
 * Older 7/8/9-field strings (no flags) parse with missing flags false.
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
        reach: parts[6] === 'true',
        noRetaliation: parts[7] === 'true',
        freeAction: parts[8] === 'true',
        ignoreAttackMultiplier: parts[9] === 'true',
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
      `${w.name},${w.attackBonus},${w.targetType},${w.damageDice},${w.range},${w.magicRadius},${w.reach},${w.noRetaliation},${w.freeAction},${w.ignoreAttackMultiplier}`
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