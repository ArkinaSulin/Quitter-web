// src/lib/effectTemplates.ts
// Effects library domain types + row mappers. A template is authored once
// (DM/admin) and applied in any scenario; instances live on units.effects /
// map_data.groundEffects and reference templateId. Each template = a set of
// primitive modifiers so one effect can combine stats or carry special kinds.
export type EffectModifierKind =
  | 'ac'
  | 'morale'
  | 'movement'
  | 'dot'          // per-tick damage (negative = heal)
  | 'hp_borrow'    // "Sleep": take X HP now, refund after caster activations
  | 'entry'        // zone: one-time damage when a unit enters/arrives
  | 'mp_cost'      // zone: offset to the hex entry MP cost
  | 'max_org_level_allowed' // zone/structure: break incoming formations above this org level
  | 'range'        // zone/structure: +/- weapon range (hexes) for the occupant
  | 'advantage'    // carrier's own attacks roll 2d20 take higher
  | 'disadvantage' // carrier's own attacks roll 2d20 take lower
  | 'grant_advantage'    // attackers targeting the carrier take the higher of 2d20
  | 'grant_disadvantage' // attackers targeting the carrier take the lower of 2d20
  | 'block_attacks'      // hard-block attacks in and/or out (see `direction`), melee/ranged per `mode`
  | 'save_advantage'     // carrier's own saving throws roll 2d20 take higher
  | 'save_disadvantage'  // carrier's own saving throws roll 2d20 take lower
  | 'forced_stop';       // zone/structure: entering the hex consumes all remaining actions & MP

/** Amount-less kinds (no dice/save) — boolean markers. */
export const FLAG_MODIFIER_KINDS: EffectModifierKind[] = ['advantage', 'disadvantage', 'grant_advantage', 'grant_disadvantage', 'block_attacks', 'save_advantage', 'save_disadvantage', 'forced_stop'];

export function isFlagModifierKind(kind: EffectModifierKind): boolean {
  return FLAG_MODIFIER_KINDS.includes(kind);
}

/** Kinds that only ever apply to a UNIT (never a zone). */
export const UNIT_ONLY_MODIFIER_KINDS: EffectModifierKind[] = ['movement', 'hp_borrow'];
/** Kinds that only ever apply to a ZONE / hex (never a unit). */
export const ZONE_ONLY_MODIFIER_KINDS: EffectModifierKind[] = ['entry', 'mp_cost', 'max_org_level_allowed', 'forced_stop'];

/** True when a template mixes unit-only and zone-only modifiers, so it cannot be
 *  applied anywhere without dropping some of its modifiers. */
export function modifierScopeConflict(mods: EffectModifier[]): boolean {
  return mods.some(m => UNIT_ONLY_MODIFIER_KINDS.includes(m.kind))
    && mods.some(m => ZONE_ONLY_MODIFIER_KINDS.includes(m.kind));
}

export type SaveStatName = 'Str' | 'Dex' | 'Con' | 'Int' | 'Wis' | 'Cha';

/** Attack-distance scope for the attack-roll / AC modifier kinds. Absent = both. */
export type EffectMode = 'melee' | 'ranged';

/** Kinds whose meaning depends on whether the attack crosses at adjacency (melee)
 *  or at range. Every other kind ignores `mode`. */
export const MODE_MODIFIER_KINDS: EffectModifierKind[] = ['ac', 'advantage', 'disadvantage', 'grant_advantage', 'grant_disadvantage', 'block_attacks'];

/** Direction a `block_attacks` modifier applies to (absent = both). */
export type EffectDirection = 'in' | 'out' | 'both';

export function honorsMode(kind: EffectModifierKind): boolean {
  return MODE_MODIFIER_KINDS.includes(kind);
}

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

/** Parse "XdY±Z" (X=0 => flat Z). Returns null when not a valid dice/number. */
export function parseDice(dice: string | null | undefined): { count: number; sides: number; bonus: number } | null {
  if (!dice) return null;
  const s = dice.trim().replace(/\s+/g, '');
  if (/^-?\d+$/.test(s)) return { count: 0, sides: 0, bonus: parseInt(s, 10) };
  const m = s.match(/^(\d*)d(\d+)([+-]\d+)?$/i);
  if (!m) return null;
  return { count: parseInt(m[1] || '1', 10), sides: parseInt(m[2], 10), bonus: parseInt(m[3] || '0', 10) };
}

/** Roll a dice amount (flat when count=0). */
export function rollDice(dice: string | null | undefined, rng: () => number = Math.random): number {
  const p = parseDice(dice);
  if (!p) return 0;
  let total = p.bonus;
  for (let i = 0; i < p.count; i++) total += Math.floor(rng() * p.sides) + 1;
  return total;
}

/** The FLAT amount of a modifier's `dice` string (0 when absent/unparseable).
 *  Used for stat/aura kinds (ac/morale/movement/range/max_org_level_allowed/mp_cost). */
export function modifierAmount(dice: string | null | undefined): number {
  return parseDice(dice)?.bonus ?? 0;
}

/** True when `dice` is a rolled amount (has at least one die), not a flat number. */
export function isDiceAmount(dice: string | null | undefined): boolean {
  return (parseDice(dice)?.count ?? 0) > 0;
}

/** Roll a modifier's amount (a flat number string rolls its constant). */
export function effectAmount(mod: { dice?: string }, rng: () => number = Math.random): number {
  return rollDice(mod.dice, rng);
}

/** Human label for a modifier kind (flag kinds carry no amount). */
export const EFFECT_MODIFIER_LABELS: Record<EffectModifierKind, string> = {
  ac: 'AC',
  morale: 'Morale',
  movement: 'Movement points',
  dot: 'DoT / heal per tick',
  hp_borrow: 'Borrow HP (sleep)',
  entry: 'Damage on entry',
  mp_cost: 'Terrain cost (hex)',
  max_org_level_allowed: 'Max org level allowed',
  range: 'Weapon range +/-',
  advantage: 'Gain Advantage',
  disadvantage: 'Suffer Disadvantage',
  grant_advantage: 'Grant Advantage',
  grant_disadvantage: 'Grant Disadvantage',
  block_attacks: 'Block attacks in/out',
  save_advantage: 'Advantage on saving throws',
  save_disadvantage: 'Disadvantage on saving throws',
  forced_stop: 'Forced stop on entry',
};

/**
 * Short one-line label for a modifier (used in every list/tooltip/summary).
 * One central implementation so the format can never drift:
 *   - `(mode)` shown ONLY for the mode-honouring kinds (ac, advantage,
 *     disadvantage, the grant kinds and block_attacks) — `range` and friends
 *     never print a bogus `(melee)`.
 *   - `/in`·`/out` suffix for `block_attacks`.
 *   - signed amount for stat/aura kinds: `range +2`, `ac -1`; `≤1` for the
 *     `max_org_level_allowed` cap; `heal` suffix preserved.
 *   - flag kinds print just the kind.
 */
export function modifierSummary(m: EffectModifier): string {
  let s = m.kind as string;
  if (m.kind === 'movement') s = 'movement points';
  else if (m.kind === 'mp_cost') s = 'terrain cost';
  else if (m.kind === 'save_advantage') s = 'save advantage';
  else if (m.kind === 'save_disadvantage') s = 'save disadvantage';
  else if (m.kind === 'forced_stop') s = 'forced stop';
  if (honorsMode(m.kind) && m.mode) s += ` (${m.mode})`;
  if (m.kind === 'block_attacks' && m.direction) s += ` /${m.direction}`;
  if (!isFlagModifierKind(m.kind)) {
    if (m.kind === 'max_org_level_allowed') {
      s += ` ≤${modifierAmount(m.dice)}`;
    } else if (isDiceAmount(m.dice)) {
      s += ` ${m.dice}`; // rolled amount: keep the dice string (e.g. `dot 1d6`)
    } else {
      const v = modifierAmount(m.dice);
      s += ` ${v >= 0 ? '+' : ''}${v}`;
    }
    if (m.healing) s += ' heal';
  }
  return s;
}

export type EffectScope = 'unit' | 'zone' | 'both';
/** Whether the effect image draws below or above unit tokens on the map. */
export type EffectLayer = 'above' | 'below';

export interface EffectTemplate {
  id: string;
  name: string;
  description: string;
  color: string;
  imageUrl: string;
  /** Image size multiplier in percent (100 = default 1.2-hex-high artwork). */
  imageScale: number;
  /** Skip the zone hex tint so only the artwork/marker show on the map. */
  transparentBackground: boolean;
  layer: EffectLayer;
  scope: EffectScope;
  defaultDuration: number;
  /** Never ticks or expires once applied (innate/board-feature effect). */
  permanent?: boolean;
  modifiers: EffectModifier[];
  createdAt: string;
  updatedAt: string;
}

const KINDS: EffectModifierKind[] = ['ac', 'morale', 'movement', 'dot', 'hp_borrow', 'entry', 'mp_cost', 'max_org_level_allowed', 'range', ...FLAG_MODIFIER_KINDS];

/** Legacy identifier aliases mapped to their current name on read (no migration). */
const LEGACY_MODIFIER_KINDS: Record<string, string> = {
  enter_org_max: 'max_org_level_allowed',
};

/** Normalize a stored modifier kind string to its current identifier. */
export function normalizeModifierKind(kind: unknown): string {
  if (typeof kind !== 'string') return '';
  return LEGACY_MODIFIER_KINDS[kind] ?? kind;
}

export function parseModifiers(raw: unknown): EffectModifier[] {
  if (!Array.isArray(raw)) return [];
  const out: EffectModifier[] = [];
  for (const m of raw) {
    if (!m || typeof m !== 'object') continue;
    const kind = normalizeModifierKind((m as { kind?: unknown }).kind);
    const isKind = !!kind && KINDS.includes(kind as EffectModifierKind);
    if (!isKind) continue;
    const out2: EffectModifier = { kind: kind as EffectModifierKind };
    const dice = (m as any).dice;
    if (typeof dice === 'string' && dice.trim()) {
      out2.dice = dice;
    } else {
      // Backward compat: old rows stored the amount as a numeric `delta`.
      const legacy = Number((m as any).delta);
      if (Number.isFinite(legacy) && legacy !== 0) out2.dice = String(legacy);
    }
    if ((m as any).healing === true) out2.healing = true;
    const st = (m as any).savingThrow;
    if (typeof st === 'string') out2.savingThrow = st as SaveStatName;
    if (Number.isFinite((m as any).saveDC)) out2.saveDC = Number((m as any).saveDC);
    if (typeof (m as any).onSaveHalfOrNeg === 'boolean') out2.onSaveHalfOrNeg = (m as any).onSaveHalfOrNeg;
    if ((m as any).mode === 'melee' || (m as any).mode === 'ranged') out2.mode = (m as any).mode;
    if ((m as any).direction === 'in' || (m as any).direction === 'out' || (m as any).direction === 'both') out2.direction = (m as any).direction;
    out.push(out2);
  }
  return out;
}

export function mapEffectRow(row: any): EffectTemplate {
  return {
    id: row.id,
    name: row.name || '',
    description: row.description || '',
    color: row.color || '#cccccc',
    imageUrl: row.image_url || '',
    imageScale: Number(row.image_scale) || 100,
    transparentBackground: !!row.transparent_background,
    layer: row.layer === 'above' ? 'above' : 'below',
    scope: row.scope === 'zone' ? 'zone' : row.scope === 'both' ? 'both' : 'unit',
    defaultDuration: Number(row.default_duration) || 3,
    permanent: !!row.permanent,
    modifiers: parseModifiers(row.modifiers),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mapEffectToRow(
  t: Pick<EffectTemplate, 'name' | 'description' | 'color' | 'imageUrl' | 'imageScale' | 'transparentBackground' | 'layer' | 'scope' | 'defaultDuration' | 'permanent' | 'modifiers'>,
) {
  return {
    name: t.name,
    description: t.description,
    color: t.color,
    image_url: t.imageUrl,
    image_scale: Math.max(1, Math.round(t.imageScale || 100)),
    transparent_background: !!t.transparentBackground,
    layer: t.layer,
    scope: t.scope,
    default_duration: t.defaultDuration,
    permanent: !!t.permanent,
    modifiers: t.modifiers,
  };
}

export function blankEffectTemplate(): Omit<EffectTemplate, 'id' | 'createdAt' | 'updatedAt'> {
  return {
    name: '',
    description: '',
    color: '#ffd54d',
    imageUrl: '',
    imageScale: 100,
    transparentBackground: false,
    layer: 'below',
    scope: 'unit',
    defaultDuration: 3,
    permanent: false,
    modifiers: [{ kind: 'ac', dice: '1' }],
  };
}
