// src/lib/spellDamage.ts
import { rollD20, rollDamage } from './unitCombat';

export interface PerTroopSave {
  roll: number;
  saveResult: number;
  success: boolean;
  damage: number;
}

export interface SpellDamageResult {
  baseDamage: number;
  perTroop: PerTroopSave[];
  totalDamage: number;
}

export interface ResolveSpellDamageInput {
  damageDice: string;
  saveBonus: number;
  saveDC: number;
  /** true = half damage on a successful save; false = negate (0) on success. */
  halfOnSave: boolean;
  /** When true the weapon is healing: each affected troop recovers HP instead of
   *  taking damage (no save — healing isn't resisted). */
  isHealing?: boolean;
  affectedCount: number;
  troopHp: number;
  rng?: () => number;
}

/**
 * Resolve an area spell against a number of affected troops.
 *
 * The weapon's damage dice are rolled once (base damage). Each affected troop
 * rolls D20 + saveBonus; if the result is >= saveDC the troop succeeds and takes
 * half (floored) or 0 damage, otherwise it takes the full base damage. Damage per
 * troop is capped at the troop's HP (troopHp) so no single troop absorbs more than
 * one troop's worth.
 *
 * When isHealing is true, each troop instead RECOVERS the base roll (capped at
 * troopHp); `totalDamage` then holds the total healing.
 */
export function resolveSpellDamage({
  damageDice,
  saveBonus,
  saveDC,
  halfOnSave,
  isHealing = false,
  affectedCount,
  troopHp,
  rng = Math.random,
}: ResolveSpellDamageInput): SpellDamageResult {
  const baseDamage = rollDamage(damageDice, rng);
  const perTroop: PerTroopSave[] = [];
  let totalDamage = 0;
  for (let i = 0; i < affectedCount; i++) {
    if (isHealing) {
      const heal = Math.min(baseDamage, troopHp);
      totalDamage += heal;
      perTroop.push({ roll: 0, saveResult: 0, success: true, damage: heal });
      continue;
    }
    const roll = rollD20(rng);
    const saveResult = roll + saveBonus;
    const success = saveResult >= saveDC;
    let damage = success ? (halfOnSave ? Math.floor(baseDamage / 2) : 0) : baseDamage;
    damage = Math.min(damage, troopHp);
    totalDamage += damage;
    perTroop.push({ roll, saveResult, success, damage });
  }
  return { baseDamage, perTroop, totalDamage };
}
