import { describe, it, expect } from 'vitest';
import { isRangedCapableWeapon, reactionMovePool, findEligibleReactionArchers } from './archerReaction';
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
    moraleBoost: 0,
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
    pursuitUsed: false,
    heroicInspirationActive: false,
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

describe('reactionMovePool', () => {
  const unit = (mp: number, actions: number, isHero = false) =>
    ({ isHero, movementPointsAvailable: mp, actionsAvailable: actions });

  it('grants one full action pool for a unit (not half movement)', () => {
    expect(reactionMovePool(unit(0, 2), 5)).toBe(5); // 0 MP + an action → full pool
    expect(reactionMovePool(unit(2, 1), 5)).toBe(2); // leftover MP on hand
    expect(reactionMovePool(unit(0, 0), 5)).toBe(0); // no MP, no action
  });

  it('uses the prorated hero pool for heroes', () => {
    // maxMP 3 → 0.6 MP/action: 5 actions cover exactly one 3-MP move.
    expect(reactionMovePool(unit(0, 5, true), 3)).toBe(3);
    // maxMP 6 → 1.2 MP/action: 2 actions = 2.4 → floored to 2.
    expect(reactionMovePool(unit(0, 2, true), 6)).toBe(2);
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

  it('formed archers only react into their front arc', () => {
    const forms = { 'Open Order': { name: 'Open Order', ranged_target_arcs: ['front'] } as any };
    // Mover is due east. Facing 1 puts it in the front cone; facing 0 makes it a flank shot.
    const front = makeUnit({ id: 'a1', team: 'red', hex: h(0, 0), facing: 1, weaponString: bow, actionsAvailable: 2 });
    const side = makeUnit({ id: 'a2', team: 'red', hex: h(0, 0), facing: 0, weaponString: bow, actionsAvailable: 2 });
    expect(findEligibleReactionArchers(mover, [front], alliances as any, forms).map(u => u.id)).toEqual(['a1']);
    expect(findEligibleReactionArchers(mover, [side], alliances as any, forms)).toHaveLength(0);
  });
});
