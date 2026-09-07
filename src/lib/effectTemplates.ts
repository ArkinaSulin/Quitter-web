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

export interface EffectModifier {
  kind: EffectModifierKind;
  delta: number;
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
      out.push({ kind: kind as EffectModifierKind, delta });
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
