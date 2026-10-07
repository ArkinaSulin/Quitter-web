// src/lib/flying.ts
// Pure flying / elevation domain logic (Phase 2). Reused by movement, combat,
// rendering and the AI. `canFly` is DERIVED: a unit flies when its aerial pool
// (`flySpeed`) is > 0; `elevation > 0` means it is currently airborne.
import { Unit, getOrganizationLevel } from '@/types/gameProtocol';
import { isUnitInteractable } from '@/packages/units';
import { formationAtOrBelow } from '@/packages/movement/lib/formationCost';
import { hexToPixel } from '@/packages/primitives';

/** Can this unit fly at all (has an aerial movement pool)? */
export function canFly(unit: Pick<Unit, 'flySpeed'>): boolean {
  return (unit.flySpeed ?? 0) > 0;
}

/** Vertical distance in feet between two elevations (0 when both grounded). */
export function elevationGapFeet(a: number | undefined, b: number | undefined): number {
  return Math.abs((a ?? 0) - (b ?? 0));
}

/** Vertical distance in whole hexes (each 10 ft = 1 hex). */
export function elevationGapHexes(a: number | undefined, b: number | undefined): number {
  return Math.floor(elevationGapFeet(a, b) / 10);
}

/**
 * Is a unit at `elevation` actually AIRBORNE over a hex whose walkable surface
 * is `surface` (pass `structureSurfaceAt(hex)`)? The ONE definition — an
 * air-capable garrison standing on a structure (`elevation === surface`) is
 * grounded, not flying.
 */
export function isAirborne(elevation: number | undefined, surface: number): boolean {
  return (elevation ?? 0) > surface;
}

/**
 * True when a unit spends its FLY pool rather than ground MP: it must be able to
 * fly (`canFly`) AND actually be airborne. An elevated NON-flyer (a climber
 * hanging above its hex) is airborne by elevation but still spends ground MP.
 */
export function usesFlyPool(unit: Pick<Unit, 'elevation' | 'flySpeed'>, surface = 0): boolean {
  return isAirborne(unit.elevation, surface) && canFly(unit);
}

/** Are two elevations within `ft` of each other (default 10 ft, melee reach)? */
export function withinVerticalGap(a: number | undefined, b: number | undefined, ft = 10): boolean {
  return Math.abs((a ?? 0) - (b ?? 0)) <= ft;
}

/** Is `targetElevation` 1..ft strictly BELOW `upperElevation` (same-column domination)? */
export function verticalGapDown(upperElevation: number | undefined, targetElevation: number | undefined, ft = 10): boolean {
  const gap = (upperElevation ?? 0) - (targetElevation ?? 0);
  return gap > 0 && gap <= ft;
}

/**
 * Screen-pixel offset of an ELEVATED token from its ground hex center, in the NE
 * (45°) direction. Two CONSTANT visual magnitudes (independent of height): a
 * **flyer** = a full hex radius; a **non-flyer** (an elevated ground unit, incl.
 * a climber) = a QUARTER hex radius. Returns (0,0) when grounded.
 */
export function elevationOffset(
  elevation: number | undefined,
  hexSize: number,
  flyer = false,
  /** Optional unit direction; defaults to NE 45°. A climber points it at the
   *  target hex. */
  dir?: { dx: number; dy: number },
): { dx: number; dy: number } {
  const feet = elevation ?? 0;
  if (feet <= 0) return { dx: 0, dy: 0 };
  const distance = hexSize * (flyer ? 1.0 : 0.25);
  const d = dir ?? { dx: Math.SQRT1_2, dy: -Math.SQRT1_2 };
  return { dx: distance * d.dx, dy: distance * d.dy };
}

/** Unit direction from `from` hex center to `to` hex center (world space). */
export function hexDirection(
  from: { q: number; r: number },
  to: { q: number; r: number },
  size: number,
): { dx: number; dy: number } {
  const a = hexToPixel({ q: from.q, r: from.r, s: -from.q - from.r }, size);
  const b = hexToPixel({ q: to.q, r: to.r, s: -to.q - to.r }, size);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l = Math.hypot(dx, dy) || 1;
  return { dx: dx / l, dy: dy / l };
}

/** Parse a `climbTo` target key "q,r" into a hex, or null. */
export function parseClimbTo(climbTo: string | null | undefined): { q: number; r: number } | null {
  if (!climbTo) return null;
  const [q, r] = climbTo.split(',').map(Number);
  return Number.isFinite(q) && Number.isFinite(r) ? { q, r } : null;
}

/** Hexes occupied by ELEVATED units (single air layer — one flyer per hex,
 *  regardless of elevation). Ground units never block a flyer. */
export function airOccupiedHexes(allUnits: Unit[], excludeUnitId?: string): Set<string> {
  return new Set(
    allUnits
      .filter(u => isUnitInteractable(u) && u.id !== excludeUnitId && (u.elevation ?? 0) > 0)
      .map(u => `${u.hex.q},${u.hex.r}`),
  );
}

/**
 * Max elevation (ft) a flyer may reach after moving `hexesMoved` hexes: climb is
 * FREE but bounded to 10 ft per hex moved (no MP spent to climb).
 */
export function maxElevationAfter(currentElevation: number, hexesMoved: number): number {
  return (currentElevation ?? 0) + Math.max(0, hexesMoved) * 10;
}

/** Elevation slider range for a flyer drop onto `hexesMoved` hexes away. */
export function elevationSliderRange(
  currentElevation: number,
  hexesMoved: number,
  groundOccupied: boolean,
): { min: number; max: number; defaultValue: number } {
  const max = maxElevationAfter(currentElevation, hexesMoved);
  // A flyer cannot land (elevation 0) on a ground-occupied hex — it hovers above it.
  const min = groundOccupied ? 10 : 0;
  return { min, max, defaultValue: currentElevation };
}

/** Can a flying host carry an attached hero? */
export type CarryVerdict = 'fly' | 'carry' | 'leave';
export function carryRule(
  host: Pick<Unit, 'sizeCategory' | 'flySpeed'>,
  hero: Pick<Unit, 'sizeCategory' | 'flySpeed'>,
): CarryVerdict {
  if (canFly(hero)) return 'fly'; // flies alongside
  if ((host.sizeCategory ?? 100) > (hero.sizeCategory ?? 100)) return 'carry'; // larger host carries it
  return 'leave'; // too small + can't fly -> leave behind
}

/** Flying units are at best Open Order while airborne (auto-capped). */
export const FLYING_MAX_FORMATION = 'Open Order';

/** The formation to auto-cap a flyer to (Open Order or lower) when it is airborne.
 *  Returns `current` unchanged when it already satisfies the cap. */
export function flyingFormationCap(currentFormation: string): string {
  return formationAtOrBelow(currentFormation, getOrganizationLevel(FLYING_MAX_FORMATION));
}

/** Closest elevation that brings the attacker within 10 ft of the target (melee
 *  reach), i.e. the MINIMAL elevation change. Returns the current elevation when
 *  already within reach. */
export function meleeElevationFor(attackerElevation: number, targetElevation: number): number {
  const gap = targetElevation - attackerElevation;
  if (withinVerticalGap(attackerElevation, targetElevation)) return attackerElevation;
  return gap > 0 ? targetElevation - 10 : targetElevation + 10;
}

// ---------------------------------------------------------------------------
// Movement pool (ground vs fly)
// ---------------------------------------------------------------------------

export type MovePoolMode = 'ground' | 'fly';

/**
 * Which MP pool a move draws from: FLY when the unit starts airborne or ends
 * airborne (a takeoff/landing is a fly move), else GROUND. `endElevation` omitted
 * defaults to the origin (a rotation / no-elevation-change move).
 */
export function movePoolMode(unit: Pick<Unit, 'elevation'>, endElevation?: number, surface = 0): MovePoolMode {
  const origin = unit.elevation ?? 0;
  const end = endElevation ?? origin;
  // Relative to the local surface (dynamic ground): a unit whose elevation equals
  // the surface it stands on is LANDED (ground pool) even when surface > 0.
  return origin > surface || end > surface ? 'fly' : 'ground';
}

/** The FLY movement pool's max (raw flySpeed — formations never scale it). */
export function flyMax(unit: Pick<Unit, 'flySpeed'>): number {
  return unit.flySpeed ?? 0;
}

/**
 * The MP budget a mode reads from: a synthetic `{ movementPointsAvailable,
 * actionsAvailable }` where the active pool's current value is presented as
 * `movementPointsAvailable`, so the shared moveCost math (`computeMoveBudget`,
 * `applyMoveCost`, `computeMovePool`, …) is reused unchanged for both pools.
 */
export function moveBudgetUnit(
  unit: Pick<Unit, 'movementPointsAvailable' | 'flySpeedAvailable' | 'actionsAvailable'>,
  mode: MovePoolMode,
): { movementPointsAvailable: number; actionsAvailable: number } {
  return {
    movementPointsAvailable: mode === 'fly' ? (unit.flySpeedAvailable ?? 0) : unit.movementPointsAvailable,
    actionsAvailable: unit.actionsAvailable,
  };
}

const roundMp = (x: number): number => Math.round(x * 10) / 10;

/**
 * Passive drain on an attached/rider hero carried by a flying host. Ground MP
 * (and, when the passenger has its own fly pool, fly points) are reduced in
 * proportion to the host's fly pool spent (`used / hostFlyMax`). It never limits
 * the move (clamped at 0) — the host's pool is the only budget.
 */
export function passengerDrain(
  used: number,
  hostFlyMax: number,
  passenger: Pick<Unit, 'movementPointsAvailable' | 'flySpeedAvailable' | 'flySpeed'>,
  passengerGroundMax: number,
): { movementPointsAvailable: number; flySpeedAvailable: number } {
  const frac = hostFlyMax > 0 ? Math.min(1, Math.max(0, used) / hostFlyMax) : 0;
  const ground = Math.max(0, roundMp(passenger.movementPointsAvailable - frac * passengerGroundMax));
  const passengerFlyMax = passenger.flySpeed ?? 0;
  const fly = passengerFlyMax > 0
    ? Math.max(0, roundMp((passenger.flySpeedAvailable ?? 0) - frac * passengerFlyMax))
    : (passenger.flySpeedAvailable ?? 0);
  return { movementPointsAvailable: ground, flySpeedAvailable: fly };
}

/**
 * Fall damage: one d6 per 10 ft fallen (`floor(feet/10)`), returning the
 * individual die faces plus their sum. A `feather_fall` carrier ignores this
 * (the caller checks `unitHasFeatherFall` and skips the roll).
 */
export function rollFallDamage(feet: number, rng: () => number = Math.random): { total: number; faces: number[] } {
  const n = Math.max(0, Math.floor(feet / 10));
  const faces: number[] = [];
  let total = 0;
  for (let i = 0; i < n; i++) {
    const r = 1 + Math.floor(rng() * 6);
    faces.push(r);
    total += r;
  }
  return { total, faces };
}

/** Structures are considered 10 ft tall (ground-level). A unit must be within
 *  10 ft of this height to attack one. (Pending: real per-structure height.) */
export const STRUCTURE_HEIGHT_FT = 10;

/** True when a unit at `elevation` can reach a ground-level structure (≤ 10 ft
 *  vertical gap from the structure's 10 ft height). */
export function canReachStructure(elevation: number | undefined): boolean {
  return withinVerticalGap(elevation, STRUCTURE_HEIGHT_FT);
}
