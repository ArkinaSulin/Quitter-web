// src/lib/spellDamage.ts
import { rollD20 } from '@/packages/combat/lib/unitCombat';
import { clampDamage, rollDamageDetailed } from '@/packages/primitives';

export interface PerTroopSave {
  roll: number;
  saveResult: number;
  success: boolean;
  damage: number;
}

export interface SpellDamageResult {
  baseDamage: number;
  /** Individual base damage dice faces (before any per-troop save adjustment). */
  baseFaces: number[];
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
  /** Saving-throw roll mode (from the target's save advantage/disadvantage effects). */
  saveMode?: 'advantage' | 'disadvantage' | 'normal';
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
  saveMode = 'normal',
  rng = Math.random,
}: ResolveSpellDamageInput): SpellDamageResult {
  const dmg = rollDamageDetailed(damageDice, rng);
  // Universal rule: a landed amount is never below 1 (crit/dice bonus can go
  // negative; the base is clamped once, then capped per troop below).
  const baseDamage = clampDamage(dmg.total);
  const baseFaces = dmg.faces;
  const perTroop: PerTroopSave[] = [];
  let totalDamage = 0;
  for (let i = 0; i < affectedCount; i++) {
    if (isHealing) {
      const heal = clampDamage(baseDamage, troopHp);
      totalDamage += heal;
      perTroop.push({ roll: 0, saveResult: 0, success: true, damage: heal });
      continue;
    }
    const roll = saveMode === 'advantage'
      ? Math.max(rollD20(rng), rollD20(rng))
      : saveMode === 'disadvantage'
        ? Math.min(rollD20(rng), rollD20(rng))
        : rollD20(rng);
    const saveResult = roll + saveBonus;
    const success = saveResult >= saveDC;
    // Fail → full; half-save → half (floored) but still a LANDED ≥1; negate → 0.
    let damage = success ? (halfOnSave ? clampDamage(Math.floor(baseDamage / 2), troopHp) : 0) : clampDamage(baseDamage, troopHp);
    totalDamage += damage;
    perTroop.push({ roll, saveResult, success, damage });
  }
  return { baseDamage, baseFaces, perTroop, totalDamage };
}
