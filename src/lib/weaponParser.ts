// src/lib/weaponParser.ts

export type SaveStat = 'Str' | 'Dex' | 'Con' | 'Int' | 'Wis' | 'Cha';

export const SAVE_STATS: SaveStat[] = ['Str', 'Dex', 'Con', 'Int', 'Wis', 'Cha'];

export interface Weapon {
  name: string;
  attackBonus: number;
  damageDice: string;
  isHealing: boolean; // the dice RECOVER hit points instead of dealing damage
  range: number; // normal range in hexes (1 = adjacent). Attacks within this distance are at no penalty.
  maxRange: number; // always >= range. Attacks between range and maxRange are at disadvantage; beyond maxRange is out of range.
  magicRadius: number; // area radius in feet (0 = single-target; > 0 makes this an area-effect weapon)
  reach: boolean;
  noRetaliation: boolean; // this attack provokes no retaliation and beats reach (fully safe)
  freeAction: boolean; // this attack does not cost an action
  isTwoHanded: boolean; // occupies both hands — shield unusable while active, no Shield Wall
  numberOfAttacks: number; // attacks per round this weapon makes (per attack capacity / direct for heroes)
  onSaveHalfOrNeg: boolean; // area weapon: successful save takes half damage (true) or none (false)
  savingThrow: SaveStat; // area weapon: which of the 6 ability save bonuses resists it
}

/** An area-effect weapon is any weapon with a magic radius (feet). */
export function isAreaWeapon(weapon: Pick<Weapon, 'magicRadius'>): boolean {
  return weapon.magicRadius > 0;
}

/**
 * Parse a weapon string into an array of Weapon objects.
 * Format: "Name,AttackBonus,DamageDice,IsHealing,Range,MaxRange,MagicRadius,Reach,NoRetaliation,FreeAction,IsTwoHanded,NumberOfAttacks,OnSaveHalfOrNeg,SavingThrow"
 * Older strings missing the trailing fields parse with defaults (isHealing false,
 * half-on-save true, saving throw Dex).
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
      const range = parseInt(parts[4]) || 1;
      const savingThrow = (parts[13] as SaveStat) || 'Dex';
      return {
        name: parts[0] || 'Unknown',
        attackBonus: parseInt(parts[1]) || 0,
        damageDice: parts[2] || '1d2',
        isHealing: parts[3] === 'true',
        range,
        // maxRange is always >= range: 0 or absent means "same as range" (no
        // disadvantage band, and range is the hard cap).
        maxRange: parseInt(parts[5]) || range,
        magicRadius: parseInt(parts[6]) || 0,
        reach: parts[7] === 'true',
        noRetaliation: parts[8] === 'true',
        freeAction: parts[9] === 'true',
        isTwoHanded: parts[10] === 'true',
        numberOfAttacks: parseInt(parts[11]) || 1,
        onSaveHalfOrNeg: parts[12] !== 'false',
        savingThrow: SAVE_STATS.includes(savingThrow) ? savingThrow : 'Dex',
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
      `${w.name},${w.attackBonus},${w.damageDice},${w.isHealing ?? false},${w.range},${w.maxRange ?? w.range},${w.magicRadius},${w.reach},${w.noRetaliation},${w.freeAction},${w.isTwoHanded},${w.numberOfAttacks ?? 1},${w.onSaveHalfOrNeg ?? true},${w.savingThrow ?? 'Dex'}`
    )
    .join(';');
}

/**
 * Format a weapon for display: "Name Nx +B Dice(h) Rangehex Radiusft".
 * Example: "Fireball 2x +7 8d6 4hex 2ft", "Longsword 1x +5 1d8 1hex".
 * The dice get a `(h)` appendix when the weapon heals instead of dealing damage.
 */
export function formatWeaponDisplay(weapon: Weapon): string {
  const attacks = weapon.numberOfAttacks && weapon.numberOfAttacks > 1 ? ` ${weapon.numberOfAttacks}x` : ' 1x';
  const attack = ` +${weapon.attackBonus}`;
  const dice = `${weapon.damageDice}${weapon.isHealing ? '(h)' : ''}`;
  const range = ` ${weapon.range}hex`;
  const radius = weapon.magicRadius > 0 ? ` ${weapon.magicRadius}ft` : '';
  return `${weapon.name}${attacks}${attack} ${dice}${range}${radius}`;
}

/**
 * Get a short display text for the weapon list.
 */
export function getWeaponDisplayText(weapon: Weapon): string {
  const rangeDisplay = weapon.range === 1 ? 'Adj' : `${weapon.range}h`;
  const radiusDisplay = weapon.magicRadius > 0 ? `, r${weapon.magicRadius}` : '';
  const attacksDisplay = weapon.numberOfAttacks && weapon.numberOfAttacks > 1 ? `, ${weapon.numberOfAttacks}atk` : '';
  return `${weapon.name} | +${weapon.attackBonus} | ${weapon.damageDice}${weapon.isHealing ? '(h)' : ''} | ${rangeDisplay}${radiusDisplay}${attacksDisplay}`;
}