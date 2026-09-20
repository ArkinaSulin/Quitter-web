// src/lib/structureTemplates.ts
// Map-structure template domain types + row mappers. Templates are authored in
// the Structure Editor and applied on map layers; placed instances reference the
// template id (see src/types/structure.ts).
import { StructureTemplate, StructureAnchor } from '@/types/structure';
import { EffectModifier, parseModifiers } from '@/lib/effectTemplates';

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** Nullable integer column -> number | null. */
function numOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : null;
}

const clampInt = (v: unknown, min: number, max: number, fallback: number): number => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
};

/** Parse a map_structure_templates row (snake_case) into a template. */
export function mapStructureRow(row: any): StructureTemplate {
  return {
    id: row.id,
    name: row.name || '',
    description: row.description || '',
    anchor: row.anchor === 'hex' ? 'hex' : 'edge',
    color: row.color || '#cccccc',
    imageUrl: row.image_url || '',
    battlement: !!row.battlement,
    edgeABlock: !!row.edge_a_block,
    edgeAMoveCost: numOrNull(row.edge_a_move_cost),
    edgeAMeleeAc: numOrNull(row.edge_a_melee_ac),
    edgeARangedAc: numOrNull(row.edge_a_ranged_ac),
    edgeBBlock: !!row.edge_b_block,
    edgeBMoveCost: numOrNull(row.edge_b_move_cost),
    edgeBMeleeAc: numOrNull(row.edge_b_melee_ac),
    edgeBRangedAc: numOrNull(row.edge_b_ranged_ac),
    hexMoveCost: numOrNull(row.hex_move_cost),
    doorHp: numOrNull(row.door_hp),
    maxHp: Math.max(0, Math.round(num(row.max_hp))),
    dt: Math.max(0, Math.round(num(row.dt))),
    modifiers: parseModifiers(row.modifiers),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Map a template to a snake_case map_structure_templates row (no id). */
export function mapStructureToRow(t: Pick<StructureTemplate,
  'name' | 'description' | 'anchor' | 'color' | 'imageUrl' | 'battlement' |
  'edgeABlock' | 'edgeAMoveCost' | 'edgeAMeleeAc' | 'edgeARangedAc' |
  'edgeBBlock' | 'edgeBMoveCost' | 'edgeBMeleeAc' | 'edgeBRangedAc' |
  'hexMoveCost' | 'doorHp' | 'maxHp' | 'dt' | 'modifiers'>) {
  const clean = (v: number | null | undefined): number | null => {
    if (v === null || v === undefined) return null;
    const n = Math.round(v);
    return Number.isFinite(n) && n >= 0 ? n : null;
  };
  return {
    name: (t.name || '').trim(),
    description: t.description || '',
    anchor: t.anchor,
    color: t.color || '#cccccc',
    image_url: t.imageUrl || '',
    battlement: !!t.battlement,
    edge_a_block: !!t.edgeABlock,
    edge_a_move_cost: clean(t.edgeAMoveCost),
    edge_a_melee_ac: clean(t.edgeAMeleeAc),
    edge_a_ranged_ac: clean(t.edgeARangedAc),
    edge_b_block: !!t.edgeBBlock,
    edge_b_move_cost: clean(t.edgeBMoveCost),
    edge_b_melee_ac: clean(t.edgeBMeleeAc),
    edge_b_ranged_ac: clean(t.edgeBRangedAc),
    hex_move_cost: clean(t.hexMoveCost),
    door_hp: clean(t.doorHp),
    max_hp: Math.max(0, Math.round(num(t.maxHp))),
    dt: Math.max(0, Math.round(num(t.dt))),
    modifiers: Array.isArray(t.modifiers) ? t.modifiers : [],
  };
}

/** New-template defaults: 30 HP / DT 15, no door, no modifiers. */
export function blankStructureTemplate(): Omit<StructureTemplate, 'id' | 'createdAt' | 'updatedAt'> {
  return {
    name: '',
    description: '',
    anchor: 'edge',
    color: '#c49a58',
    imageUrl: '',
    battlement: false,
    edgeABlock: false,
    edgeAMoveCost: null,
    edgeAMeleeAc: null,
    edgeARangedAc: null,
    edgeBBlock: false,
    edgeBMoveCost: null,
    edgeBMeleeAc: null,
    edgeBRangedAc: null,
    hexMoveCost: null,
    doorHp: null,
    maxHp: 30,
    dt: 15,
    modifiers: [],
  };
}

/** Sanitize a draft (clamp durations/amounts, drop blanks) before saving. */
export function sanitizeStructureTemplate<T extends { anchor: StructureAnchor; maxHp: number; dt: number; modifiers: EffectModifier[] }>(t: T): T {
  return {
    ...t,
    maxHp: Math.max(0, Math.round(t.maxHp)),
    dt: clampInt(t.dt, 0, 999, 15),
    modifiers: t.modifiers.filter(m => !!m && typeof m.kind === 'string'),
  };
}

/** Effect modifiers a structure applies (tower auras, entry, org gate). */
export function structureModifiers(t: StructureTemplate | null | undefined): EffectModifier[] {
  return t?.modifiers ?? [];
}
