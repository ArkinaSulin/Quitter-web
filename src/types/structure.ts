// src/types/structure.ts
// Map structure templates (authored) and instances (placed on a map).
//
// A structure is either EDGE-anchored (walls, spikes — two directional faces:
// A = inside, B = outside) or HEX-anchored (gates, towers — a movement cost plus
// an optional destructible door). Effect behaviour rides `modifiers`
// (tower auras, entry damage, the reusable `enter_org_max` gate).
//
// Instances live on the map layers (maps.structures / scenarios.map_data.structures)
// keyed by anchor: "q,r,dir" for edges, "q,r" for hexes. They reference a template
// and may override its durability.
import { EffectModifier } from '@/lib/effectTemplates';

export type StructureAnchor = 'edge' | 'hex';

/** Which canonical edge face is the OUTSIDE (battlement side) for a placed edge
 *  structure. The template's face A maps to the inside, face B to the outside. */
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
  // Edge faces. A = inside, B = outside; null = normal terrain / no AC bonus.
  edgeABlock: boolean;
  edgeAMoveCost: number | null;
  edgeAMeleeAc: number | null;
  edgeARangedAc: number | null;
  edgeBBlock: boolean;
  edgeBMoveCost: number | null;
  edgeBMeleeAc: number | null;
  edgeBRangedAc: number | null;
  /** Extra MP to enter a hex structure; null = normal. */
  hexMoveCost: number | null;
  /** Destructible door pool for hex structures; null = no door. The door uses
   *  the template `dt` and is destroyed before the structure HP is touched. */
  doorHp: number | null;
  maxHp: number;
  dt: number;
  modifiers: EffectModifier[];
  createdAt: string;
  updatedAt: string;
}

/** A placed structure: template id + optional durability overrides. */
export interface StructureInstance {
  templateId: string;
  hp?: number;
  maxHp?: number;
  dt?: number;
  /** Current door HP (hex structures with a door). */
  doorHp?: number;
  /** Edge structures: which canonical face is the outside. */
  outside?: StructureOutside;
  /** Hex structures with a door: the gate is open (no extra cost, no door pool). */
  open?: boolean;
}
