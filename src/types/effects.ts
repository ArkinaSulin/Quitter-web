// src/types/effects.ts
// Effect modifier TYPES (a leaf): shared by the types layer (e.g. UnitEffect in
// gameProtocol) and the effects package. Kept here so `src/types` never has to
// import a package (see the `types-are-leaves` boundary rule).

export type EffectModifierKind =
  | 'ac'
  | 'morale'
  | 'movement'
  | 'dot'
  | 'hp_borrow'
  | 'entry'
  | 'mp_cost'
  | 'max_org_level_allowed'
  | 'range'
  | 'advantage'
  | 'disadvantage'
  | 'grant_advantage'
  | 'grant_disadvantage'
  | 'block_attacks'
  | 'save_advantage'
  | 'save_disadvantage'
  | 'forced_stop'
  | 'ignore_climb'
  | 'feather_fall';

export type SaveStatName = 'Str' | 'Dex' | 'Con' | 'Int' | 'Wis' | 'Cha';

/** Attack-distance scope for the attack-roll / AC modifier kinds. Absent = both. */
export type EffectMode = 'melee' | 'ranged';

/** Direction a `block_attacks` modifier applies to (absent = both). */
export type EffectDirection = 'in' | 'out' | 'both';

export interface EffectModifier {
  kind: EffectModifierKind;
  /**
   * The modifier's amount as a single string: a plain number ("2", "-1") for
   * flat stat/aura amounts, or dice ("2d6+2", "1d2") for rolled damage/heal.
   * Absent for amount-less flag kinds (advantage/disadvantage/grant_*).
   */
  dice?: string;
  /** When true, the dice amount HEALS instead of damaging. */
  healing?: boolean;
  /** Standard save: d20 + bonus >= saveDC passes (half or negate). */
  savingThrow?: SaveStatName | null;
  saveDC?: number | null;
  onSaveHalfOrNeg?: boolean;
  /** Attack-distance scope (melee vs ranged); only meaningful for MODE_MODIFIER_KINDS. */
  mode?: EffectMode;
  /** Block direction (in/out/both); only meaningful for `block_attacks`. */
  direction?: EffectDirection;
}
