// src/components/ScenarioMap/mapGeometry.ts
// Map constants + hex/token geometry shared by the canvas draw hook and the map.
import { Unit, Hex, AllianceGroup, Formation, getOrganizationLevel } from '@/types/gameProtocol';
import { determineCombatPosition } from '@/lib/unitCombat';
import { canStopEnemyMovement } from '@/lib/formationRules';
import { isUnitInteractable, isDeadCorpse } from '@/lib/unitInteractions';
import { isUnitRouted } from '@/lib/unitMorale';
import { isHostile } from '@/lib/alliances';
import { Walls, crossingCost, blockedStep, wallBetween, edgeRef, directionBetween } from '@/lib/walls';
import { MapStructures, structureBlocksOrg, zoneBlocksOrg, structureHexEntryCost, structureHexBlocked, structureClimbCostBetween, hexStructureAt, structureDoorState, structureSurfaceAt } from '@/lib/mapStructures';
import { StructureTemplate } from '@/types/structure';
import { GroundEffect } from '@/types/gameProtocol';
import { HEX_DIRS } from '@/lib/hexGeometry';
export { HEX_DIRS };
import { modifierAmount } from '@/lib/effectTemplates';
import type { CostOfHexFn, BlockedEdgeFn } from '@/lib/moveCost';

// Re-export the elevation/flying helpers so existing importers keep working
// (the canonical implementations live in src/lib/flying.ts).
import { elevationOffset, elevationGapFeet, elevationGapHexes, airOccupiedHexes, canFly, isAirborne, verticalGapDown } from '@/lib/flying';
export { elevationOffset, elevationGapFeet, elevationGapHexes, airOccupiedHexes, canFly, isAirborne, verticalGapDown };

// Re-export the shared hex/token geometry (canonical: src/lib/hexGeometry.ts and
// src/lib/heroLayout.ts) so existing map importers keep working.
export { HEX_SIZE } from '@/lib/hexGeometry';
export { TOKEN_WIDTH, TOKEN_HEIGHT, getAttachedHeroPos, getHeroSquareSize } from '@/lib/heroLayout';

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
  /** The mover ignores climb cost (`ignore_climb` effect). */
  waiveClimb?: boolean;
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
    let base: number | undefined;
    if (walls && fromQ !== undefined && fromR !== undefined) {
      const wc = crossingCost(walls, { q: fromQ, r: fromR }, { q, r }, !!opts.isMounted);
      if (wc !== undefined) base = wc;
    }
    if (base === undefined) {
      const hc = structureHexEntryCost({ q, r }, opts.structures, opts.templates, !!opts.isMounted);
      const tc = terrainCostOf(terrain, q, r);
      // "Higher of the two": a hex structure's entry MP and terrain both apply.
      // A hard block (negative structure MP) is handled by the blocked-edge
      // predicate, not here.
      base = hc !== undefined ? Math.max(hc, tc) : tc;
    }
    // Climb (dynamic ground + edge-structure height): entering a higher surface or
    // crossing a tall wall costs MP; an `ignore_climb` effect (or a passable door)
    // waives it. The base step cost still applies — the higher of the two wins.
    if (fromQ !== undefined && fromR !== undefined) {
      const climb = structureClimbCostBetween({ q: fromQ, r: fromR }, { q, r }, opts.structures, opts.templates, !!opts.waiveClimb);
      if (climb > base) base = climb;
    }
    return base;
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
  /** The mover ignores climb cost (`ignore_climb` effect) — lifts the mounted climb block. */
  waiveClimb?: boolean;
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
  const { structures, templates, isMounted, waiveClimb, ignoreBlocks } = opts;
  if (ignoreBlocks) return undefined;
  const hasWalls = !!walls && Object.keys(walls).length > 0;
  const hasStructs = !!structures && Object.keys(structures).length > 0;
  if (!hasWalls && !hasStructs) return undefined;
  return (fromQ, fromR, toQ, toR) => {
    if (walls && blockedStep(walls, fromQ, fromR, toQ, toR, !!isMounted)) return true;
    if (structures && structureHexBlocked({ q: toQ, r: toR }, structures, templates, !!isMounted)) return true;
    // Mounted units cannot climb: block entering a higher-surface hex.
    if (isMounted && structures && structureClimbCostBetween({ q: fromQ, r: fromR }, { q: toQ, r: toR }, structures, templates, !!waiveClimb) > 0) return true;
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

/** Corpses (HP <= 0) sort first so live tokens stacked on their hex render on top. */
export const corpseLast = (a: Unit, b: Unit) =>
  ((a.currentUnitHp ?? 0) <= 0 ? 0 : 1) - ((b.currentUnitHp ?? 0) <= 0 ? 0 : 1);

/** Token draw order: corpses first, then live tokens by ELEVATION ascending, so an
 *  airborne unit stacked on a ground unit paints above it. */
export const tokenDrawOrder = (a: Unit, b: Unit) =>
  corpseLast(a, b) || ((a.elevation ?? 0) - (b.elevation ?? 0));

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

/** Hexes occupied at a given SURFACE (dynamic ground). A move on surface `S` is
 *  blocked only by units standing at exactly `S` (default 0 = bare ground). Airborne
 *  units (higher than the surface) live on the air layer (`airOccupiedHexes`), so a
 *  ground unit may enter a hex beneath a flyer / under a platform garrison. */
export function computeOccupiedHexes(allUnits: Unit[], excludeUnitId?: string, surface = 0): Set<string> {
  return new Set(
    allUnits
      .filter(u => isUnitInteractable(u) && u.id !== excludeUnitId && (u.elevation ?? 0) === surface)
      .map(u => `${u.hex.q},${u.hex.r}`),
  );
}

export function computeThreatHexes(
  allUnits: Unit[],
  draggedUnitId: string,
  alliances: Record<string, AllianceGroup>,
  formationsMap: Record<string, Formation>,
  structures?: MapStructures,
  templates?: Record<string, StructureTemplate>,
): Set<string> {
  const draggedUnit = allUnits.find(u => u.id === draggedUnitId);
  const moverElev = draggedUnit?.elevation ?? 0;
  // Walkable surface of a hex (0 without structures). Used to evaluate each
  // DESTINATION at its own elevation (a grounded unit stepping onto a structure
  // is threatened by hostiles up there, not at its origin elevation).
  const surfaceOf = (h: Hex) => (structures ? structureSurfaceAt(h, structures, templates ?? {}) : 0);
  const moverAirborne = !!draggedUnit && isAirborne(moverElev, surfaceOf(draggedUnit.hex));
  // Elevation a unit standing on `h` would occupy: an airborne mover keeps its
  // flight altitude; a grounded mover stands on the hex's surface (falling back
  // to its own elevation when no structures are provided).
  const destElevOf = (h: Hex) => (moverAirborne ? moverElev : structures ? surfaceOf(h) : moverElev);

  // A flyer's vertical ZoC is only drawn when a hostile unit is actually under it.
  const hostileUnder = (flyer: Unit): boolean => {
    const fe = flyer.elevation ?? 0;
    return allUnits.some(v => {
      if (v.id === flyer.id || v.isDeleted || isDeadCorpse(v)) return false;
      if (v.hex.q !== flyer.hex.q || v.hex.r !== flyer.hex.r) return false;
      if (!isHostile(v.team, flyer.team, alliances)) return false;
      return verticalGapDown(fe, v.elevation);
    });
  };

  const threats = new Set<string>();
  for (const unit of allUnits) {
    if (unit.isDeleted || unit.hidden || unit.id === draggedUnitId || unit.attachedToUnitId || unit.isHero || isUnitRouted(unit) || isDeadCorpse(unit)) continue;
    if (!draggedUnit || !isHostile(unit.team, draggedUnit.team, alliances)) continue;
    const unitElev = unit.elevation ?? 0;

    // Horizontal ZoC: the two front hexes, at the destination's elevation.
    for (const dir of HEX_DIRS) {
      const H = { q: unit.hex.q + dir.q, r: unit.hex.r + dir.r, s: 0 };
      H.s = -H.q - H.r;
      const pos = determineCombatPosition(H, unit.hex, unit.facing);
      if (pos !== 'front') continue;
      if (!canStopEnemyMovement(formationsMap[unit.currentFormation], pos)) continue;
      const destElev = destElevOf(H);
      if (unitElev !== destElev) continue;
      const key = `${H.q},${H.r}`;
      if (computeOccupiedHexes(allUnits, draggedUnitId, destElev).has(key)) continue;
      threats.add(key);
    }

    // Vertical ZoC: an actually-airborne FORMED flyer dominates its own hex 1..10
    // ft below — facing-independent — but only when a hostile is actually under.
    if ((unit.flySpeed ?? 0) > 0 && isAirborne(unitElev, surfaceOf(unit.hex)) && getOrganizationLevel(unit.currentFormation) > 0) {
      const H = unit.hex;
      if (verticalGapDown(unitElev, destElevOf(H)) && hostileUnder(unit)) threats.add(`${H.q},${H.r}`);
    }
  }
  return threats;
}
