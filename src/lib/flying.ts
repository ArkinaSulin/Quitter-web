// src/lib/flying.ts
// Pure flying / elevation domain logic (Phase 2). Reused by movement, combat,
// rendering and the AI. `canFly` is DERIVED: a unit flies when its aerial pool
// (`flySpeed`) is > 0; `elevation > 0` means it is currently airborne.
import { Unit, getOrganizationLevel } from '@/types/gameProtocol';
import { isUnitInteractable } from '@/lib/unitInteractions';
import { formationAtOrBelow } from '@/lib/formationCost';

/** Can this unit fly at all (has an aerial movement pool)? */
export function canFly(unit: Pick<Unit, 'flySpeed'>): boolean {
  return (unit.flySpeed ?? 0) > 0;
}

/**
 * A STOOP is an airborne unit that has declared a charge ("Stoop!" in the
 * context menu). Only a stooping flyer may drop-onto a ground unit to deliver
 * the free melee charge attack onto its hex.
 */
export function isStooping(unit: Pick<Unit, 'flySpeed' | 'elevation' | 'isCharging'>): boolean {
  return canFly(unit) && !!unit.isCharging && (unit.elevation ?? 0) > 0;
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
 * Screen-pixel offset of an ELEVATED token from its ground hex center, in the NE
 * (45°) direction. Scales with elevation: half a hex radius at 10 ft, a full hex
 * radius at 20 ft+ (capped). Returns (0,0) when grounded.
 */
export function elevationOffset(elevation: number | undefined, hexSize: number, flyer = false): { dx: number; dy: number } {
  const feet = elevation ?? 0;
  if (feet <= 0) return { dx: 0, dy: 0 };
  // Two visual levels so an elevated non-flyer (standing on a surface) reads
  // differently from a flyer: a NON-flyer always uses the 10-ft offset (half a
  // hex); a FLYER uses half at 10 ft and the full offset at 20 ft+.
  const level = flyer ? Math.min(2, feet / 10) : 1;
  const distance = hexSize * 0.5 * level;
  return { dx: distance * Math.SQRT1_2, dy: -distance * Math.SQRT1_2 };
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
  if (Math.abs(gap) <= 10) return attackerElevation;
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

/** Structures are considered 10 ft tall (ground-level). A unit must be within
 *  10 ft of this height to attack one. (Pending: real per-structure height.) */
export const STRUCTURE_HEIGHT_FT = 10;

/** True when a unit at `elevation` can reach a ground-level structure (≤ 10 ft
 *  vertical gap from the structure's 10 ft height). */
export function canReachStructure(elevation: number | undefined): boolean {
  return Math.abs((elevation ?? 0) - STRUCTURE_HEIGHT_FT) <= 10;
}
