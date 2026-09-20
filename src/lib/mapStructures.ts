// src/lib/mapStructures.ts
// Placed map structures (instances) on the library/scenario map layers, keyed by
// anchor: "q,r,dir" for an edge structure, "q,r" for a hex structure. Values are
// StructureInstance (template id + optional durability/outside overrides).
//
// Edge structures are converted to the runtime `Walls` shape (the existing
// movement/combat/render model) with the template's inside/outside faces mapped
// onto the canonical edge sides by the instance `outside` flag.
import { Walls, Wall, WallFace, edgeRef } from './walls';
import { StructureTemplate, StructureInstance } from '@/types/structure';

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
    const maxHp = intOr((v as any).maxHp); if (maxHp !== undefined) inst.maxHp = maxHp;
    const dt = intOr((v as any).dt); if (dt !== undefined) inst.dt = dt;
    const doorHp = intOr((v as any).doorHp); if (doorHp !== undefined) inst.doorHp = doorHp;
    const outside = (v as any).outside;
    if (outside === 'a' || outside === 'b') inst.outside = outside;
    out[key] = inst;
  }
  return out;
}

/** One template face -> a runtime wall face (only defined props are set). */
function faceFromTemplate(t: StructureTemplate, which: 'inside' | 'outside'): WallFace {
  const block = which === 'inside' ? t.edgeABlock : t.edgeBBlock;
  const moveCost = which === 'inside' ? t.edgeAMoveCost : t.edgeBMoveCost;
  const meleeAc = which === 'inside' ? t.edgeAMeleeAc : t.edgeBMeleeAc;
  const rangedAc = which === 'inside' ? t.edgeARangedAc : t.edgeBRangedAc;
  const f: WallFace = {};
  if (block) f.block = true;
  if (moveCost !== null && moveCost !== undefined) f.moveCost = moveCost;
  if (meleeAc) f.meleeAc = meleeAc;
  if (rangedAc) f.rangedAc = rangedAc;
  return f;
}

/**
 * Derive the runtime `Walls` map from edge structures. `outside` chooses which
 * canonical side is the outside: template face A (inside) covers the inside hex,
 * face B (outside) the outside hex. Durability uses the instance overrides.
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
    const outsideIsA = (inst.outside ?? 'a') === 'a';
    const aFace = outsideIsA ? faceFromTemplate(t, 'outside') : faceFromTemplate(t, 'inside');
    const bFace = outsideIsA ? faceFromTemplate(t, 'inside') : faceFromTemplate(t, 'outside');
    const maxHp = inst.maxHp ?? t.maxHp;
    const wall: Wall = { a: aFace, b: bFace, source: 'map' };
    if (maxHp > 0) {
      wall.maxHp = maxHp;
      wall.hp = inst.hp ?? maxHp;
      wall.dt = inst.dt ?? t.dt;
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
