import { describe, it, expect } from 'vitest';
import { isRangedCapableWeapon, getReactionMoveBudget, findEligibleReactionArchers } from './archerReaction';
import { Unit, Hex } from '@/types/gameProtocol';

const h = (q: number, r: number): Hex => ({ q, r, s: -q - r });

const makeUnit = (overrides: Partial<Unit> = {}): Unit => ({
  id: 'u1',
  scenarioId: 's1',
  templateId: null,
  unitName: 'Unit',
  raceId: '',
  raceName: '',
  armorName: '',
  mountId: null,
  mountName: '',
  isHero: false,
  attachedToUnitId: null,
  currentTroopCount: 10,
  maxTroopCount: 10,
  level: 1,
  troopHp: 1,
  maxUnitHp: 10,
  currentUnitHp: 10,
  isShielded: false,
  baselineAc: 10,
  currentAc: 10,
  weaponString: '',
  movementPoints: 3,
  movementPointsAvailable: 0,
  aggressiveness: 3,
  baseMorale: 3,
  currentMoraleModifier: 0,
  sizeCategory: 100,
  visualScale: 100,
  currentFormation: 'Open Order',
  organizationLevel: 1,
  formationAvailability: ['Open Order', 'Close Order'],
  equipCostGp: 0,
  raceIconUrl: '',
  unitTypeIconUrl: '',
  customImageUrl: '',
  canCharge: false,
  hex: h(0, 0),
  facing: 0,
  team: 'blue',
  hidden: false,
  isDeleted: false,
  ignoreMoraleChecks: false,
  isCharging: false,
  chargeDistance: 0,
  commandSeq: 0,
  actionsAvailable: 2,
  attacksUsed: 0,
  archerReactionUsed: false,
  activeWeaponIndex: 0,
  str: 0,
  dex: 0,
  con: 0,
  int: 0,
  wis: 0,
  cha: 0,
  attachedPosition: null,
  ...overrides,
});

const alliances = { blue: 'friendly', red: 'enemy' as const };

describe('isRangedCapableWeapon', () => {
  it('true for a bow and a thrown weapon; false for a pure melee weapon', () => {
    expect(isRangedCapableWeapon({ range: 3, maxRange: 6 })).toBe(true);
    expect(isRangedCapableWeapon({ range: 1, maxRange: 3 })).toBe(true);
    expect(isRangedCapableWeapon({ range: 1, maxRange: 1 })).toBe(false);
    expect(isRangedCapableWeapon(null)).toBe(false);
  });
});

describe('getReactionMoveBudget', () => {
  it('is half the max movement, floored, at least 1', () => {
    expect(getReactionMoveBudget(6)).toBe(3);
    expect(getReactionMoveBudget(5)).toBe(2);
    expect(getReactionMoveBudget(1)).toBe(1);
  });
});

describe('findEligibleReactionArchers', () => {
  const bow = 'Longbow,3,1d8,false,4,8,0,false,false,false,false,1,true,Dex,circle';
  const mover = makeUnit({ id: 'm1', team: 'blue', hex: h(2, 0), movementPoints: 6 });

  it('finds a hostile archer whose weapon range covers the mover', () => {
    const archer = makeUnit({ id: 'a1', team: 'red', hex: h(0, 0), weaponString: bow, actionsAvailable: 2 });
    // distance 2 <= range 4
    expect(findEligibleReactionArchers(mover, [archer], alliances as any).map(u => u.id)).toEqual(['a1']);
  });

  it('excludes archers whose range does not reach the mover (uses range, not maxRange)', () => {
    const short = 'Shortbow,3,1d6,false,1,3,0,false,false,false,false,1,true,Dex,circle'; // range 1, maxRange 3
    const archer = makeUnit({ id: 'a1', team: 'red', hex: h(0, 0), weaponString: short, actionsAvailable: 2 });
    // distance 2 > range 1 but <= maxRange 3 — NOT eligible
    expect(findEligibleReactionArchers(mover, [archer], alliances as any)).toHaveLength(0);
  });

  it('excludes friendly, hidden, routed, deleted, out-of-actions, and already-reacted archers', () => {
    const archer = makeUnit({ id: 'a1', team: 'red', hex: h(0, 0), weaponString: bow, actionsAvailable: 2 });
    const friendly = { ...archer, id: 'a2', team: 'blue' };
    const hidden = { ...archer, id: 'a3', hidden: true };
    const routed = { ...archer, id: 'a4', currentFormation: 'Routed' };
    const deleted = { ...archer, id: 'a5', isDeleted: true };
    const noAction = { ...archer, id: 'a6', actionsAvailable: 0 };
    const used = { ...archer, id: 'a7', archerReactionUsed: true };
    const meleeOnly = { ...archer, id: 'a8', weaponString: 'Sword,2,1d8,false,1,1,0,false,false,false,false,1,true,Dex,circle' };
    const result = findEligibleReactionArchers(mover, [friendly, hidden, routed, deleted, noAction, used, meleeOnly], alliances as any);
    expect(result.map(u => u.id)).toEqual([]);
  });

  it('includes heroes with ranged weapons', () => {
    const hero = makeUnit({ id: 'h1', team: 'red', hex: h(0, 0), weaponString: bow, isHero: true, actionsAvailable: 5 });
    expect(findEligibleReactionArchers(mover, [hero], alliances as any).map(u => u.id)).toEqual(['h1']);
  });

  it('excludes a back-attached hero (protected — no line of sight)', () => {
    const protectedHero = makeUnit({
      id: 'h1', team: 'red', hex: h(0, 0), weaponString: bow, isHero: true,
      actionsAvailable: 5, attachedToUnitId: 'host', attachedPosition: 'back',
    });
    expect(findEligibleReactionArchers(mover, [protectedHero], alliances as any)).toHaveLength(0);
  });

  it('still includes a front-attached hero (fights openly)', () => {
    const frontHero = makeUnit({
      id: 'h1', team: 'red', hex: h(0, 0), weaponString: bow, isHero: true,
      actionsAvailable: 5, attachedToUnitId: 'host', attachedPosition: 'front',
    });
    expect(findEligibleReactionArchers(mover, [frontHero], alliances as any).map(u => u.id)).toEqual(['h1']);
  });
});
