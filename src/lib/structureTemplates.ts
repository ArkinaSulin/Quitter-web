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

/** Nullable integer column -> number | null. Keeps negatives (hard blocks). */
function numOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : null;
}

const clampInt = (v: unknown, min: number, max: number, fallback: number): number => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
};

/** The effective door pool of a template (null door defaults to maxHp). */
export function templateDoorMax(t: StructureTemplate): number {
  return t.doorHp === null ? t.maxHp : t.doorHp;
}

/**
 * True when the template has a DISTINCT door pool (0 < door_hp < max_hp) — the
 * only case with a visible/meaningful "door" gate. A door equal to max_hp (or
 * null / 0) means "no separate door": passage is governed by destroying the
 * structure (or is already open), so no door badge/field is shown.
 */
export function structureHasDoor(t: StructureTemplate | null | undefined): boolean {
  return !!t && t.doorHp !== null && t.doorHp > 0 && t.doorHp < t.maxHp;
}

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
    spikes: !!row.spikes,
    hexBorder: row.hex_border !== false,
    mpFootIn: numOrNull(row.mp_foot_in),
    mpFootOut: numOrNull(row.mp_foot_out),
    mpMountedIn: numOrNull(row.mp_mounted_in),
    mpMountedOut: numOrNull(row.mp_mounted_out),
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
  'name' | 'description' | 'anchor' | 'color' | 'imageUrl' | 'battlement' | 'spikes' | 'hexBorder' |
  'mpFootIn' | 'mpFootOut' | 'mpMountedIn' | 'mpMountedOut' |
  'doorHp' | 'maxHp' | 'dt' | 'modifiers'>) {
  // A movement value may be any integer (negative = hard block); null = terrain.
  const move = (v: number | null | undefined): number | null => {
    if (v === null || v === undefined) return null;
    const n = Math.round(v);
    return Number.isFinite(n) ? n : null;
  };
  const maxHp = Math.max(0, Math.round(num(t.maxHp)));
  // Door pool clamped to [0, maxHp]; null = "no explicit door".
  const door = t.doorHp === null || t.doorHp === undefined
    ? null
    : Math.max(0, Math.min(maxHp, Math.round(t.doorHp)));
  return {
    name: (t.name || '').trim(),
    description: t.description || '',
    anchor: t.anchor,
    color: t.color || '#cccccc',
    image_url: t.imageUrl || '',
    battlement: !!t.battlement,
    spikes: !!t.spikes,
    hex_border: t.hexBorder !== false,
    mp_foot_in: move(t.mpFootIn),
    mp_foot_out: move(t.mpFootOut),
    mp_mounted_in: move(t.mpMountedIn),
    mp_mounted_out: move(t.mpMountedOut),
    door_hp: door,
    max_hp: maxHp,
    dt: Math.max(0, Math.round(num(t.dt))),
    modifiers: Array.isArray(t.modifiers) ? t.modifiers : [],
  };
}

/** New-template defaults: 30 HP / DT 15, no door pass-through (door = maxHp). */
export function blankStructureTemplate(): Omit<StructureTemplate, 'id' | 'createdAt' | 'updatedAt'> {
  return {
    name: '',
    description: '',
    anchor: 'edge',
    color: '#c49a58',
    imageUrl: '',
    battlement: false,
    spikes: false,
    hexBorder: true,
    mpFootIn: null,
    mpFootOut: null,
    mpMountedIn: null,
    mpMountedOut: null,
    doorHp: 30,
    maxHp: 30,
    dt: 15,
    modifiers: [],
  };
}

/** Sanitize a draft before saving (clamp, keep negatives, drop blanks). */
export function sanitizeStructureTemplate<T extends { anchor: StructureAnchor; doorHp: number | null; maxHp: number; dt: number; modifiers: EffectModifier[] }>(t: T): T {
  const maxHp = Math.max(0, Math.round(t.maxHp));
  const doorHp = t.doorHp === null ? null : Math.max(0, Math.min(maxHp, Math.round(t.doorHp)));
  return {
    ...t,
    maxHp,
    doorHp,
    dt: clampInt(t.dt, 0, 999, 15),
    modifiers: t.modifiers.filter(m => !!m && typeof m.kind === 'string'),
  };
}

/** Effect modifiers a structure applies (tower auras, entry, org gate). */
export function structureModifiers(t: StructureTemplate | null | undefined): EffectModifier[] {
  return t?.modifiers ?? [];
}
