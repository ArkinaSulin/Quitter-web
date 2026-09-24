// src/lib/mapStructures.ts
// Placed map structures (instances) on the library/scenario map layers, keyed by
// anchor: "q,r,dir" for an edge structure, "q,r" for a hex structure. Values are
// StructureInstance (template id + optional runtime overrides).
//
// Edge structures are converted to the runtime `Walls` shape (the movement/combat/
// render model). Movement is direction-relative: the template's `_in` fields apply
// crossing OUTSIDE->INSIDE, `_out` the reverse, mapped onto the canonical edge
// sides by the instance `outside` flag. Durability is two pools (door gates
// passage, HP gates modifiers). Modifiers may be overridden per instance.
import { Walls, Wall, WallFace, edgeRef } from './walls';
import { StructureTemplate, StructureInstance } from '@/types/structure';
import { EffectModifier, modifierAmount } from '@/lib/effectTemplates';
import { templateDoorMax } from '@/lib/structureTemplates';
import { GroundEffect } from '@/types/gameProtocol';

export type MapStructures = Record<string, StructureInstance>;

const EDGE_KEY = /^-?\d+,-?\d+,[0-5]$/;
const HEX_KEY = /^-?\d+,-?\d+$/;

export function isEdgeStructureKey(key: string): boolean {
  return EDGE_KEY.test(key);
}

export function isHexStructureKey(key: string): boolean {
  return !isEdgeStructureKey(key) && HEX_KEY.test(key);
}

const intOr = (v: unknown): number | undefined => {
  if (typeof v !== 'number' || !Number.isFinite(v)) return undefined;
  return Math.max(0, Math.round(v));
};

/** Sanitize the jsonb structures blob into a MapStructures record. */
export function parseStructures(raw: any): MapStructures {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: MapStructures = {};
  for (const [key, v] of Object.entries(raw)) {
    if (!isEdgeStructureKey(key) && !isHexStructureKey(key)) continue;
    if (!v || typeof v !== 'object') continue;
    const templateId = (v as any).templateId;
    if (typeof templateId !== 'string' || !templateId) continue;
    const inst: StructureInstance = { templateId };
    const hp = intOr((v as any).hp); if (hp !== undefined) inst.hp = hp;
    const doorHp = intOr((v as any).doorHp); if (doorHp !== undefined) inst.doorHp = doorHp;
    const outside = (v as any).outside;
    if (outside === 'a' || outside === 'b') inst.outside = outside;
    if ((v as any).open === true) inst.open = true;
    if (Array.isArray((v as any).modifiers)) inst.modifiers = (v as any).modifiers as EffectModifier[];
    out[key] = inst;
  }
  return out;
}

/** The modifier list a placed instance actually uses (override else template). */
export function instanceModifiers(inst: StructureInstance | null | undefined, t: StructureTemplate | null | undefined): EffectModifier[] {
  return inst?.modifiers ?? t?.modifiers ?? [];
}

/** Current door pool of a placed instance (null door defaults to maxHp). */
export function instanceDoorState(inst: StructureInstance, t: StructureTemplate): { doorMax: number; doorHp: number; open: boolean; standing: boolean } {
  const doorMax = templateDoorMax(t);
  const doorHp = inst.doorHp ?? doorMax;
  const open = inst.open === true;
  return { doorMax, doorHp, open, standing: !open && doorHp > 0 };
}

/** AC (melee / ranged) a template's `ac` modifiers grant across its edge. */
function coverAc(mods: EffectModifier[]): { melee: number; ranged: number } {
  let melee = 0;
  let ranged = 0;
  for (const m of mods) {
    if (m.kind !== 'ac') continue;
    const d = modifierAmount(m.dice);
    if (m.mode === 'melee') melee += d;
    else if (m.mode === 'ranged') ranged += d;
    else { melee += d; ranged += d; }
  }
  return { melee, ranged };
}

/** One template side -> a runtime wall face. */
function faceFromTemplate(t: StructureTemplate, mods: EffectModifier[], which: 'inside' | 'outside'): WallFace {
  const foot = which === 'inside' ? t.mpFootIn : t.mpFootOut;
  const mounted = which === 'inside' ? t.mpMountedIn : t.mpMountedOut;
  const ac = coverAc(mods);
  const f: WallFace = {};
  if (foot !== null && foot !== undefined) f.moveCostFoot = foot;
  if (mounted !== null && mounted !== undefined) f.moveCostMounted = mounted;
  if (ac.melee) f.meleeAc = ac.melee;
  if (ac.ranged) f.rangedAc = ac.ranged;
  return f;
}

/**
 * Derive the runtime `Walls` map from edge structures. `outside` chooses which
 * canonical side is the outside: template `_in` applies crossing into the inside
 * face, `_out` into the outside face. Durability/door come from the instance.
 */
export function structuresToWalls(
  structures: MapStructures,
  templates: Record<string, StructureTemplate>,
): Walls {
  const walls: Walls = {};
  for (const [key, inst] of Object.entries(structures)) {
    if (!isEdgeStructureKey(key)) continue;
    const t = templates[inst.templateId];
    if (!t) continue;
    const [q, r, dir] = key.split(',').map(Number);
    const ref = edgeRef(q, r, dir);
    const mods = instanceModifiers(inst, t);
    const outsideIsA = (inst.outside ?? 'a') === 'a';
    // Face A (canonical hex): inside when outsideIsA? No — outsideIsA means the
    // canonical face IS the outside, so its cost is the `_out` ("enter outside").
    const aFace = outsideIsA ? faceFromTemplate(t, mods, 'outside') : faceFromTemplate(t, mods, 'inside');
    const bFace = outsideIsA ? faceFromTemplate(t, mods, 'inside') : faceFromTemplate(t, mods, 'outside');
    const maxHp = t.maxHp;
    const door = instanceDoorState(inst, t);
    const wall: Wall = { a: aFace, b: bFace, source: 'map' };
    if (maxHp > 0) {
      wall.maxHp = maxHp;
      wall.hp = inst.hp ?? maxHp;
      wall.dt = t.dt;
    }
    if (door.doorMax > 0) {
      wall.doorHp = door.doorHp;
      wall.doorMax = door.doorMax;
      if (door.open) wall.open = true;
    }
    walls[ref.key] = wall;
  }
  return walls;
}

/** Count edge/hex structures (for the editor summary). */
export function structureCounts(s: MapStructures): { edges: number; hexes: number } {
  let edges = 0;
  let hexes = 0;
  for (const key of Object.keys(s)) {
    if (isEdgeStructureKey(key)) edges++;
    else if (isHexStructureKey(key)) hexes++;
  }
  return { edges, hexes };
}

/** True when a structure's modifiers gate entry for a unit of this org level
 *  (`enter_org_max`: only formations with org level <= value may enter). */
export function structureBlocksOrg(t: StructureTemplate | null | undefined, orgLevel: number, inst?: StructureInstance | null): boolean {
  return instanceModifiers(inst, t).some(m => m.kind === 'enter_org_max' && orgLevel > modifierAmount(m.dice));
}

/** True when a ground zone on (q,r) gates entry for this org level. */
export function zoneBlocksOrg(zones: GroundEffect[] | null | undefined, q: number, r: number, orgLevel: number): boolean {
  if (!zones) return false;
  return zones.some(z => z.q === q && z.r === r && z.kind === 'enter_org_max' && orgLevel > modifierAmount(z.dice));
}

/** The hex structure instance at a hex (keyed "q,r"), if any. */
export function hexStructureAt(
  structures: MapStructures | null | undefined,
  hex: { q: number; r: number },
): StructureInstance | null {
  return structures?.[`${hex.q},${hex.r}`] ?? null;
}

/**
 * Attack-roll flags a unit standing on a hex structure gains from its effect
 * modifiers (tower auras). `advantage`/`disadvantage` affect the occupant's own
 * attacks; `grant_advantage`/`grant_disadvantage` affect attackers targeting it.
 */
export interface StructureAuraFlags {
  advantage: boolean;
  disadvantage: boolean;
  grantAdvantage: boolean;
  grantDisadvantage: boolean;
}

export function structureAuraFlags(
  hex: { q: number; r: number },
  structures: MapStructures | null | undefined,
  templates: Record<string, StructureTemplate> | null | undefined,
): StructureAuraFlags {
  const flags: StructureAuraFlags = { advantage: false, disadvantage: false, grantAdvantage: false, grantDisadvantage: false };
  const inst = hexStructureAt(structures, hex);
  const t = inst ? templates?.[inst.templateId] : undefined;
  for (const m of instanceModifiers(inst, t)) {
    if (m.kind === 'advantage') flags.advantage = true;
    else if (m.kind === 'disadvantage') flags.disadvantage = true;
    else if (m.kind === 'grant_advantage') flags.grantAdvantage = true;
    else if (m.kind === 'grant_disadvantage') flags.grantDisadvantage = true;
  }
  return flags;
}

/** True when any aura flag is set. */
export function hasAuraFlags(f: StructureAuraFlags): boolean {
  return f.advantage || f.disadvantage || f.grantAdvantage || f.grantDisadvantage;
}

/** Open/closed state of a hex structure (edge structures are never "open"). */
export function structureIsOpen(inst: StructureInstance | null | undefined): boolean {
  return inst?.open === true;
}

/**
 * MP to ENTER this hex from a hex structure (replace semantics). Returns
 * `undefined` when there is no structure or no configured cost (caller falls
 * back to terrain). A standing door does not block here — see `structureHexBlocked`.
 */
export function structureHexEntryCost(
  hex: { q: number; r: number },
  structures: MapStructures | null | undefined,
  templates: Record<string, StructureTemplate> | null | undefined,
  isMounted: boolean,
): number | undefined {
  const inst = hexStructureAt(structures, hex);
  const t = inst ? templates?.[inst.templateId] : undefined;
  if (!inst || !t) return undefined;
  if (structureIsOpen(inst)) return undefined;
  const cost = isMounted ? t.mpMountedIn : t.mpFootIn;
  if (cost === null || cost === undefined || cost < 0) return undefined;
  return cost;
}

/** True when a hex structure blocks entry (standing door, or a hard-block MP). */
export function structureHexBlocked(
  hex: { q: number; r: number },
  structures: MapStructures | null | undefined,
  templates: Record<string, StructureTemplate> | null | undefined,
  isMounted: boolean,
): boolean {
  const inst = hexStructureAt(structures, hex);
  const t = inst ? templates?.[inst.templateId] : undefined;
  if (!inst || !t) return false;
  const cost = isMounted ? t.mpMountedIn : t.mpFootIn;
  if (cost !== null && cost !== undefined && cost < 0) return true;
  const door = instanceDoorState(inst, t);
  return door.standing;
}

/** Weapon-range bonus (hexes) a unit standing on this hex gains from a structure. */
export function structureRangeBonus(
  hex: { q: number; r: number },
  structures: MapStructures | null | undefined,
  templates: Record<string, StructureTemplate> | null | undefined,
): number {
  const inst = hexStructureAt(structures, hex);
  const t = inst ? templates?.[inst.templateId] : undefined;
  let sum = 0;
  for (const m of instanceModifiers(inst, t)) if (m.kind === 'range') sum += modifierAmount(m.dice);
  return sum;
}
