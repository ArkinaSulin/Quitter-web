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
  | 'mp_cost';     // zone: offset to the hex entry MP cost

export type SaveStatName = 'Str' | 'Dex' | 'Con' | 'Int' | 'Wis' | 'Cha';

export interface EffectModifier {
  kind: EffectModifierKind;
  delta: number;
  /** Dice amount for damage/heal kinds, e.g. "2d6+2" (X=0 => flat Z). Overrides delta. */
  dice?: string;
  /** When true, the dice/delta HEALS instead of damaging. */
  healing?: boolean;
  /** Standard save: d20 + bonus >= saveDC passes (half or negate). */
  savingThrow?: SaveStatName | null;
  saveDC?: number | null;
  onSaveHalfOrNeg?: boolean;
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

export function effectAmount(mod: { dice?: string; delta: number }, rng: () => number = Math.random): number {
  const p = parseDice(mod.dice);
  return p ? rollDice(mod.dice, rng) : mod.delta;
}

export type EffectScope = 'unit' | 'zone' | 'both';
export type MagnitudeMode = 'fixed' | 'caster_input';

export interface EffectTemplate {
  id: string;
  name: string;
  description: string;
  color: string;
  imageUrl: string;
  scope: EffectScope;
  magnitudeMode: MagnitudeMode;
  defaultDuration: number;
  modifiers: EffectModifier[];
  createdAt: string;
  updatedAt: string;
}

const KINDS: EffectModifierKind[] = ['ac', 'morale', 'movement', 'dot', 'hp_borrow', 'entry', 'mp_cost'];

export function parseModifiers(raw: unknown): EffectModifier[] {
  if (!Array.isArray(raw)) return [];
  const out: EffectModifier[] = [];
  for (const m of raw) {
    if (!m || typeof m !== 'object') continue;
    const kind = (m as { kind?: unknown }).kind;
    const delta = Number((m as { delta?: unknown }).delta);
    if (typeof kind === 'string' && KINDS.includes(kind as EffectModifierKind) && Number.isFinite(delta)) {
      const out2: EffectModifier = { kind: kind as EffectModifierKind, delta };
      if (typeof (m as any).dice === 'string') out2.dice = (m as any).dice;
      if ((m as any).healing === true) out2.healing = true;
      const st = (m as any).savingThrow;
      if (typeof st === 'string') out2.savingThrow = st as SaveStatName;
      if (Number.isFinite((m as any).saveDC)) out2.saveDC = Number((m as any).saveDC);
      if (typeof (m as any).onSaveHalfOrNeg === 'boolean') out2.onSaveHalfOrNeg = (m as any).onSaveHalfOrNeg;
      out.push(out2);
    }
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
    scope: row.scope === 'zone' ? 'zone' : row.scope === 'both' ? 'both' : 'unit',
    magnitudeMode: row.magnitude_mode === 'caster_input' ? 'caster_input' : 'fixed',
    defaultDuration: Number(row.default_duration) || 3,
    modifiers: parseModifiers(row.modifiers),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mapEffectToRow(
  t: Pick<EffectTemplate, 'name' | 'description' | 'color' | 'imageUrl' | 'scope' | 'magnitudeMode' | 'defaultDuration' | 'modifiers'>,
) {
  return {
    name: t.name,
    description: t.description,
    color: t.color,
    image_url: t.imageUrl,
    scope: t.scope,
    magnitude_mode: t.magnitudeMode,
    default_duration: t.defaultDuration,
    modifiers: t.modifiers,
  };
}

export function blankEffectTemplate(): Omit<EffectTemplate, 'id' | 'createdAt' | 'updatedAt'> {
  return {
    name: '',
    description: '',
    color: '#ffd54d',
    imageUrl: '',
    scope: 'unit',
    magnitudeMode: 'fixed',
    defaultDuration: 3,
    modifiers: [{ kind: 'ac', delta: 1 }],
  };
}
