// src/packages/ai/lib/types.ts
// Public shapes for the Basic AI assist. Kept in one place so the planner,
// archetype modules, panel and canvas overlay all agree on the contract.
import { Unit, Hex, AllianceGroup, Formation, GroundEffect } from '@/types/gameProtocol';
import { MapStructures, Walls } from '@/packages/movement';
import { TerrainCosts } from '@/packages/world';
import { StructureTemplate } from '@/types/structure';

export type AiArchetype = 'melee' | 'ranged' | 'flying' | 'mounted';

/** One unit's plotted route for preview rendering (start -> waypoints -> end). */
export interface AiRouteVisual {
  unitId: string;
  waypoints: Hex[];
  attacks: { from: Hex; targetHex: Hex }[];
  turns?: { hex: Hex; dir: 'left' | 'right' }[];
  formation?: string;
}

/** A target mark. Counts are independent per archetype. */
export interface AiMark {
  targetId: string;
  byUnitId: string;
  kind: AiArchetype;
}

export type AiStep =
  | { kind: 'move'; unitId: string; from: Hex; to: Hex; path: Hex[]; cost: number; elevation?: number }
  | { kind: 'attack'; unitId: string; from: Hex; targetId: string; target: Hex; charge?: boolean }
  | { kind: 'turn'; unitId: string; from: Hex; dir: 'left' | 'right' }
  | { kind: 'formation'; unitId: string; from: Hex; formation: string }
  | { kind: 'weapon'; unitId: string; from: Hex; weaponIndex: number }
  | { kind: 'climbAttack'; unitId: string; from: Hex; targetId: string; target: Hex }
  | { kind: 'charge'; unitId: string; from: Hex }
  | { kind: 'swoop'; unitId: string; from: Hex; targetId: string; target: Hex }
  | { kind: 'chargeEnd'; unitId: string; from: Hex };

export interface AiUnitPlan {
  unitId: string;
  archetype: AiArchetype;
  steps: AiStep[];
}

export interface AiPlanContext {
  units: Unit[];
  alliances: Record<string, AllianceGroup>;
  formations: Record<string, Formation>;
  /** Teams handed to the AI for this plot. */
  teams: string[];
  /** Units the DM opted out of AI control (kept on the board, never plotted). */
  excludeUnitIds?: string[];
  /** Current turn's alliance (null = free play - never plot). */
  activeAlliance: AllianceGroup | null;
  /** Fog reveal for the AI side (hex keys). null/undefined = no fog. */
  visibleHexes?: Set<string> | null;
  terrainCosts?: TerrainCosts;
  walls?: Walls;
  structures?: MapStructures;
  structureTemplates?: Record<string, StructureTemplate>;
  groundZones?: GroundEffect[];
  /** Reserved for the future Advanced brain. Unused by Basic. */
  advanced?: boolean;
  stance?: 'aggressive' | 'defensive';
  gridRadius?: number;
  reactiveArchery?: boolean;
}

export interface AiPlanResult {
  plans: AiUnitPlan[];
  marks: AiMark[];
}
