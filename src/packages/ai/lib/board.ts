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
      if (structures[edgeRef(cur.q, cur.r, dir).key]) continue; // perimeter
      hexes.add(key);
      queue.push(next);
    }
  }
  return reachedRim ? null : { kind: 'enclosure', hexes };
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
  // A complex perimeter is impassable in both directions, even through an open
  // door/gate. Interior edges keep the normal wall/structure rules.
  const blockedEdge = complex
    ? (fq: number, fr: number, tq: number, tr: number) => {
        const fromIn = complex.hexes.has(`${fq},${fr}`);
        const toIn = complex.hexes.has(`${tq},${tr}`);
        if (fromIn !== toIn) return true;
        return rawBlockedEdge?.(fq, fr, tq, tr) ?? false;
      }
    : rawBlockedEdge;
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
      if (m.blockedEdge && m.blockedEdge(cur.hex.q, cur.hex.r, next.q, next.r)) continue;
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

/** True when `dest` puts any non-target hostile in our flank/rear. */
export function isFlankedAt(
  dest: Hex,
  facing: number,
  foes: Unit[],
  intendedTargetId: string | null,
): boolean {
  for (const foe of foes) {
    if (foe.id === intendedTargetId) continue;
    if (isUnitRouted(foe)) continue;
    const arc = arcOfTarget(dest, facing, foe.hex);
    if (arc === 'flank' || arc === 'rear') return true;
  }
  return false;
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
  maxTurns = 2,
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
      reachUnit(state), pool, movement.occupied, movement.threat, movement.costOfHex, false,
      movement.blockedEdge, undefined, movement.passThrough, movement.org, !!ctx.reactiveArchery,
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

  const recurse = (state: Unit, turns: { dir: 'left' | 'right' }[]) => {
    evaluate(state, turns);
    if (turns.length >= maxTurns) return;
    for (const dir of ['left', 'right'] as const) {
      const free = isLoose(state, ctx.formations);
      let next: Unit | null;
      if (free) {
        next = { ...state, facing: dir === 'left' ? rotateLeft(state.facing) : rotateRight(state.facing) };
      } else if (mode === 'fly') {
        const applied = applyMpSpend({ movementPointsAvailable: state.flySpeedAvailable ?? 0, actionsAvailable: state.actionsAvailable }, 1, flyMax(state));
        if (applied.actionsAvailable < 0) continue;
        next = {
          ...state,
          facing: dir === 'left' ? rotateLeft(state.facing) : rotateRight(state.facing),
          flySpeedAvailable: applied.movementPointsAvailable,
          actionsAvailable: applied.actionsAvailable,
        };
      } else {
        const applied = applyMpSpend(state, 1, effectiveMax(state, ctx.formations));
        if (applied.actionsAvailable < 0) continue;
        next = {
          ...state,
          facing: dir === 'left' ? rotateLeft(state.facing) : rotateRight(state.facing),
          movementPointsAvailable: applied.movementPointsAvailable,
          actionsAvailable: applied.actionsAvailable,
        };
      }
      if (next) recurse(next, [...turns, { dir }]);
    }
  };

  recurse(unit, []);
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
