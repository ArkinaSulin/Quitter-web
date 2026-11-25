// src/packages/ships/lib/shipVerbose.ts
// Verbose-mode detail for a ship weapon shot. Mirrors the unit-combat style in
// packages/units/lib/verboseCombat.ts: the plain message stays the same and the
// full dice breakdown is recorded as the verbose variant.

/** `{D20+6 vs AC 15: 17}` or `{D20+6 vs AC 15 (disadvantage): 17,9 → 9}`. */
export function formatShipAttackDetail(
  rolls: number[],
  attackBonus: number,
  ac: number,
  disadvantage = false,
): string {
  const bonus = `${attackBonus >= 0 ? '+' : ''}${attackBonus}`;
  const faces = rolls.join(',');
  if (disadvantage && rolls.length > 1) {
    return `{D20${bonus} vs AC ${ac} (disadvantage): ${faces} → ${Math.min(...rolls)}}`;
  }
  return `{D20${bonus} vs AC ${ac}: ${faces}}`;
}

/**
 * Skill-check detail: `{D20+6 vs DC 15: 17}`. Skill checks are rolled against a
 * Difficulty Class, never Armour Class (which is only for attack rolls).
 */
export function formatShipCheckDetail(
  rolls: number[],
  checkBonus: number,
  dc: number,
): string {
  const bonus = `${checkBonus >= 0 ? '+' : ''}${checkBonus}`;
  const faces = rolls.join(',');
  return `{D20${bonus} vs DC ${dc}: ${faces}}`;
}

/** `23 damage {2d10: 9,7,7}` (faces let the reader verify the total). */
export function formatShipDamageDetail(
  dice: string,
  faces: number[],
  total: number,
): string {
  if (faces.length === 0) return `${total} damage`;
  return `${total} damage {${dice}: ${faces.join(',')}}`;
}

/** `{1d3: 2} → 2 crew hit`. */
export function formatShipMaxTargetDetail(
  maxTargets: number,
  roll: number,
  hits: number,
  available: number,
): string {
  const tail = available <= 0 ? ' (no crew available)' : '';
  return `{1d${Math.max(1, Math.floor(maxTargets))}: ${roll}} → ${hits} crew hit${tail}`;
}
