import { describe, it, expect } from 'vitest';
import {
  canFly, elevationGapFeet, elevationGapHexes, elevationOffset, airOccupiedHexes,
  maxElevationAfter, elevationSliderRange, carryRule, FLYING_MAX_FORMATION, flyingFormationCap,
  meleeElevationFor, canReachStructure, STRUCTURE_HEIGHT_FT,
  movePoolMode, flyMax, moveBudgetUnit, passengerDrain, rollFallDamage,
  isAirborne, withinVerticalGap, verticalGapDown,
} from './flying';
import { Unit } from '@/types/gameProtocol';

const u = (over: Partial<Unit> = {}): Unit => ({
  id: 'u', scenarioId: 's', templateId: null, unitName: 'U', raceId: '', raceName: '',
  armorName: '', mountId: null, mountName: '', isHero: false, attachedToUnitId: null,
  attachedPosition: null, currentTroopCount: 1, maxTroopCount: 1, level: 1, troopHp: 10,
  maxUnitHp: 10, currentUnitHp: 10, isShielded: false, baselineAc: 10, currentAc: 10,
  weaponString: '', movementPoints: 3, movementPointsAvailable: 0, aggressiveness: 3,
  baseMorale: 3, currentMoraleModifier: 0, moraleBoost: 0, sizeCategory: 100,
  visualScale: 100, currentFormation: 'Open Order', formationAvailability: [],
  equipCostGp: 0, canCharge: false, ignoreMoraleChecks: false, hex: { q: 0, r: 0, s: 0 },
  facing: 0, team: 'blue', hidden: false, isDeleted: false, isCharging: false,
  chargeDistance: 0, commandSeq: 0, organizationLevel: 0, actionsAvailable: 1,
  attacksUsed: 0, archerReactionUsed: false, pursuitUsed: false,
  heroicInspirationActive: false, activeWeaponIndex: 0, str: 0, dex: 0, con: 0,
  int: 0, wis: 0, cha: 0, ...over,
});

describe('flying', () => {
  it('canFly derives from flySpeed > 0', () => {
    expect(canFly({ flySpeed: 3 })).toBe(true);
    expect(canFly({ flySpeed: 0 })).toBe(false);
    expect(canFly({})).toBe(false);
  });

  it('elevationGapFeet / elevationGapHexes', () => {
    expect(elevationGapFeet(20, 0)).toBe(20);
    expect(elevationGapHexes(20, 0)).toBe(2);
    expect(elevationGapHexes(25, 0)).toBe(2); // floor
    expect(elevationGapFeet(undefined, undefined)).toBe(0);
  });

  it('isAirborne: elevation strictly above the hex surface', () => {
    expect(isAirborne(10, 0)).toBe(true);
    expect(isAirborne(10, 10)).toBe(false); // grounded on a 10-ft structure
    expect(isAirborne(0, 0)).toBe(false);
    expect(isAirborne(undefined, 0)).toBe(false);
  });

  it('withinVerticalGap / verticalGapDown', () => {
    expect(withinVerticalGap(10, 0)).toBe(true);
    expect(withinVerticalGap(20, 0)).toBe(false);
    expect(verticalGapDown(10, 0)).toBe(true);
    expect(verticalGapDown(10, 10)).toBe(false); // no downward gap
    expect(verticalGapDown(0, 10)).toBe(false); // target above
  });

  it('elevationOffset: NE 45°; flyer = full, non-flyer = quarter, constant by height', () => {
    expect(elevationOffset(0, 100)).toEqual({ dx: 0, dy: 0 });
    // Flyer = full hex radius at any height.
    const flyer = elevationOffset(10, 100, true);
    expect(flyer.dx).toBeCloseTo(100 * Math.SQRT1_2, 5);
    expect(flyer.dy).toBeCloseTo(-100 * Math.SQRT1_2, 5);
    // Non-flyer (elevated ground unit / climber) = quarter hex radius.
    expect(elevationOffset(30, 100, false).dx).toBeCloseTo(100 * 0.25 * Math.SQRT1_2, 5);
    // A direction override points the offset (e.g. a climber toward its target).
    const dir = elevationOffset(10, 100, false, { dx: 0, dy: -1 });
    expect(dir.dx).toBeCloseTo(0, 5);
    expect(dir.dy).toBeCloseTo(-25, 5);
  });

  it('airOccupiedHexes only counts elevated units', () => {
    const flyer = u({ id: 'f', elevation: 20, hex: { q: 1, r: 0, s: -1 } });
    const ground = u({ id: 'g', elevation: 0, hex: { q: 2, r: 0, s: -2 } });
    const set = airOccupiedHexes([flyer, ground]);
    expect(set.has('1,0')).toBe(true);
    expect(set.has('2,0')).toBe(false);
  });

  it('maxElevationAfter bounds free climb to 10 ft/hex', () => {
    expect(maxElevationAfter(20, 3)).toBe(50);
    expect(maxElevationAfter(0, 0)).toBe(0);
  });

  it('elevationSliderRange', () => {
    expect(elevationSliderRange(20, 3, false)).toEqual({ min: 0, max: 50, defaultValue: 20 });
    expect(elevationSliderRange(20, 3, true)).toEqual({ min: 10, max: 50, defaultValue: 20 });
  });

  it('carryRule', () => {
    expect(carryRule({ sizeCategory: 200, flySpeed: 6 }, { sizeCategory: 100, flySpeed: 4 })).toBe('fly');
    expect(carryRule({ sizeCategory: 200, flySpeed: 6 }, { sizeCategory: 100, flySpeed: 0 })).toBe('carry');
    expect(carryRule({ sizeCategory: 100, flySpeed: 6 }, { sizeCategory: 200, flySpeed: 0 })).toBe('leave');
  });

  it('FLYING_MAX_FORMATION', () => {
    expect(FLYING_MAX_FORMATION).toBe('Open Order');
  });

  it('flyingFormationCap caps formed units to Open Order', () => {
    expect(flyingFormationCap('Phalanx')).toBe('Open Order');
    expect(flyingFormationCap('Close Order')).toBe('Open Order');
    expect(flyingFormationCap('Open Order')).toBe('Open Order');
    expect(flyingFormationCap('Scattered')).toBe('Scattered');
    expect(flyingFormationCap('Hero')).toBe('Hero');
  });

  it('meleeElevationFor finds the minimal change to reach within 10 ft', () => {
    expect(meleeElevationFor(50, 0)).toBe(10);      // dive to 10 ft over ground
    expect(meleeElevationFor(20, 40)).toBe(30);     // climb to within 10 ft below
    expect(meleeElevationFor(5, 15)).toBe(5);       // already within 10 ft
    expect(meleeElevationFor(20, 20)).toBe(20);     // same elevation
  });

  it('movePoolMode: fly when origin or end is airborne', () => {
    expect(movePoolMode({ elevation: 0 }, 0)).toBe('ground');
    expect(movePoolMode({ elevation: 0 })).toBe('ground');
    expect(movePoolMode({ elevation: 0 }, 10)).toBe('fly');   // takeoff
    expect(movePoolMode({ elevation: 20 }, 0)).toBe('fly');   // landing
    expect(movePoolMode({ elevation: 20 })).toBe('fly');
    expect(movePoolMode({ elevation: undefined }, undefined)).toBe('ground');
  });

  it('flyMax is raw flySpeed', () => {
    expect(flyMax({ flySpeed: 6 })).toBe(6);
    expect(flyMax({})).toBe(0);
  });

  it('moveBudgetUnit presents the active pool as movementPointsAvailable', () => {
    const unit = { movementPointsAvailable: 2, flySpeedAvailable: 5, actionsAvailable: 3 };
    expect(moveBudgetUnit(unit, 'ground')).toEqual({ movementPointsAvailable: 2, actionsAvailable: 3 });
    expect(moveBudgetUnit(unit, 'fly')).toEqual({ movementPointsAvailable: 5, actionsAvailable: 3 });
  });

  it('passengerDrain: fraction of host fly pool, clamped, never limits', () => {
    // Host used 3 of 6 = 0.5. Passenger ground 4/max 8 -> 0 (4 - 0.5*8). Fly 5/max 10 -> 0.
    expect(passengerDrain(3, 6, { movementPointsAvailable: 4, flySpeedAvailable: 5, flySpeed: 10 }, 8))
      .toEqual({ movementPointsAvailable: 0, flySpeedAvailable: 0 });
    // Host used 1 of 8 = 0.125. Ground 4/max 8 -> 3 (4 - 1 = 3). Fly 5/max 10 -> round(5-1.25)=3.8.
    expect(passengerDrain(1, 8, { movementPointsAvailable: 4, flySpeedAvailable: 5, flySpeed: 10 }, 8))
      .toEqual({ movementPointsAvailable: 3, flySpeedAvailable: 3.8 });
    // No passenger fly pool: fly value passes through, ground drains by fraction.
    expect(passengerDrain(3, 6, { movementPointsAvailable: 4, flySpeedAvailable: 0, flySpeed: 0 }, 8))
      .toEqual({ movementPointsAvailable: 0, flySpeedAvailable: 0 });
    // Host pool 0 -> no drain.
    expect(passengerDrain(3, 0, { movementPointsAvailable: 4, flySpeedAvailable: 0, flySpeed: 0 }, 8))
      .toEqual({ movementPointsAvailable: 4, flySpeedAvailable: 0 });
  });

  it('canReachStructure: within 10 ft of the 10 ft structure height', () => {
    expect(STRUCTURE_HEIGHT_FT).toBe(10);
    expect(canReachStructure(0)).toBe(true);
    expect(canReachStructure(10)).toBe(true);
    expect(canReachStructure(20)).toBe(true);
    expect(canReachStructure(30)).toBe(false);
    expect(canReachStructure(undefined)).toBe(true);
  });

  it('rollFallDamage: one d6 per 10 ft fallen', () => {
    // All-6 rng → every die is 6.
    const six = () => 0.999;
    expect(rollFallDamage(20, six)).toEqual({ total: 12, faces: [6, 6] });
    expect(rollFallDamage(15, six)).toEqual({ total: 6, faces: [6] }); // floor(15/10) = 1
    expect(rollFallDamage(9, six)).toEqual({ total: 0, faces: [] });
    expect(rollFallDamage(0, six)).toEqual({ total: 0, faces: [] });
    // All-1 rng → every die is 1.
    const one = () => 0;
    expect(rollFallDamage(30, one)).toEqual({ total: 3, faces: [1, 1, 1] });
  });
});
