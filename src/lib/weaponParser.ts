// src/lib/weaponParser.ts

export interface Weapon {
  name: string;
  attackBonus: number;
  damageDice: string;
  range: number; // normal range in hexes (1 = adjacent). Attacks within this distance are at no penalty.
  maxRange: number; // always >= range. Attacks between range and maxRange are at disadvantage; beyond maxRange is out of range.
  magicRadius: number; // area radius in feet (0 = single-target; > 0 makes this an area-effect weapon)
  reach: boolean;
  noRetaliation: boolean; // this attack provokes no retaliation and beats reach (fully safe)
  freeAction: boolean; // this attack does not cost an action
  isTwoHanded: boolean; // occupies both hands — shield unusable while active, no Shield Wall
  numberOfAttacks: number; // attacks per round this weapon makes (per attack capacity / direct for heroes)
}

/** An area-effect weapon is any weapon with a magic radius (feet). */
export function isAreaWeapon(weapon: Pick<Weapon, 'magicRadius'>): boolean {
  return weapon.magicRadius > 0;
}

/**
 * Parse a weapon string into an array of Weapon objects.
 * Format: "Name,AttackBonus,DamageDice,Range,MaxRange,MagicRadius,Reach,NoRetaliation,FreeAction,IsTwoHanded,NumberOfAttacks"
 * Example: "Longsword,5,1d8,1,0,0,false,false,false,false,1;Longbow,3,1d8,4,8,0,false,false,false,false,1"
 * Older strings (missing trailing fields) parse with missing flags false and attacks 1;
 * missing maxRange (or 0) resolves to the weapon's range (no disadvantage band).
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
      const range = parseInt(parts[3]) || 1;
      return {
        name: parts[0] || 'Unknown',
        attackBonus: parseInt(parts[1]) || 0,
        damageDice: parts[2] || '1d2',
        range,
        // maxRange is always >= range: 0 or absent means "same as range" (no
        // disadvantage band, and range is the hard cap).
        maxRange: parseInt(parts[4]) || range,
        magicRadius: parseInt(parts[5]) || 0,
        reach: parts[6] === 'true',
        noRetaliation: parts[7] === 'true',
        freeAction: parts[8] === 'true',
        isTwoHanded: parts[9] === 'true',
        numberOfAttacks: parseInt(parts[10]) || 1,
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
      `${w.name},${w.attackBonus},${w.damageDice},${w.range},${w.maxRange ?? w.range},${w.magicRadius},${w.reach},${w.noRetaliation},${w.freeAction},${w.isTwoHanded},${w.numberOfAttacks ?? 1}`
    )
    .join(';');
}

/**
 * Format a weapon for display (used in lists).
 */
export function formatWeaponDisplay(weapon: Weapon): string {
  const rangeDisplay = weapon.range === 1 ? 'Adjacent' : `${weapon.range} hexes`;
  const radiusDisplay = weapon.magicRadius > 0 ? `radius ${weapon.magicRadius}` : '';
  const attacksDisplay = weapon.numberOfAttacks && weapon.numberOfAttacks > 1 ? `, ${weapon.numberOfAttacks} attacks` : '';
  return `${weapon.name} (+${weapon.attackBonus} atk, ${weapon.damageDice}, ${rangeDisplay}${radiusDisplay ? ', ' + radiusDisplay : ''}${attacksDisplay})`;
}

/**
 * Get a short display text for the weapon list.
 */
export function getWeaponDisplayText(weapon: Weapon): string {
  const rangeDisplay = weapon.range === 1 ? 'Adj' : `${weapon.range}h`;
  const radiusDisplay = weapon.magicRadius > 0 ? `, r${weapon.magicRadius}` : '';
  const attacksDisplay = weapon.numberOfAttacks && weapon.numberOfAttacks > 1 ? `, ${weapon.numberOfAttacks}atk` : '';
  return `${weapon.name} | +${weapon.attackBonus} | ${weapon.damageDice} | ${rangeDisplay}${radiusDisplay}${attacksDisplay}`;
}