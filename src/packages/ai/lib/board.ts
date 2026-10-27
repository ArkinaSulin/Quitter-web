// src/packages/ai/lib/board.ts
// Shared board model for the Basic AI: archetype detection, per-unit movement
// context, pathfinding, destination safety and facing/ZoC helpers. Everything
// here is pure and mirrors the real movement/combat rules used by the executor.
import { Unit, Hex, Formation, AllianceGroup, hexDistance, getOrganizationLevel } from '@/types/gameProtocol';
import { parseWeapons } from '@/packages/units';
import { isMeleeWeapon } from '@/packages/combat';
import { HEX_DIRS, rotateLeft, rotateRight, facingToward, arcOfTarget, allianceOf as teamAllianceOf } from '@/packages/primitives';
import { isUnitRouted, imposesKillZone } from '@/packages/morale';
import { isProtectedHero } from '@/packages/units';
import {
  applyFormationChange,
  applyMpSpend,
  canAdoptFormation,
  computeMovePool,
  computeReachableMap,
  doorPassThroughHexes,
  entryBreakFormation,
  formationOrgLevels,
  loosePassThroughHexes,
  MapStructures,
  OrgMoveOpts,
  structureSurfaceAt,
  unitStandingSurface,
  isAirborne,
  canFly,
  flyMax,
  moveBudgetUnit,
  CostOfHexFn,
  BlockedEdgeFn,
  Walls,
  edgeRef,
  isHexStructureKey,
  structureDoorState,
  structureElevation,
  structureHexBlocked,
  structureEdgeBlocked,
  structureClimbCostBetween,
} from '@/packages/movement';
import { computeOccupiedHexes, computeThreatHexes, makeBlockedEdge, makeCostOfHex, TerrainCosts } from '@/packages/world';
import { StructureTemplate } from '@/types/structure';
import { unitIgnoresClimb } from '@/packages/effects';
import { AiArchetype, AiPlanContext } from './types';

export interface MovementContext {
  occupied: Set<string>;
  threat: Set<string>;
  passThrough: Set<string>;
  org: OrgMoveOpts;
  costOfHex?: CostOfHexFn;
  blockedEdge?: BlockedEdgeFn;
  surface: number;
  airborne: boolean;
}

export interface Maneuver {
  /** Ground or fly movement pool. */
  mode: 'ground' | 'fly';
  /** 60-degree rotations to perform before the move. */
  turns: { dir: 'left' | 'right' }[];
  /** Unit state after the rotations, before the move. */
  unit: Unit;
  dest: Hex;
  path: Hex[];
  cost: number;
  facing: number;
}

export function hexKeyOf(hex: { q: number; r: number }): string {
  return `${hex.q},${hex.r}`;
}

export function allianceOf(unit: Pick<Unit, 'team'>, alliances: Record<string, AllianceGroup>): AllianceGroup {
  return teamAllianceOf(unit.team, alliances);
}

export function enemyGroupsOf(group: AllianceGroup): Set<AllianceGroup> {
  if (group === 'friendly') return new Set<AllianceGroup>(['enemy']);
  if (group === 'enemy') return new Set<AllianceGroup>(['friendly']);
  return new Set<AllianceGroup>();
}

export function isMounted(unit: Pick<Unit, 'mountId' | 'mountName'>): boolean {
  return !!unit.mountId || !!unit.mountName;
}

export function isFlying(unit: Unit): boolean {
  return canFly(unit);
}

export function primaryWeapon(unit: Unit) {
  return parseWeapons(unit.weaponString || '')[0];
}

export function primaryMaxRange(unit: Unit): number {
  const w = primaryWeapon(unit);
  if (!w) return 1;
  return Math.max(w.range ?? 1, w.maxRange ?? (w.range ?? 1));
}

/** Archetype precedence: flying -> mounted -> ranged -> melee. */
export function archetypeOf(unit: Unit): AiArchetype {
  if (isFlying(unit)) return 'flying';
  if (isMounted(unit)) return 'mounted';
  if (primaryMaxRange(unit) > 1) return 'ranged';
  return 'melee';
}

export function effectiveMax(unit: Pick<Unit, 'movementPoints' | 'currentFormation'>, formations: Record<string, Formation>): number {
  const mult = formations[unit.currentFormation]?.movement_multiplier ?? 1;
  return Math.max(1, Math.floor((unit.movementPoints ?? 0) * mult));
}

export function isLoose(unit: Pick<Unit, 'isHero' | 'currentFormation' | 'isCharging'>, formations: Record<string, Formation>): boolean {
  if (unit.isHero || unit.isCharging) return true;
  const form = formations[unit.currentFormation];
  return getOrganizationLevel(unit.currentFormation) === 0 || (form?.organization_level ?? 0) === 0;
}

export function surfaceAt(hex: Hex, ctx: Pick<AiPlanContext, 'structures' | 'structureTemplates'>): number {
  return structureSurfaceAt(hex, ctx.structures, ctx.structureTemplates);
}

export function unitSurface(unit: Unit, ctx: Pick<AiPlanContext, 'structures' | 'structureTemplates'>): number {
  return unitStandingSurface(unit, ctx.structures, ctx.structureTemplates);
}

export function unitIsAirborne(unit: Unit, ctx: Pick<AiPlanContext, 'structures' | 'structureTemplates'>): boolean {
  return isAirborne(unit.elevation, unitSurface(unit, ctx));
}

/** A non-flying unit's bounded home: a connected building floor or a walled
 *  courtyard. Movement may never cross its perimeter. */
export interface StructureComplex {
  kind: 'footprint' | 'enclosure';
  hexes: Set<string>;
}

function ringOf(hex: Hex): number {
  return Math.max(Math.abs(hex.q), Math.abs(hex.r), Math.abs(hex.q + hex.r));
}

/**
 * The structure complex a non-flying unit must stay inside, or null.
 *  - A unit standing on a hex structure is confined to the connected
 *    hex-structure footprint (building floors).
 *  - Otherwise, a unit inside an area fully bounded by edge structures is
 *    confined to that enclosed region. Any edge structure counts as the
 *    perimeter, including open/broken doors and gates.
 *  - A flood fill that reaches the map's outer ring is not enclosed.
 * Flyers are handled by the caller (never confined).
 */
export function structureComplexFor(
  unit: Pick<Unit, 'hex'>,
  ctx: Pick<AiPlanContext, 'structures' | 'structureTemplates' | 'gridRadius'>,
): StructureComplex | null {
  const structures = ctx.structures;
  if (!structures) return null;
  const start = hexKeyOf(unit.hex);

  // 1) Connected hex-structure footprint.
  if (isHexStructureKey(start) && structures[start]) {
    const hexes = new Set<string>([start]);
    const queue: Hex[] = [unit.hex];
    while (queue.length > 0) {
      const cur = queue.pop()!;
      for (const dir of HEX_DIRS) {
        const next = { q: cur.q + dir.q, r: cur.r + dir.r, s: -cur.q - dir.q - cur.r - dir.r };
        const key = hexKeyOf(next);
        if (hexes.has(key)) continue;
        if (!isHexStructureKey(key) || !structures[key]) continue;
        hexes.add(key);
        queue.push(next);
      }
    }
    return { kind: 'footprint', hexes };
  }

  // 2) Edge-wall enclosure (a walled courtyard). Any edge structure is a
  //    perimeter, regardless of door state.
  const maxRing = Math.max(6, ctx.gridRadius ?? 20);
  const hexes = new Set<string>([start]);
  const queue: Hex[] = [unit.hex];
  let reachedRim = false;
  while (queue.length > 0) {
    const cur = queue.pop()!;
    if (ringOf(cur) >= maxRing) { reachedRim = true; break; }
    for (let dir = 0; dir < 6; dir++) {
      const d = HEX_DIRS[dir];
      const next = { q: cur.q + d.q, r: cur.r + d.r, s: -cur.q - d.q - cur.r - d.r };
      const key = hexKeyOf(next);
      if (hexes.has(key)) continue;
      if (isHexStructureKey(key) && structures[key]) continue; // hex-structure perimeter
      if (structures[edgeRef(cur.q, cur.r, dir).key]) continue; // perimeter
      hexes.add(key);
      queue.push(next);
    }
  }
  return reachedRim ? null : { kind: 'enclosure', hexes };
}

/** A climbable edge wall between two level hexes (no open door/broken gate). */
export interface EdgeWall {
  a: Hex;
  b: Hex;
  height: number;
  steps: number;
}

/**
 * A wall on an edge shared with a hex structure is redundant for AI pathing:
 * the structure tile itself is the obstacle. Its stats still apply if a climb
 * crosses that edge (the movement climb profile owns that).
 */
export function edgeWallRedundantWithStructure(
  ref: { aq: number; ar: number; bq: number; br: number },
  ctx: Pick<AiPlanContext, 'structures'>,
): boolean {
  return !!ctx.structures?.[`${ref.aq},${ref.ar}`] || !!ctx.structures?.[`${ref.bq},${ref.br}`];
}

/**
 * Every closed edge wall in the scenario. The planner filters these by side,
 * reachability and affordability before planning a climb-over.
 */
export function edgeWalls(ctx: Pick<AiPlanContext, 'structures' | 'structureTemplates'>): EdgeWall[] {
  const structures = ctx.structures;
  if (!structures) return [];
  const templates = ctx.structureTemplates;
  const out: EdgeWall[] = [];
  for (const [key, inst] of Object.entries(structures)) {
    const parts = key.split(',').map(Number);
    if (parts.length !== 3) continue;
    const [q, r, dir] = parts;
    if (![q, r, dir].every(Number.isInteger) || dir < 0 || dir > 5) continue;
    const template = templates?.[inst.templateId];
    if (!template || template.anchor !== 'edge') continue;
    if (structureDoorState(inst, template).openOrBroken) continue;
    const height = structureElevation(template, inst);
    if (height <= 0) continue;
    const ref = edgeRef(q, r, dir);
    if (edgeWallRedundantWithStructure(ref, ctx)) continue;
    out.push({
      a: { q: ref.aq, r: ref.ar, s: -ref.aq - ref.ar },
      b: { q: ref.bq, r: ref.br, s: -ref.bq - ref.br },
      height,
      steps: Math.max(1, Math.round(height / 10)),
    });
  }
  return out;
}

/**
 * Ground distance map that treats every closed edge structure as impassable.
 * Used only to decide whether a target truly needs a climb-over: the normal
 * movement map prices a climb as MP and may therefore look "reachable".
 */
export function noClimbDistanceMap(
  unit: Unit,
  working: Unit[],
  ctx: AiPlanContext,
  mode: 'ground' | 'fly' = 'ground',
  complex?: StructureComplex | null,
): Map<string, number> {
  const movement = movementContextFor(unit, working, ctx, mode, complex);
  const base = movement.blockedEdge;
  const blockedEdge: BlockedEdgeFn = (fq, fr, tq, tr) => {
    const dir = HEX_DIRS.findIndex(d => d.q === tq - fq && d.r === tr - fr);
    if (dir >= 0) {
      const ref = edgeRef(fq, fr, dir);
      const inst = ctx.structures?.[ref.key];
      const template = inst ? ctx.structureTemplates?.[inst.templateId] : undefined;
      if (inst && template && !edgeWallRedundantWithStructure(ref, ctx) && !structureDoorState(inst, template).openOrBroken) return true;
    }
    return base?.(fq, fr, tq, tr) ?? false;
  };
  return distanceMap(unit, { ...ctx, units: working }, mode, { ...movement, blockedEdge });
}

/** Living, visible, adversarial units (heroes excluded, matching legalTargets). */
export function enemyPool(ctx: AiPlanContext, working: Unit[]): Unit[] {
  if (!ctx.activeAlliance) return [];
  const groups = enemyGroupsOf(ctx.activeAlliance);
  return working.filter(u =>
    !u.isDeleted && !u.hidden && (u.currentUnitHp ?? 0) > 0
    && !isProtectedHero(u)
    && groups.has(allianceOf(u, ctx.alliances)));
}

/** Ground / structure / grounded-flyer targets a melee or mounted unit can reach. */
export function isGroundTarget(unit: Unit, ctx: Pick<AiPlanContext, 'structures' | 'structureTemplates'>): boolean {
  return !isAirborne(unit.elevation, surfaceAt(unit.hex, ctx));
}

export function movementContextFor(
  unit: Unit,
  working: Unit[],
  ctx: AiPlanContext,
  mode: 'ground' | 'fly' = 'ground',
  complex?: StructureComplex | null,
): MovementContext {
  const structures = ctx.structures;
  const templates = ctx.structureTemplates;
  const zones = ctx.groundZones;
  const mounted = isMounted(unit);
  const waiveClimb = unitIgnoresClimb(unit, zones);
  const surface = unitSurface(unit, ctx);
  const airborne = mode === 'fly' || isAirborne(unit.elevation, surface);
  const visible = working.filter(w => !w.hidden);
  // Airborne movers occupy the single air slot; ground movers occupy the ground slot.
  const occupied = computeOccupiedHexes(visible, unit.id, airborne ? Math.max(1, surface) : surface);
  const threat = computeThreatHexes(visible, unit.id, ctx.alliances, ctx.formations, structures, templates);
  const passThrough = new Set<string>(Array.from(doorPassThroughHexes(structures, templates, occupied)));
  for (const k of Array.from(loosePassThroughHexes(visible, unit, ctx.formations, ctx.alliances, airborne ? 'fly' : 'ground', surface))) {
    passThrough.add(k);
  }
  const movementMultipliers: Record<string, number> = {};
  for (const [name, f] of Object.entries(ctx.formations)) movementMultipliers[name] = f.movement_multiplier;
  const costOfHex = makeCostOfHex(ctx.terrainCosts ?? null, ctx.walls, {
    structures, templates, isMounted: mounted, waiveClimb,
  });
  const rawBlockedEdge = makeBlockedEdge(ctx.walls, {
    structures, templates, zones, isMounted: mounted, waiveClimb,
  });
  // A wall sharing a hex-structure edge is redundant for AI pathing: the
  // structure tile owns that crossing. Skip the wall's block but keep the real
  // structure block/mounted rules and all walk/climb costs.
  const pathBlockedEdge = (fq: number, fr: number, tq: number, tr: number): boolean => {
    const dir = HEX_DIRS.findIndex(d => d.q === tq - fq && d.r === tr - fr);
    if (dir >= 0) {
      const ref = edgeRef(fq, fr, dir);
      if (edgeWallRedundantWithStructure(ref, ctx)) {
        if (structures && structureHexBlocked({ q: tq, r: tr }, structures, templates, mounted)) return true;
        if (structures && structureEdgeBlocked({ q: fq, r: fr }, { q: tq, r: tr }, structures, templates, mounted)) return true;
        if (mounted && structures && structureClimbCostBetween({ q: fq, r: fr }, { q: tq, r: tr }, structures, templates, false, true) > 0) return true;
        return false;
      }
    }
    return rawBlockedEdge?.(fq, fr, tq, tr) ?? false;
  };
  // A complex perimeter is impassable in both directions, even through an open
  // door/gate. Interior edges keep the normal wall/structure rules.
  const blockedEdge = complex
    ? (fq: number, fr: number, tq: number, tr: number) => {
        const fromIn = complex.hexes.has(`${fq},${fr}`);
        const toIn = complex.hexes.has(`${tq},${tr}`);
        if (fromIn !== toIn) return true;
        return pathBlockedEdge(fq, fr, tq, tr);
      }
    : pathBlockedEdge;
  const org: OrgMoveOpts = {
    movementMultipliers,
    orgLevels: formationOrgLevels(ctx.formations),
    breakOnEntry: (fq, fr, tq, tr, formation) =>
      entryBreakFormation({ q: fq, r: fr }, { q: tq, r: tr }, formation, structures, templates, zones),
  };
  return { occupied, threat, passThrough, org, costOfHex, blockedEdge, surface, airborne };
}

/**
 * Cost of every hex reachable by a mover, ignoring facing. Used for target
 * reachability and approach-distance decisions. Threat hexes may not be passed
 * through (a move onto one stops there).
 */
export function distanceMap(
  unit: Unit,
  ctx: AiPlanContext,
  mode: 'ground' | 'fly' = 'ground',
  movement?: MovementContext,
): Map<string, number> {
  const m = movement ?? movementContextFor(unit, ctx.units, ctx, mode);
  const out = new Map<string, number>();
  const start = hexKeyOf(unit.hex);
  out.set(start, 0);
  const maxHops = Math.max(24, (ctx.gridRadius ?? 20) * 3);
  const queue: { hex: Hex; cost: number; hops: number }[] = [{ hex: unit.hex, cost: 0, hops: 0 }];
  const blocked = (k: string) => m.occupied.has(k) && !m.passThrough.has(k);
  while (queue.length > 0) {
    let best = 0;
    for (let i = 1; i < queue.length; i++) if (queue[i].cost < queue[best].cost) best = i;
    const cur = queue.splice(best, 1)[0];
    if ((out.get(hexKeyOf(cur.hex)) ?? Infinity) < cur.cost) continue;
    if (cur.cost > 0 && m.threat.has(hexKeyOf(cur.hex))) continue;
    if (cur.hops >= maxHops) continue;
    for (const dir of HEX_DIRS) {
      const next = { q: cur.hex.q + dir.q, r: cur.hex.r + dir.r, s: -cur.hex.q - dir.q - cur.hex.r - dir.r };
      const k = hexKeyOf(next);
      if (blocked(k)) continue;
      if (mode !== 'fly' && m.blockedEdge && m.blockedEdge(cur.hex.q, cur.hex.r, next.q, next.r)) continue;
      const raw = mode === 'fly' ? 1 : (m.costOfHex?.(next.q, next.r, cur.hex.q, cur.hex.r) ?? 1);
      if (!Number.isFinite(raw) || raw < 0) continue;
      const step = Math.max(0, Math.round(raw));
      const cost = cur.cost + step;
      if (cost < (out.get(k) ?? Infinity)) {
        out.set(k, cost);
        queue.push({ hex: next, cost, hops: cur.hops + 1 });
      }
    }
  }
  return out;
}

/** Path cost from every reachable hex TO `target`, using the mover's movement
 *  rules (terrain, walls, structures, occupancy, pass-through). Used to score
 *  approaches by remaining path rather than straight-line distance. */
export function reverseDistanceMap(
  target: Hex,
  unit: Unit,
  ctx: AiPlanContext,
  mode: 'ground' | 'fly' = 'ground',
  movement?: MovementContext,
): Map<string, number> {
  return distanceMap({ ...unit, hex: target }, ctx, mode, movement);
}

/** Cheapest path cost to the target hex or one of its neighbours. `noStop`
 *  excludes pass-through hexes as stopping/adjacent points (they remain usable
 *  for traversal, just never as a destination). */
export function targetPathCost(map: Map<string, number>, target: Hex, noStop?: Set<string>): number {
  const targetKey = hexKeyOf(target);
  let best = noStop?.has(targetKey) ? Infinity : (map.get(targetKey) ?? Infinity);
  for (const dir of HEX_DIRS) {
    const k = `${target.q + dir.q},${target.r + dir.r}`;
    if (noStop?.has(k)) continue;
    best = Math.min(best, map.get(k) ?? Infinity);
  }
  return best;
}

export function isTargetReachable(map: Map<string, number>, target: Hex, noStop?: Set<string>): boolean {
  return Number.isFinite(targetPathCost(map, target, noStop));
}

/** True when `dest` puts an **adjacent** non-target hostile in our flank/rear.
 *  Only adjacent units can flank/rear-attack in melee; distant enemies never
 *  veto an approach. */
export function isFlankedAt(
  dest: Hex,
  facing: number,
  foes: Unit[],
  intendedTargetId: string | null,
): boolean {
  for (const foe of foes) {
    if (foe.id === intendedTargetId) continue;
    if (isUnitRouted(foe)) continue;
    if (hexDistance(dest, foe.hex) !== 1) continue;
    const arc = arcOfTarget(dest, facing, foe.hex);
    if (arc === 'flank' || arc === 'rear') return true;
  }
  return false;
}

/**
 * An outer-rim approach hex: empty, adjacent to `target`, and touching **at most
 * one other enemy** (target excluded). Used for mounted staging/landing so the
 * cavalry stays on the formation's outside instead of charging into its middle.
 */
export function isOuterApproachHex(
  hex: Hex,
  target: Unit,
  occupied: Set<string>,
  foes: Unit[],
): boolean {
  if (occupied.has(hexKeyOf(hex))) return false;
  let otherFoes = 0;
  for (const foe of foes) {
    if (foe.id === target.id || foe.isDeleted || foe.hidden || foe.attachedToUnitId) continue;
    if (hexDistance(hex, foe.hex) === 1) otherFoes++;
    if (otherFoes > 1) return false;
  }
  return true;
}

/** A target is on the hostile formation's outer rim when it has an outer-rim approach hex. */
export function isOuterRimTarget(target: Unit, occupied: Set<string>, foes: Unit[]): boolean {
  for (const dir of HEX_DIRS) {
    const h = { q: target.hex.q + dir.q, r: target.hex.r + dir.r, s: -target.hex.q - dir.q - target.hex.r - dir.r };
    if (isOuterApproachHex(h, target, occupied, foes)) return true;
  }
  return false;
}

/** Is `hostile` inside the kill zone (ZoC) of any friendly unit? */
export function isInFriendlyKillZone(
  hostile: Unit,
  self: Unit,
  units: Unit[],
  ctx: Pick<AiPlanContext, 'alliances' | 'structures' | 'structureTemplates'>,
): boolean {
  const group = allianceOf(self, ctx.alliances);
  return units.some(f =>
    !f.isDeleted && !f.hidden && !f.attachedToUnitId && (f.currentUnitHp ?? 0) > 0
    && allianceOf(f, ctx.alliances) === group
    && imposesKillZone(f, hostile.hex, {
      targetElevation: hostile.elevation ?? 0,
      ownSurface: unitSurface(f, ctx),
      structures: ctx.structures,
      templates: ctx.structureTemplates,
    }),
  );
}

/** Hostiles whose current front arc / vertical domination covers `unit.hex`. */
export function zocSourcesAt(unit: Unit, foes: Unit[], ctx: Pick<AiPlanContext, 'structures' | 'structureTemplates'>): Unit[] {
  const targetElev = unit.elevation ?? 0;
  const ownSurface = surfaceAt(unit.hex, ctx);
  return foes.filter(foe =>
    imposesKillZone(foe, unit.hex, {
      targetElevation: targetElev,
      ownSurface,
      structures: ctx.structures,
      templates: ctx.structureTemplates,
      requireFormed: true,
    }));
}

/** Hostiles inside our front arc (our own ZoC), after a hypothetical rotation. */
export function ownZocCount(unit: Unit, facing: number, foes: Unit[], ctx: Pick<AiPlanContext, 'structures' | 'structureTemplates'>): number {
  const rotated = { ...unit, facing };
  const ownSurface = surfaceAt(unit.hex, ctx);
  let n = 0;
  for (const foe of foes) {
    if (isUnitRouted(foe)) continue;
    if (imposesKillZone(rotated, foe.hex, {
      targetElevation: foe.elevation ?? 0,
      ownSurface,
      structures: ctx.structures,
      templates: ctx.structureTemplates,
      requireFormed: true,
    })) n++;
  }
  return n;
}

export interface FacingChoice {
  facing: number;
  turns: { dir: 'left' | 'right' }[];
  unit: Unit;
}

function rotationPath(from: number, to: number): { dir: 'left' | 'right' }[] {
  const left: { dir: 'left' | 'right' }[] = [];
  let f = from;
  for (let i = 0; i < 6 && f !== to; i++) { left.push({ dir: 'left' }); f = rotateLeft(f); }
  const right: { dir: 'left' | 'right' }[] = [];
  f = from;
  for (let i = 0; i < 6 && f !== to; i++) { right.push({ dir: 'right' }); f = rotateRight(f); }
  return right.length < left.length ? right : left;
}

/** Apply a rotation sequence with the real MP/action accounting. */
export function applyTurns(
  unit: Unit,
  turns: { dir: 'left' | 'right' }[],
  ctx: Pick<AiPlanContext, 'formations'>,
): Unit | null {
  let current = unit;
  for (const turn of turns) {
    const free = isLoose(current, ctx.formations);
    if (free) {
      current = { ...current, facing: turn.dir === 'left' ? rotateLeft(current.facing) : rotateRight(current.facing) };
      continue;
    }
    const fly = canFly(current) && (current.elevation ?? 0) > 0;
    const applied = fly
      ? applyMpSpend({ movementPointsAvailable: current.flySpeedAvailable ?? 0, actionsAvailable: current.actionsAvailable }, 1, flyMax(current))
      : applyMpSpend(current, 1, effectiveMax(current, ctx.formations));
    if (applied.actionsAvailable < 0) return null;
    current = {
      ...current,
      facing: turn.dir === 'left' ? rotateLeft(current.facing) : rotateRight(current.facing),
      ...(fly
        ? { flySpeedAvailable: applied.movementPointsAvailable }
        : { movementPointsAvailable: applied.movementPointsAvailable }),
      actionsAvailable: applied.actionsAvailable,
    };
  }
  return current;
}

/**
 * Best facing against adjacent hostiles: minimise hostile ZoC sources in our
 * flank/rear, then maximise hostiles inside our own front arc (ZoC locked).
 */
export function chooseFacing(unit: Unit, foes: Unit[], ctx: AiPlanContext): FacingChoice {
  const sources = zocSourcesAt(unit, foes, ctx);
  let best: { facing: number; turns: { dir: 'left' | 'right' }[]; unit: Unit; score: number } | null = null;
  for (let facing = 0; facing < 6; facing++) {
    const turns = rotationPath(unit.facing, facing);
    const rotated = applyTurns(unit, turns, ctx);
    if (!rotated) continue;
    const flankRear = sources.filter(src => {
      const arc = arcOfTarget(unit.hex, facing, src.hex);
      return arc === 'flank' || arc === 'rear';
    }).length;
    const front = ownZocCount(unit, facing, foes, ctx);
    // Lower is better: flank/rear first, then more front, then fewer turns.
    const score = flankRear * 100 - front * 10 + turns.length;
    if (!best || score < best.score) best = { facing, turns, unit: rotated, score };
  }
  return best ?? { facing: unit.facing, turns: [], unit };
}

/** Highest available organization formation the unit can adopt next. */
export function nextFormationUpgrade(
  unit: Unit,
  ctx: Pick<AiPlanContext, 'formations'>,
): { formation: string; updated: Unit } | null {
  if (unit.isCharging || unit.climbTo) return null;
  const levels = formationOrgLevels(ctx.formations);
  const currentOrg = getOrganizationLevel(unit.currentFormation);
  const weapon = parseWeapons(unit.weaponString || '')[unit.activeWeaponIndex ?? 0] ?? parseWeapons(unit.weaponString || '')[0];
  let best: { formation: string; org: number } | null = null;
  for (const f of unit.formationAvailability ?? []) {
    if (f === unit.currentFormation) continue;
    const form = ctx.formations[f];
    if (!form) continue;
    if (!canAdoptFormation(unit.currentFormation, f)) continue;
    if (f === 'Shield Wall' && (!unit.isShielded || !!weapon?.isTwoHanded)) continue;
    const org = levels[f] ?? getOrganizationLevel(f);
    if (org <= currentOrg) continue;
    if (!best || org > best.org) best = { formation: f, org };
  }
  if (!best) return null;
  const oldMax = effectiveMax(unit, ctx.formations);
  if (unit.movementPointsAvailable < 0) return null;
  const newMax = effectiveMax({ ...unit, currentFormation: best.formation }, ctx.formations);
  const applied = applyFormationChange(unit, oldMax, newMax);
  if (applied.actionsAvailable < 0) return null;
  return {
    formation: best.formation,
    updated: {
      ...unit,
      currentFormation: best.formation,
      organizationLevel: getOrganizationLevel(best.formation),
      movementPointsAvailable: applied.movementPointsAvailable,
      actionsAvailable: applied.actionsAvailable,
    },
  };
}

export function isFullyUpgraded(unit: Unit, ctx: Pick<AiPlanContext, 'formations'>): boolean {
  const levels = formationOrgLevels(ctx.formations);
  const currentOrg = getOrganizationLevel(unit.currentFormation);
  const weapon = parseWeapons(unit.weaponString || '')[unit.activeWeaponIndex ?? 0] ?? parseWeapons(unit.weaponString || '')[0];
  const available = (unit.formationAvailability ?? [])
    .filter(f => ctx.formations[f])
    .filter(f => !(f === 'Shield Wall' && (!unit.isShielded || !!weapon?.isTwoHanded)))
    .map(f => levels[f] ?? getOrganizationLevel(f));
  // Walk the +1 organization chain exactly like repeated formation changes.
  let reachable = currentOrg;
  for (let guard = 0; guard < 4; guard++) {
    if (available.includes(reachable + 1)) reachable += 1;
    else break;
  }
  return currentOrg >= reachable;
}

/**
 * Enumerate cheap approach options: 0..maxTurns 60-degree rotations followed by
 * one movement pool. Mirrors the real movement pipeline (terrain, walls,
 * structures, doors, org breaks, reactive archery).
 */
export function maneuversFor(
  unit: Unit,
  working: Unit[],
  ctx: AiPlanContext,
  mode: 'ground' | 'fly' = 'ground',
  complex?: StructureComplex | null,
): Maneuver[] {
  const movement = movementContextFor(unit, working, ctx, mode, complex);
  const out: Maneuver[] = [];
  const poolOf = (u: Unit): number => {
    if (mode === 'fly') {
      return computeMovePool(moveBudgetUnit(u, 'fly'), flyMax(u));
    }
    return computeMovePool(u, effectiveMax(u, ctx.formations));
  };
  const reachUnit = (u: Unit) =>
    mode === 'fly' ? { ...u, movementPoints: flyMax(u), movementPointsAvailable: u.flySpeedAvailable ?? 0 } : u;

  const evaluate = (state: Unit, turns: { dir: 'left' | 'right' }[]) => {
    const pool = poolOf(state);
    out.push({ mode, turns: [...turns], unit: state, dest: state.hex, path: [], cost: 0, facing: state.facing });
    if (pool < 1) return;
    const reach = computeReachableMap(
      reachUnit(state), pool, movement.occupied, movement.threat,
      mode === 'fly' ? undefined : movement.costOfHex,
      false,
      mode === 'fly' ? undefined : movement.blockedEdge,
      undefined, movement.passThrough, movement.org, !!ctx.reactiveArchery, true,
    );
    reach.forEach((entry, key) => {
      if (entry.needsTurn) return;
      const dest = entry.path[entry.path.length - 1];
      if (!dest) return;
      out.push({
        mode,
        turns: [...turns],
        unit: state,
        dest,
        path: entry.path,
        cost: entry.cost,
        facing: entry.finalFacing,
      });
    });
  };

  // No artificial turn cap: a formed unit may face any of the six directions
  // (the shortest rotation is at most three 60-degree steps). Loose units move
  // omnidirectionally, so no turn is needed to choose a direction.
  if (isLoose(unit, ctx.formations)) {
    evaluate(unit, []);
  } else {
    for (let facing = 0; facing < 6; facing++) {
      const turns = rotationPath(unit.facing, facing);
      const turned = applyTurns(unit, turns, ctx);
      if (!turned) continue;
      evaluate(turned, turns);
    }
  }
  return out;
}

/** Apply a planned move to the simulated unit (real move accounting). */
export function applyManeuver(unit: Unit, maneuver: Maneuver, ctx: Pick<AiPlanContext, 'formations'>): Unit {
  let state = maneuver.unit;
  if (maneuver.path.length === 0) return state;
  if (maneuver.mode === 'fly') {
    const applied = applyMpSpend(
      { movementPointsAvailable: state.flySpeedAvailable ?? 0, actionsAvailable: state.actionsAvailable },
      maneuver.cost,
      flyMax(state),
    );
    return {
      ...state,
      hex: maneuver.dest,
      flySpeedAvailable: applied.movementPointsAvailable,
      actionsAvailable: applied.actionsAvailable,
    };
  }
  const pool = effectiveMax(state, ctx.formations);
  const mp = Math.max(0, Math.floor(state.movementPointsAvailable));
  const actions = state.actionsAvailable;
  const total = mp + Math.max(0, actions) * pool;
  if (maneuver.cost <= total) {
    const leftover = total - maneuver.cost;
    return {
      ...state,
      hex: maneuver.dest,
      movementPointsAvailable: leftover % pool,
      actionsAvailable: Math.floor(leftover / pool),
    };
  }
  const needed = maneuver.cost - mp;
  const actionsSpent = Math.ceil(needed / pool);
  const remainder = needed % pool;
  return {
    ...state,
    hex: maneuver.dest,
    movementPointsAvailable: remainder === 0 ? 0 : pool - remainder,
    actionsAvailable: actions - actionsSpent,
  };
}

export function facingTowardHex(from: Hex, to: Hex): number {
  return facingToward(from, to);
}

export function hexesWithin(center: Hex, foes: Unit[], radius: number): Unit[] {
  return foes.filter(f => hexDistance(center, f.hex) <= radius);
}
