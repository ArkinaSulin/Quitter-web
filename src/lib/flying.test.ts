import { describe, it, expect } from 'vitest';
import {
  canFly, elevationGapFeet, elevationGapHexes, elevationOffset, airOccupiedHexes,
  maxElevationAfter, elevationSliderRange, carryRule, FLYING_MAX_FORMATION, flyingFormationCap,
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

  it('elevationOffset: NE 45°, scales with elevation, capped', () => {
    expect(elevationOffset(0, 100)).toEqual({ dx: 0, dy: 0 });
    const half = elevationOffset(10, 100);
    expect(half.dx).toBeCloseTo(100 * 0.5 * Math.SQRT1_2, 5);
    expect(half.dy).toBeCloseTo(-100 * 0.5 * Math.SQRT1_2, 5);
    const full = elevationOffset(30, 100);
    expect(full.dx).toBeCloseTo(100 * Math.SQRT1_2, 5);
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
});
