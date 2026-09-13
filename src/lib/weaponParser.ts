// src/lib/weaponParser.ts

export type SaveStat = 'Str' | 'Dex' | 'Con' | 'Int' | 'Wis' | 'Cha';

export const SAVE_STATS: SaveStat[] = ['Str', 'Dex', 'Con', 'Int', 'Wis', 'Cha'];

/** Area-effect footprint: circle (radius), cube (side), cone (60° wedge). */
export type AreaShape = 'circle' | 'cube' | 'cone';

export const AREA_SHAPES: AreaShape[] = ['circle', 'cube', 'cone'];

export interface Weapon {
  name: string;
  attackBonus: number;
  damageDice: string;
  isHealing: boolean; // the dice RECOVER hit points instead of dealing damage
  range: number; // normal range in hexes (1 = adjacent). Attacks within this distance are at no penalty.
  maxRange: number; // always >= range. Attacks between range and maxRange are at disadvantage; beyond maxRange is out of range.
  magicDimension: number; // area dimension in feet (0 = single-target; > 0 makes this an area-effect weapon)
  shape: AreaShape; // circle = dimension is radius; cube = side; cone = 60° wedge length
  reach: boolean;
  noRetaliation: boolean; // this attack provokes no retaliation and beats reach (fully safe)
  freeAction: boolean; // this attack does not cost an action
  isTwoHanded: boolean; // occupies both hands — shield unusable while active, no Shield Wall
  numberOfAttacks: number; // attacks per round this weapon makes (per attack capacity / direct for heroes)
  onSaveHalfOrNeg: boolean; // area weapon: successful save takes half damage (true) or none (false)
  savingThrow: SaveStat; // area weapon: which of the 6 ability save bonuses resists it
}

/** An area-effect weapon is any weapon with a magic dimension (feet). */
export function isAreaWeapon(weapon: Pick<Weapon, 'magicDimension'>): boolean {
  return weapon.magicDimension > 0;
}

/** Damage dice grammar: `NdM±X` segments joined by `+` (e.g. "1d6", "2d6+2", "1d4+2d6"). */
export function isValidDamageDice(dice: string): boolean {
  const pattern = /^(\d+d\d+)([+-]\d+)?(\+\d+d\d+)*([+-]\d+)?$/;
  return pattern.test((dice || '').trim());
}

/** A fresh, valid weapon for the editor's "New" action. */
export function blankWeapon(): Weapon {
  return {
    name: '',
    attackBonus: 0,
    damageDice: '1d6',
    isHealing: false,
    range: 1,
    maxRange: 0,
    magicDimension: 0,
    shape: 'circle',
    reach: false,
    noRetaliation: false,
    freeAction: false,
    isTwoHanded: false,
    numberOfAttacks: 1,
    onSaveHalfOrNeg: true,
    savingThrow: 'Dex',
  };
}

/** Shared validation for the weapon form (editor page + add-weapon modal). */
export function validateWeapon(weapon: Weapon): string | null {
  if (!weapon.name || !weapon.name.trim()) return 'Weapon name is required';
  if (!isValidDamageDice(weapon.damageDice)) {
    return 'Damage dice must be in format like "1d6", "2d6+2", or "1d4+2d6"';
  }
  if ((weapon.range || 0) < 1) return 'Range must be at least 1 (adjacent)';
  return null;
}

/**
 * Indices of the offensive weapons that can reach `dist` hexes, in arsenal
 * order. Excludes the active weapon and healing weapons. Used to decide whether
 * an out-of-range attack should silently auto-switch (one option) or prompt the
 * player to confirm the first option (two or more).
 */
export function weaponIndicesReaching(weapons: Weapon[], activeIndex: number, dist: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < weapons.length; i++) {
    if (i === activeIndex) continue;
    const w = weapons[i];
    if (!w || w.isHealing) continue;
    if ((w.maxRange ?? w.range ?? 0) >= dist) out.push(i);
  }
  return out;
}

/**
 * An offensive weapon deals damage to the target (isHealing is the only non-offensive
 * type today — healing recovers HP instead). Offensive weapons may only target a
 * DIFFERENT alliance; healing weapons only the SAME alliance.
 */
export function isOffensiveWeapon(weapon: Pick<Weapon, 'isHealing'>): boolean {
  return !weapon.isHealing;
}

/** `ok` = legal target; the other two are hard-blocked (no soft confirm). */
export type TargetAllianceVerdict = 'ok' | 'friendly-fire' | 'heal-enemy';

/**
 * Hard alliance gate for a targeted weapon action. Offensive weapons may only
 * target a different alliance group; healing weapons may only target the same
 * alliance group. Cross-alliance attacks (friendly fire) and heals (healing an
 * enemy) are both blocked — they are anti-intuitive and near-unused, and the DM
 * has explicit tools for those edge cases.
 */
export function validateTargetAlliance(
  attackerAlliance: string,
  targetAlliance: string,
  weapon: Pick<Weapon, 'isHealing'>,
): TargetAllianceVerdict {
  const same = attackerAlliance === targetAlliance;
  if (isOffensiveWeapon(weapon)) return same ? 'friendly-fire' : 'ok';
  return same ? 'ok' : 'heal-enemy';
}

/**
 * Parse a weapon string into an array of Weapon objects.
 * Format: "Name,AttackBonus,DamageDice,IsHealing,Range,MaxRange,MagicDimension,Reach,NoRetaliation,FreeAction,IsTwoHanded,NumberOfAttacks,OnSaveHalfOrNeg,SavingThrow,Shape"
 * Older strings missing the trailing fields parse with defaults (isHealing false,
 * half-on-save true, saving throw Dex, shape circle).
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
      const shape = (parts[14] as AreaShape) || 'circle';
      return {
        name: parts[0] || 'Unknown',
        attackBonus: parseInt(parts[1]) || 0,
        damageDice: parts[2] || '1d2',
        isHealing: parts[3] === 'true',
        range,
        // maxRange is always >= range: 0 or absent means "same as range" (no
        // disadvantage band, and range is the hard cap).
        maxRange: parseInt(parts[5]) || range,
        magicDimension: parseInt(parts[6]) || 0,
        shape: AREA_SHAPES.includes(shape) ? shape : 'circle',
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
      `${w.name},${w.attackBonus},${w.damageDice},${w.isHealing ?? false},${w.range},${w.maxRange ?? w.range},${w.magicDimension},${w.reach},${w.noRetaliation},${w.freeAction},${w.isTwoHanded},${w.numberOfAttacks ?? 1},${w.onSaveHalfOrNeg ?? true},${w.savingThrow ?? 'Dex'},${w.shape ?? 'circle'}`
    )
    .join(';');
}

/**
 * Format a weapon for display: "Name Nx +B Dice(h) Range[–Max]hex Radiusft".
 * Example: "Fireball 2x +7 8d6 4hex 2ft", "Long bow 1x +4 1d8 3–12hex".
 * The dice get a `(h)` appendix when the weapon heals instead of dealing damage.
 * The range shows `N–Mhex` when maxRange extends past range (disadvantage band).
 */
export function formatWeaponDisplay(weapon: Weapon): string {
  const attacks = weapon.numberOfAttacks && weapon.numberOfAttacks > 1 ? ` ${weapon.numberOfAttacks}x` : ' 1x';
  const attack = ` +${weapon.attackBonus}`;
  const dice = `${weapon.damageDice}${weapon.isHealing ? '(h)' : ''}`;
  const rangeMax = weapon.maxRange && weapon.maxRange > weapon.range ? `${weapon.range}–${weapon.maxRange}` : `${weapon.range}`;
  const range = ` ${rangeMax}hex`;
  const radius = weapon.magicDimension > 0 ? ` ${weapon.magicDimension}ft` : '';
  return `${weapon.name}${attacks}${attack} ${dice}${range}${radius}`;
}

/**
 * Get a short display text for the weapon list.
 */
export function getWeaponDisplayText(weapon: Weapon): string {
  const hasBand = weapon.maxRange && weapon.maxRange > weapon.range;
  const rangeDisplay = weapon.range === 1 && !hasBand ? 'Adj' : `${weapon.range}${hasBand ? `–${weapon.maxRange}` : ''}h`;
  const radiusDisplay = weapon.magicDimension > 0 ? `, r${weapon.magicDimension}` : '';
  const attacksDisplay = weapon.numberOfAttacks && weapon.numberOfAttacks > 1 ? `, ${weapon.numberOfAttacks}atk` : '';
  return `${weapon.name} | +${weapon.attackBonus} | ${weapon.damageDice}${weapon.isHealing ? '(h)' : ''} | ${rangeDisplay}${radiusDisplay}${attacksDisplay}`;
}