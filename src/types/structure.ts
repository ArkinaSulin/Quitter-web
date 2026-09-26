// src/types/structure.ts
// Map structure templates (authored) and instances (placed on a map).
//
// A structure is either EDGE-anchored (walls, spikes) or HEX-anchored (gates,
// towers). Movement is direction-relative: `mpFootIn/Out` / `mpMountedIn/Out`
// are the MP to cross (OUTSIDE->INSIDE for `_in`, INSIDE->OUTSIDE for `_out`;
// a hex uses only `_in`). A negative value is a hard block for that locomotion;
// NULL falls back to the hex terrain cost. Inside/outside is decided when the
// structure is placed (instance `outside`).
//
// Durability is two pools, damaged simultaneously: `doorHp` gates PASSAGE
// (0 = passable) and `maxHp` gates MODIFIERS (<= 0 = destroyed / removed).
// One `modifiers` list carries cover AC, attack-roll flags, the occupant `range`
// aura and the `enter_org_max` pass-through gate; per-entry `mode` scopes the
// attack-distance-sensitive kinds (melee vs ranged).
//
// Instances live on the map layers (maps.structures / scenarios.map_data.structures)
// keyed by anchor: "q,r,dir" for edges, "q,r" for hexes. They reference a template
// and may override its runtime state (HP / door HP / outside / open / modifiers).
import { EffectModifier } from '@/lib/effectTemplates';

export type StructureAnchor = 'edge' | 'hex';

/** Which canonical edge face is the OUTSIDE (battlement side) for a placed edge
 *  structure. The template's `_in` movement fields apply crossing outside->inside. */
export type StructureOutside = 'a' | 'b';

export interface StructureTemplate {
  id: string;
  name: string;
  description: string;
  anchor: StructureAnchor;
  color: string;
  imageUrl: string;
  /** Draw crenellations on the outside face of an edge structure. */
  battlement: boolean;
  /** Draw small outward-facing triangles along the edge (e.g. archer's stakes). */
  spikes: boolean;
  /** Hex structures: draw the thick black hex outline (off for decorative hexes). */
  hexBorder: boolean;
  // Direction-relative movement. NULL = fall back to terrain; negative = hard block.
  mpFootIn: number | null;
  mpFootOut: number | null;
  mpMountedIn: number | null;
  mpMountedOut: number | null;
  /** Passage gate pool. NULL = no explicit door (app defaults to maxHp). 0 = passable. */
  doorHp: number | null;
  /** Structure pool. <= 0 = destroyed (instance removed). */
  maxHp: number;
  /** Damage Threshold: a single hit at/below this does nothing; above deals full. */
  dt: number;
  modifiers: EffectModifier[];
  createdAt: string;
  updatedAt: string;
}

/** A placed structure: template id + optional runtime overrides. */
export interface StructureInstance {
  templateId: string;
  /** Current structure HP (defaults to template maxHp). */
  hp?: number;
  /** Current door HP (defaults to template doorHp, or maxHp when that is null). */
  doorHp?: number;
  /** Edge structures: which canonical face is the outside. */
  outside?: StructureOutside;
  /** Hex structures with a door: the gate is deliberately open (no door gate). */
  open?: boolean;
  /** Per-instance modifier override (inherited from the template when absent). */
  modifiers?: EffectModifier[];
}
