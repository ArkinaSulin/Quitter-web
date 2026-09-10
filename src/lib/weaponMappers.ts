// src/lib/weaponMappers.ts
// Row <-> object mapping for the `weapons` library table (edited by the Weapon
// Editor page and read by the unit editor / add-weapon modal).
import { Weapon, SaveStat, SAVE_STATS, AreaShape, AREA_SHAPES } from '@/lib/weaponParser';

/** A library weapon with its row id + library metadata. */
export interface LibraryWeapon extends Weapon {
  id: string;
  notes: string;
  costGp: number;
}

export function mapWeaponRow(row: any): LibraryWeapon {
  const shape = row?.shape as AreaShape;
  const savingThrow = row?.saving_throw as SaveStat;
  return {
    id: row?.id,
    name: row?.name || '',
    attackBonus: Number(row?.attack_bonus) || 0,
    damageDice: row?.damage_dice || '1d6',
    isHealing: !!row?.is_healing,
    range: Number(row?.range) || 1,
    maxRange: Number(row?.max_range) || 0,
    magicDimension: Number(row?.magic_dimension) || 0,
    shape: AREA_SHAPES.includes(shape) ? shape : 'circle',
    reach: !!row?.is_reach,
    noRetaliation: !!row?.no_retaliation,
    freeAction: !!row?.free_action,
    isTwoHanded: !!row?.is_two_handed,
    numberOfAttacks: Number(row?.number_of_attacks) || 1,
    onSaveHalfOrNeg: row?.on_save_half_or_neg ?? true,
    savingThrow: SAVE_STATS.includes(savingThrow) ? savingThrow : 'Dex',
    notes: row?.notes || '',
    costGp: Number(row?.cost_gp) || 0,
  };
}

/** The writable columns (no id — the DB default supplies it on insert). */
export function mapWeaponToRow(w: LibraryWeapon) {
  const range = Math.max(1, w.range || 1);
  return {
    name: w.name.trim(),
    attack_bonus: w.attackBonus || 0,
    damage_dice: w.damageDice.trim(),
    is_healing: !!w.isHealing,
    range,
    max_range: Math.max(w.maxRange || range, range),
    magic_dimension: Math.max(0, w.magicDimension || 0),
    shape: w.shape,
    is_reach: !!w.reach,
    no_retaliation: !!w.noRetaliation,
    free_action: !!w.freeAction,
    is_two_handed: !!w.isTwoHanded,
    number_of_attacks: Math.max(1, w.numberOfAttacks || 1),
    on_save_half_or_neg: w.onSaveHalfOrNeg !== false,
    saving_throw: w.savingThrow || 'Dex',
    notes: w.notes || '',
    cost_gp: w.costGp || 0,
  };
}
