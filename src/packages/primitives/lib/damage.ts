// src/packages/primitives/lib/damage.ts
// The ONE damage parser. Every damage path (weapon combat, area magic, walls,
// hex structures, temporary effects, fall damage) rolls and clamps through here
// so a single universal rule holds: a LANDED amount of damage is never below 1.
// A full saving-throw negate is the only 0. Healing amounts are floored at 1 too.

/** Universal floor for any landed damage/heal amount. */
export const MIN_DAMAGE = 1;

/** Roll a d20 (1–20). The one d20 roll — attacks, saves and checks all use it. */
export function rollD20(rng: () => number = Math.random): number {
  return Math.floor(rng() * 20) + 1;
}

export interface DamageRoll {
  /** Sum of the dice faces plus the flat bonus. */
  total: number;
  /** Individual die faces (before any doubling). */
  faces: number[];
  /** Flat bonus from the dice notation (e.g. "+2" in "1d8+2"). */
  bonus: number;
}

/**
 * Roll a dice string and return the individual faces plus the total. Supports
 * single- and MULTI-segment notation ("1d8", "2d6+2", "1d4+2d6+3"): every `NdM`
 * segment contributes its faces, every flat `±X` adds to `bonus`. Doubling is
 * intentionally NOT applied here — callers multiply only the dice faces (never
 * the bonus) when crits/charges double damage. A string with no die (e.g. "1")
 * or invalid notation rolls 0. This is the RAW roll — it is NOT clamped; clamp
 * with `clampDamage` where the damage is actually applied.
 */
export function rollDamageDetailed(diceStr: string, rng: () => number): DamageRoll {
  const s = (diceStr || '').trim();
  const faces: number[] = [];
  let bonus = 0;
  let sawDie = false;
  // Tokenize into signed segments: `[+-]?NdM` (a dice segment) or `[+-]?X` (a
  // flat). The join check rejects anything with gaps/garbage.
  const tokens = s.match(/[+-]?\s*(?:\d*d\d+|\d+)/g);
  if (!tokens || tokens.map(t => t.replace(/\s+/g, '')).join('') !== s.replace(/\s+/g, '')) {
    return { total: 0, faces: [], bonus: 0 };
  }
  for (const raw of tokens) {
    const tok = raw.replace(/\s+/g, '');
    const dm = tok.match(/^([+-]?)(\d*)d(\d+)$/);
    if (dm) {
      sawDie = true;
      const count = parseInt(dm[2] || '1');
      const sides = parseInt(dm[3]);
      for (let k = 0; k < count; k++) faces.push(Math.floor(rng() * sides) + 1);
    } else {
      const fm = tok.match(/^([+-]?)(\d+)$/);
      if (!fm) return { total: 0, faces: [], bonus: 0 };
      bonus += (fm[1] === '-' ? -1 : 1) * parseInt(fm[2]);
    }
  }
  if (!sawDie) return { total: 0, faces: [], bonus: 0 };
  return { total: faces.reduce((a, b) => a + b, 0) + bonus, faces, bonus };
}

/** Raw damage total (no clamp). */
export function rollDamage(diceStr: string, rng: () => number): number {
  return rollDamageDetailed(diceStr, rng).total;
}

/**
 * THE damage clamp — a landed amount is never below `MIN_DAMAGE` (1) and never
 * above `cap` (default: no cap). Use for damage AND healing amounts. A full
 * saving-throw NEGATE is not a landed amount, so callers pass 0 through untouched
 * rather than calling this.
 */
export function clampDamage(raw: number, cap = Number.POSITIVE_INFINITY): number {
  return Math.max(MIN_DAMAGE, Math.min(cap, raw));
}

/**
 * Roll dice and apply the universal clamp in one step. `multiplier` doubles the
 * dice FACES only (crit/charge ×2, both ×4), never the flat bonus. Returns the
 * pre-clamp `raw` (for verbose display) and the clamped `applied` (capped at
 * `cap`, floored at 1).
 */
export function rollAppliedDamage(
  diceStr: string,
  opts: { rng: () => number; multiplier?: number; cap?: number },
): { faces: number[]; bonus: number; raw: number; applied: number } {
  const { rng, multiplier = 1, cap = Number.POSITIVE_INFINITY } = opts;
  const { faces, bonus } = rollDamageDetailed(diceStr, rng);
  const raw = faces.reduce((a, b) => a + b, 0) * multiplier + bonus;
  return { faces, bonus, raw, applied: clampDamage(raw, cap) };
}
