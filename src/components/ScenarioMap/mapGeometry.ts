// src/components/ScenarioMap/mapGeometry.ts
// Map constants + hex/token geometry shared by the canvas draw hook and the map.
import { Unit, Hex, AllianceGroup, Formation } from '@/types/gameProtocol';
import { hexToPixel } from '@/hooks/useHexGrid';
import { determineCombatPosition } from '@/lib/unitCombat';
import { canStopEnemyMovement } from '@/lib/formationRules';
import { isUnitInteractable, isDeadCorpse } from '@/lib/unitInteractions';
import { isUnitRouted } from '@/lib/unitMorale';
import { Walls, crossingCost, blockedStep, wallBetween, edgeRef, directionBetween } from '@/lib/walls';
import { MapStructures, structureBlocksOrg, zoneBlocksOrg, structureHexEntryCost, structureHexBlocked } from '@/lib/mapStructures';
import { StructureTemplate } from '@/types/structure';
import { GroundEffect } from '@/types/gameProtocol';
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
    if (hc !== undefined) return hc;
    return terrainCostOf(terrain, q, r);
  };
}

/** Optional extra movement gates beyond wall `block`. */
export interface BlockEdgeOpts {
  /** Placed structures (edge `enter_org_max` gates + hex structure gates). */
  structures?: MapStructures;
  templates?: Record<string, StructureTemplate>;
  /** Ground zones (a `enter_org_max` zone blocks entry for over-level movers). */
  zones?: GroundEffect[];
  /** The moving unit's organization level — enables the `enter_org_max` gate. */
  orgLevel?: number;
  /** Locomotion for locomotion-specific blocks (negative MP faces / hex). */
  isMounted?: boolean;
  /** Free move / DM override: ignore every hard block. */
  ignoreBlocks?: boolean;
}

/**
 * Impassable-edge predicate for the movement BFS (undefined when nothing can
 * block). Hard blocks (negative MP, standing doors, wall `block`) always block;
 * when `orgLevel` is provided, a structure on the crossed edge / destination hex
 * or a ground zone there with an `enter_org_max` modifier blocks movers above the
 * allowed organization level. `ignoreBlocks` disables the whole predicate.
 */
export function makeBlockedEdge(walls: Walls | null | undefined, opts: BlockEdgeOpts = {}): BlockedEdgeFn | undefined {
  const { structures, templates, zones, orgLevel, isMounted, ignoreBlocks } = opts;
  if (ignoreBlocks) return undefined;
  const hasWalls = !!walls && Object.keys(walls).length > 0;
  const hasExtra = (!!structures && Object.keys(structures).length > 0) || (!!zones && zones.length > 0);
  if (!hasWalls && !hasExtra) return undefined;
  return (fromQ, fromR, toQ, toR) => {
    if (walls && blockedStep(walls, fromQ, fromR, toQ, toR, !!isMounted)) return true;
    if (structures) {
      if (structureHexBlocked({ q: toQ, r: toR }, structures, templates, !!isMounted)) return true;
    }
    if (orgLevel === undefined) return false;
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
    return false;
  };
}

export interface ChargeBlockOpts {
  structures?: MapStructures;
  templates?: Record<string, StructureTemplate>;
  isMounted?: boolean;
}

/**
 * Charges are blocked by any barrier that isn't a low (1 MP) passable structure:
 * any wall edge whose crossing costs 2+ MP (or is a hard block / standing door),
 * and any hex structure entered at 2+ MP. Quote: "any hex with MP cost 2+ will
 * disable charge".
 */
export function makeChargeBlockedEdge(walls: Walls | null | undefined, opts: ChargeBlockOpts = {}): BlockedEdgeFn | undefined {
  const { structures, templates, isMounted } = opts;
  const hasWalls = !!walls && Object.keys(walls).length > 0;
  const hasStructs = !!structures && Object.keys(structures).length > 0;
  if (!hasWalls && !hasStructs) return undefined;
  return (fromQ, fromR, toQ, toR) => {
    if (walls) {
      const hit = wallBetween(walls, { q: fromQ, r: fromR }, { q: toQ, r: toR });
      if (hit) {
        if (hit.wall.source === 'effect') return true; // magic walls always stop charges
        const cost = isMounted ? hit.faceTo.moveCostMounted : hit.faceTo.moveCostFoot;
        const doorStanding = hit.wall.doorHp !== undefined && hit.wall.doorHp > 0 && !hit.wall.open;
        if (hit.faceFrom.block || doorStanding) return true;
        if (cost === undefined || cost < 0 || cost >= 2) return true;
      }
    }
    const hc = structureHexEntryCost({ q: toQ, r: toR }, structures, templates, !!isMounted);
    if (hc !== undefined && hc >= 2) return true;
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

export interface MapBackgroundConfig {
  imageUrl: string;
  offsetX: number;
  offsetY: number;
  scale: number;
  gridRadius: number;
}

/** Pixel offset of an attached hero token around its host's hex. */
export function getAttachedHeroPos(unitHex: { q: number; r: number; s: number }, facing: number, attachedPosition: 'front' | 'back' | null = 'front') {
  const pos = hexToPixel(unitHex, HEX_SIZE);
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
  const occupied = computeOccupiedHexes(allUnits);
  const threats = new Set<string>();
  for (const unit of allUnits) {
    if (unit.isDeleted || unit.id === draggedUnitId || unit.attachedToUnitId || unit.isHero || isUnitRouted(unit) || isDeadCorpse(unit)) continue;
    const unitGroup = alliances[unit.team] || 'friendly';
    if (unitGroup === draggedGroup) continue;
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
