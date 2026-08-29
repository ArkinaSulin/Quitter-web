// src/lib/verboseCombat.ts
// Pure formatting helpers for the per-scenario "verbose combat" setting. When
// enabled, attack/spell descriptions print every dice roll (sorted ascending)
// so players can verify the engine's formulas from the raw faces.
import type { SingleAttackResult } from './unitCombat';
import type { SpellDamageResult } from './spellDamage';

function sorted(nums: number[]): number[] {
  return [...nums].sort((a, b) => a - b);
}

/**
 * `{D20+{bonus} vs {AC}: {sorted rolls}}` — when every attack rolled a
 * disadvantage pair, the pair is shown as `(taken,discarded)` (no spaces),
 * sorted ascending by the taken roll; ties keep engine order.
 */
export function formatAttackRolls(attacks: SingleAttackResult[], attackBonus: number, targetAc: number): string {
  const hasPairs = attacks.length > 0 && attacks.every(a => !!a.dicePair);
  if (hasPairs) {
    const pairs = [...attacks].map(a => a.dicePair!).sort((a, b) => a[0] - b[0]);
    return `{D20+${attackBonus} vs ${targetAc}: ${pairs.map(p => `(${p[0]},${p[1]})`).join(',')}}`;
  }
  const rolls = sorted(attacks.map(a => a.roll));
  return `{D20+${attackBonus} vs ${targetAc}: ${rolls.join(',')}}`;
}

/**
 * `{N} hits {hitRolls}, {M} critical {critRolls}` — rolls split the same way the
 * summary does. The empty half is omitted (no "0 hits {}" noise).
 */
export function formatHitCritRolls(attacks: SingleAttackResult[]): string {
  const hits = sorted(attacks.filter(a => a.isHit && !a.isCrit).map(a => a.roll));
  const crits = sorted(attacks.filter(a => a.isCrit).map(a => a.roll));
  const parts: string[] = [];
  if (hits.length > 0) parts.push(`${hits.length} hits {${hits.join(',')}}`);
  if (crits.length > 0) parts.push(`${crits.length} critical {${crits.join(',')}}`);
  return parts.join(', ');
}

/**
 * Damage dice segment. Hit faces are shown as-is; crit faces are shown ONCE with
 * the applied multiplier label (×2 per crit/charge) — the message's damage total
 * lets the reader verify `facesSum × multiplier + bonus`.
 * e.g. `{1d8+2: 3,5; (1d8+2)×4: 4}`
 */
export function formatDamageFaces(
  attacks: SingleAttackResult[],
  damageDice: string,
  isCharging: boolean,
): string {
  const hits = attacks.filter(a => a.isHit && !a.isCrit);
  const crits = attacks.filter(a => a.isCrit);
  const parts: string[] = [];
  if (hits.length > 0) {
    const faces = sorted(hits.flatMap(a => a.damageFaces ?? []));
    parts.push(`${damageDice}: ${faces.join(',')}`);
  }
  if (crits.length > 0) {
    const multiplier = (isCharging ? 2 : 1) * 2;
    const faces = sorted(crits.flatMap(a => a.damageFaces ?? []));
    parts.push(`(${damageDice})×${multiplier}: ${faces.join(',')}`);
  }
  return parts.length > 0 ? `{${parts.join('; ')}}` : '';
}

/** `{D20+{saveBonus} vs DC {saveDC}: {sorted save rolls}}` — magic/saving throws. */
export function formatSaveRolls(result: SpellDamageResult, saveBonus: number, saveDC: number): string {
  const rolls = sorted(result.perTroop.filter(t => t.roll > 0).map(t => t.roll));
  return `{D20+${saveBonus} vs DC ${saveDC}: ${rolls.join(',')}}`;
}

/** Base damage dice of a spell: `{dice: faces}`. */
export function formatSpellBaseFaces(result: SpellDamageResult, damageDice: string): string {
  if (result.baseFaces.length === 0) return '';
  return `{${damageDice}: ${sorted(result.baseFaces).join(',')}}`;
}

/**
 * Full verbose clause for one strike volley (first strike, retaliation, or a
 * reaction shot). Appended after the "N attacks" summary:
 * `, {D20+3 vs 12: 11,12,13,20}. 2 hits {12,13}, 1 critical {20}, 12 damage {1d8+2: 3,5}`
 * The damage total is kept from the caller; faces let the reader verify the
 * formula (including doubling, which applies to the dice only).
 */
export function formatStrikeDetail(
  attacks: SingleAttackResult[],
  attackBonus: number,
  targetAc: number,
  damageDice: string,
  isCharging: boolean,
  damageTotal: number,
): string {
  const rolls = formatAttackRolls(attacks, attackBonus, targetAc);
  const hitCrits = formatHitCritRolls(attacks);
  const faces = formatDamageFaces(attacks, damageDice, isCharging);
  return `, ${rolls}${hitCrits ? `. ${hitCrits},` : '.'} ${damageTotal} damage${faces ? ` ${faces}` : ''}`;
}
