// src/components/ScenarioMap/mapGeometry.ts
// Map constants + hex/token geometry shared by the canvas draw hook and the map.
import { Unit, Hex, AllianceGroup, Formation } from '@/types/gameProtocol';
import { hexToPixel } from '@/hooks/useHexGrid';
import { determineCombatPosition } from '@/lib/unitCombat';
import { canStopEnemyMovement } from '@/lib/formationRules';
import { isUnitInteractable, isDeadCorpse } from '@/lib/unitInteractions';
import { isUnitRouted } from '@/lib/unitMorale';
import { Walls, crossingCost, blockedStep, wallBetween, edgeRef, directionBetween } from '@/lib/walls';
import { MapStructures, structureBlocksOrg, zoneBlocksOrg, structureHexEntryCost, structureHexBlocked, hexStructureAt, structureDoorState } from '@/lib/mapStructures';
import { StructureTemplate } from '@/types/structure';
import { GroundEffect } from '@/types/gameProtocol';
import { modifierAmount } from '@/lib/effectTemplates';
import type { CostOfHexFn, BlockedEdgeFn } from '@/lib/moveCost';

export const HEX_SIZE = 100;
export const TOKEN_WIDTH = HEX_SIZE * 1.6;
export const TOKEN_HEIGHT = TOKEN_WIDTH * 0.75;
export const DEFAULT_GRID_RADIUS = 12;

/** Painted per-hex terrain entry costs: "q,r" -> MP cost to ENTER (0 free, 1 default, 2..9 costly). */
export type TerrainCosts = Record<string, number>;

/** MP to enter hex (q,r): 1 unless the GM painted a cost there (0 = free entry). */
export function terrainCostOf(terrain: TerrainCosts | null | undefined, q: number, r: number): number {
  const v = terrain ? terrain[`${q},${r}`] : undefined;
  const c = v == null ? 1 : Math.round(v);
  return Number.isFinite(c) && c >= 0 ? c : 1;
}

export interface CostOfHexOpts {
  structures?: MapStructures;
  templates?: Record<string, StructureTemplate>;
  isMounted?: boolean;
}

/**
 * Combined step-cost for movement: a wall face on the destination's side REPLACES
 * the hex's terrain entry cost when crossing that edge; a hex structure's entry
 * MP REPLACES it too; otherwise terrain applies. `fromQ/fromR` are supplied by
 * the movement BFS.
 */
export function makeCostOfHex(
  terrain: TerrainCosts | null | undefined,
  walls: Walls | null | undefined,
  opts: CostOfHexOpts = {},
): CostOfHexFn {
  return (q, r, fromQ, fromR) => {
    if (walls && fromQ !== undefined && fromR !== undefined) {
      const wc = crossingCost(walls, { q: fromQ, r: fromR }, { q, r }, !!opts.isMounted);
      if (wc !== undefined) return wc;
    }
    const hc = structureHexEntryCost({ q, r }, opts.structures, opts.templates, !!opts.isMounted);
    const tc = terrainCostOf(terrain, q, r);
    // "Higher of the two": a hex structure's entry MP and the zone mp_cost both
    // apply, the higher one wins. A hard block (negative structure MP) is
    // handled by the blocked-edge predicate, not here.
    return hc !== undefined ? Math.max(hc, tc) : tc;
  };
}

/** Optional extra movement gates beyond wall `block`. */
export interface BlockEdgeOpts {
  /** Placed structures (edge/hex structure hard blocks — MP only, not org). */
  structures?: MapStructures;
  templates?: Record<string, StructureTemplate>;
  /** Ground zones (unused for blocking — org caps break, not block). */
  zones?: GroundEffect[];
  /** @deprecated org caps now BREAK the formation rather than block entry. */
  orgLevel?: number;
  /** Locomotion for locomotion-specific blocks (negative MP faces / hex). */
  isMounted?: boolean;
  /** Free move / DM override: ignore every hard block. */
  ignoreBlocks?: boolean;
}

/**
 * Impassable-edge predicate for the movement BFS (undefined when nothing can
 * block). Hard blocks (negative MP, standing doors, wall `block`) always block.
 * `max_org_level_allowed` gates no longer block here — they break the formation
 * via `computeReachableMap`'s `breakOnEntry`. `ignoreBlocks` disables the whole
 * predicate.
 */
export function makeBlockedEdge(walls: Walls | null | undefined, opts: BlockEdgeOpts = {}): BlockedEdgeFn | undefined {
  const { structures, templates, isMounted, ignoreBlocks } = opts;
  if (ignoreBlocks) return undefined;
  const hasWalls = !!walls && Object.keys(walls).length > 0;
  const hasStructs = !!structures && Object.keys(structures).length > 0;
  if (!hasWalls && !hasStructs) return undefined;
  return (fromQ, fromR, toQ, toR) => {
    if (walls && blockedStep(walls, fromQ, fromR, toQ, toR, !!isMounted)) return true;
    if (structures && structureHexBlocked({ q: toQ, r: toR }, structures, templates, !!isMounted)) return true;
    return false;
  };
}

export interface ChargeBlockOpts {
  structures?: MapStructures;
  templates?: Record<string, StructureTemplate>;
  zones?: GroundEffect[];
  orgLevel?: number;
  isMounted?: boolean;
}

/**
 * Charges are blocked by any barrier that isn't a low (1 MP) passable structure:
 * any wall edge whose crossing costs 2+ MP (or is a hard block / standing door),
 * any hex structure entered at 2+ MP, and any `max_org_level_allowed` gate (a
 * charge can't barrel through a disorganizing barrier). "Any hex with MP cost 2+
 * will disable charge."
 */
export function makeChargeBlockedEdge(walls: Walls | null | undefined, opts: ChargeBlockOpts = {}): BlockedEdgeFn | undefined {
  const { structures, templates, zones, orgLevel, isMounted } = opts;
  const hasWalls = !!walls && Object.keys(walls).length > 0;
  const hasStructs = !!structures && Object.keys(structures).length > 0;
  const hasOrg = orgLevel !== undefined && ((!!structures && Object.keys(structures).length > 0) || (!!zones && zones.length > 0));
  if (!hasWalls && !hasStructs && !hasOrg) return undefined;
  return (fromQ, fromR, toQ, toR) => {
    if (walls) {
      const hit = wallBetween(walls, { q: fromQ, r: fromR }, { q: toQ, r: toR });
      if (hit) {
        if (hit.wall.source === 'effect') return true; // magic walls always stop charges
        const cost = isMounted ? hit.faceTo.moveCostMounted : hit.faceTo.moveCostFoot;
        // Doors never gate (mirrors movement) — only a hard block or a 2+ MP crossing.
        if (hit.faceFrom.block) return true;
        if (cost === undefined || cost < 0 || cost >= 2) return true;
      }
    }
    const hc = structureHexEntryCost({ q: toQ, r: toR }, structures, templates, !!isMounted);
    if (hc !== undefined && hc >= 2) return true;
    if (orgLevel !== undefined) {
      if (structures) {
        const dir = directionBetween({ q: fromQ, r: fromR }, { q: toQ, r: toR });
        if (dir >= 0) {
          const ref = edgeRef(fromQ, fromR, dir);
          const edgeInst = structures[ref.key];
          if (edgeInst && structureBlocksOrg(templates?.[edgeInst.templateId], orgLevel, edgeInst)) return true;
        }
        const hexInst = structures[`${toQ},${toR}`];
        if (hexInst && structureBlocksOrg(templates?.[hexInst.templateId], orgLevel, hexInst)) return true;
      }
      if (zoneBlocksOrg(zones, toQ, toR, orgLevel)) return true;
    }
    return false;
  };
}

/**
 * Canvas fill for a painted terrain cost: green for free (0), a neutral black
 * overlay for costly hexes whose darkness ramps 10% (cost 2) to 80% (cost 9) so
 * the map art stays faintly visible even on a 9. Returns null for cost 1 (clear).
 */
export function costShade(cost: number): string | null {
  if (cost === 0) return 'rgba(76, 175, 80, 0.42)';
  if (cost <= 1) return null;
  const c = Math.min(9, Math.max(2, cost));
  const alpha = 0.1 + ((c - 2) / 7) * 0.7; // 2 -> 0.10, 9 -> 0.80
  return `rgba(0, 0, 0, ${alpha})`;
}

/** The MP cost number painted on a hex: `foot/mounted` when either differs from
 *  the base 1 MP, a lone `X` when both are blocked, and `null` for a plain hex. */
export interface HexMpLabel {
  text: string;
  /** Representative numeric cost for the shade (2..9). */
  cost: number;
  /** True when either locomotion is hard-blocked (negative structure MP). */
  blocked: boolean;
}

/**
 * Effective hex-entry MP for display, from a hex structure's `mp_foot_in` /
 * `mp_mounted_in` and any `mp_cost` ground zones on the hex — "higher of the
 * two" per locomotion, with a negative structure MP as a hard block. An
 * open/broken door waives the structure's MP. Returns null for a base (1 MP)
 * hex.
 */
export function hexMpLabelAt(
  hex: { q: number; r: number },
  structures: MapStructures | null | undefined,
  templates: Record<string, StructureTemplate> | null | undefined,
  zones: GroundEffect[] | null | undefined,
): HexMpLabel | null {
  let zoneDelta = 0;
  if (zones) for (const z of zones) if (z.q === hex.q && z.r === hex.r && z.kind === 'mp_cost') zoneDelta = Math.max(zoneDelta, modifierAmount(z.dice));
  zoneDelta = Math.max(0, Math.min(9, zoneDelta));

  const inst = hexStructureAt(structures, hex);
  const t = inst ? templates?.[inst.templateId] : undefined;
  const structActive = !!inst && !!t && !structureDoorState(inst, t).openOrBroken;

  const loc = (structVal: number | null | undefined): number | 'block' => {
    if (structActive && structVal !== null && structVal !== undefined && structVal < 0) return 'block';
    const s = structActive && structVal !== null && structVal !== undefined ? structVal : 1;
    return Math.max(s, 1, zoneDelta);
  };

  const foot = loc(t?.mpFootIn);
  const mounted = loc(t?.mpMountedIn);
  if (foot === 1 && mounted === 1) return null;

  const fmt = (v: number | 'block') => (v === 'block' ? 'X' : v > 1 ? String(v) : '-');
  const f = fmt(foot);
  const m = fmt(mounted);
  const nFoot = foot === 'block' ? 0 : foot;
  const nMounted = mounted === 'block' ? 0 : mounted;
  return {
    text: f === m ? f : `${f}/${m}`,
    cost: Math.max(2, Math.min(9, Math.max(nFoot, nMounted))),
    blocked: foot === 'block' || mounted === 'block',
  };
}

/**
 * Per-hex MP-cost overrides from `mp_cost` ("Terrain cost") ground zones. A
 * zone's amount REPLACES the base 1 MP for that hex (clamped 0..9; 1 = default,
 * so it is dropped); when several terrain-cost zones land on one hex the HIGHEST
 * wins. Movement feeds this map into `makeCostOfHex` (then "higher of the two"
 * with a hex structure's entry MP).
 */
export function mpCostOverrides(zones: GroundEffect[] | null | undefined): TerrainCosts {
  const best: Record<string, number> = {};
  for (const z of zones ?? []) {
    if (z.kind !== 'mp_cost') continue;
    const k = `${z.q},${z.r}`;
    const v = Math.max(0, Math.min(9, modifierAmount(z.dice)));
    const cur = best[k];
    if (cur === undefined || v > cur) best[k] = v;
  }
  const out: TerrainCosts = {};
  for (const [k, v] of Object.entries(best)) {
    if (v !== 1) out[k] = v;
  }
  return out;
}

/**
 * Format a foot/mounted MP pair for tooltips: `-` for null (falls back to
 * terrain), `block` for a negative (hard block), a plain number when foot and
 * mounted agree, and `foot X / mtd Y` only when they differ.
 */
export function mpPairText(foot: number | null | undefined, mounted: number | null | undefined): string {
  const f = foot === null || foot === undefined ? '-' : foot < 0 ? 'block' : `${foot}`;
  const m = mounted === null || mounted === undefined ? '-' : mounted < 0 ? 'block' : `${mounted}`;
  return f === m ? f : `foot ${f} / mtd ${m}`;
}

export interface MapBackgroundConfig {
  imageUrl: string;
  offsetX: number;
  offsetY: number;
  scale: number;
  gridRadius: number;
}

/** Pixel offset of an attached hero token around its host's hex. */
export function getAttachedHeroPos(unitHex: { q: number; r: number; s: number }, facing: number, attachedPosition: 'front' | 'back' | 'rider' | null = 'front') {
  const pos = hexToPixel(unitHex, HEX_SIZE);
  if (attachedPosition === 'rider') {
    // Mounted: the rider sits centered on the host's hex.
    return { x: pos.x, y: pos.y };
  }
  const vertexIndex = attachedPosition === 'back' ? (facing + 2) % 6 : (facing + 5) % 6;
  const angle = (60 * vertexIndex - 30) * Math.PI / 180;
  return {
    x: pos.x + HEX_SIZE * 0.75 * Math.cos(angle),
    y: pos.y + HEX_SIZE * 0.75 * Math.sin(angle),
  };
}

/** Corpses (HP <= 0) sort first so live tokens stacked on their hex render on top. */
export const corpseLast = (a: Unit, b: Unit) =>
  ((a.currentUnitHp ?? 0) <= 0 ? 0 : 1) - ((b.currentUnitHp ?? 0) <= 0 ? 0 : 1);

/**
 * Screen-pixel offset of an ELEVATED token from its ground hex center, in the NE
 * (45°) direction. Scales with elevation: half a hex radius at 10 ft, a full hex
 * radius at 20 ft+ (capped). Returns (0,0) when grounded.
 */
export function elevationOffset(elevation: number | undefined, hexSize: number): { dx: number; dy: number } {
  const feet = elevation ?? 0;
  if (feet <= 0) return { dx: 0, dy: 0 };
  const distance = hexSize * 0.5 * Math.min(2, feet / 10);
  return { dx: distance * Math.SQRT1_2, dy: -distance * Math.SQRT1_2 };
}

/** Vertical distance in feet between two elevations (0 when both grounded). */
export function elevationGapFeet(a: number | undefined, b: number | undefined): number {
  return Math.abs((a ?? 0) - (b ?? 0));
}

/** Vertical distance in whole hexes (each 10 ft = 1 hex). */
export function elevationGapHexes(a: number | undefined, b: number | undefined): number {
  return Math.floor(elevationGapFeet(a, b) / 10);
}

export const HEX_DIRS = [
  { q: 1, r: 0, s: -1 },
  { q: 0, r: 1, s: -1 },
  { q: -1, r: 1, s: 0 },
  { q: -1, r: 0, s: 1 },
  { q: 0, r: -1, s: 1 },
  { q: 1, r: -1, s: 0 },
];

/** All hexes exactly at `radius` hexes from `center` (a hexagonal ring). */
export function hexRing(center: Hex, radius: number): Hex[] {
  const results: Hex[] = [];
  if (radius <= 0) return results;
  const add = (a: Hex, b: { q: number; r: number; s: number }): Hex => ({ q: a.q + b.q, r: a.r + b.r, s: a.s + b.s });
  let hex = add(center, { q: HEX_DIRS[4].q * radius, r: HEX_DIRS[4].r * radius, s: HEX_DIRS[4].s * radius });
  for (let i = 0; i < 6; i++) {
    for (let j = 0; j < radius; j++) {
      results.push(hex);
      hex = add(hex, HEX_DIRS[i]);
    }
  }
  return results;
}

export function computeOccupiedHexes(allUnits: Unit[], excludeUnitId?: string): Set<string> {
  return new Set(
    allUnits
      .filter(u => isUnitInteractable(u) && u.id !== excludeUnitId)
      .map(u => `${u.hex.q},${u.hex.r}`),
  );
}

export function computeThreatHexes(allUnits: Unit[], draggedUnitId: string, alliances: Record<string, AllianceGroup>, formationsMap: Record<string, Formation>): Set<string> {
  const draggedUnit = allUnits.find(u => u.id === draggedUnitId);
  const draggedGroup = alliances[draggedUnit?.team ?? ''] || 'friendly';
  const draggedElevation = draggedUnit?.elevation ?? 0;
  const occupied = computeOccupiedHexes(allUnits);
  const threats = new Set<string>();
  for (const unit of allUnits) {
    if (unit.isDeleted || unit.hidden || unit.id === draggedUnitId || unit.attachedToUnitId || unit.isHero || isUnitRouted(unit) || isDeadCorpse(unit)) continue;
    const unitGroup = alliances[unit.team] || 'friendly';
    if (unitGroup === draggedGroup) continue;
    // Kill zones only reach 10 ft vertically: a flyer ignores ground ZoC, and a
    // flyer higher than 10 ft above the mover exerts none.
    if (elevationGapFeet(unit.elevation, draggedElevation) > 10) continue;
    for (const dir of HEX_DIRS) {
      const nq = unit.hex.q + dir.q;
      const nr = unit.hex.r + dir.r;
      const key = `${nq},${nr}`;
      if (occupied.has(key)) continue;
      const pos = determineCombatPosition({ q: nq, r: nr, s: -nq - nr }, unit.hex, unit.facing);
      // Only formations with a zone of control in this arc stop enemy movement.
      if (canStopEnemyMovement(formationsMap[unit.currentFormation], pos)) threats.add(key);
    }
  }
  return threats;
}
