import { describe, it, expect } from 'vitest';
import { FISTS_WEAPON, isMeleeWeapon, findFirstMeleeWeaponIndex, isAdjacentDistance, isMeleeReachable, isInAnyHostileKillZone, computeWeaponSwitchAc, attackKind, canWeaponAttack } from '@/packages/combat/lib/meleeFallback';
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

describe('isMeleeWeapon', () => {
  it('true for a pure melee weapon (range 1, maxRange 1)', () => {
    expect(isMeleeWeapon({ range: 1, maxRange: 1 })).toBe(true);
  });

  it('false for a thrown weapon (range 1, maxRange > 1)', () => {
    expect(isMeleeWeapon({ range: 1, maxRange: 3 })).toBe(false);
  });

  it('false for a ranged weapon (range > 1)', () => {
    expect(isMeleeWeapon({ range: 3, maxRange: 6 })).toBe(false);
  });

  it('false for null/undefined', () => {
    expect(isMeleeWeapon(null)).toBe(false);
    expect(isMeleeWeapon(undefined)).toBe(false);
  });
});

describe('findFirstMeleeWeaponIndex', () => {
  it('finds the first melee weapon in the arsenal', () => {
    const weapons = [
      { name: 'Bow', attackBonus: 0, damageDice: '1d6', range: 3, maxRange: 6 },
      { name: 'Sword', attackBonus: 1, damageDice: '1d8', range: 1, maxRange: 1 },
      { name: 'Dagger', attackBonus: 0, damageDice: '1d4', range: 1, maxRange: 1 },
    ] as any[];
    expect(findFirstMeleeWeaponIndex(weapons)).toBe(1);
  });

  it('returns -1 when only ranged weapons exist', () => {
    const weapons = [
      { name: 'Bow', attackBonus: 0, damageDice: '1d6', range: 3, maxRange: 6 },
      { name: 'Throw Dagger', attackBonus: 0, damageDice: '1d4', range: 1, maxRange: 3 },
    ] as any[];
    expect(findFirstMeleeWeaponIndex(weapons)).toBe(-1);
  });
});

describe('isAdjacentDistance', () => {
  it('true at distance 1 (and 0 for same-hex safety)', () => {
    expect(isAdjacentDistance(0)).toBe(true);
    expect(isAdjacentDistance(1)).toBe(true);
    expect(isAdjacentDistance(2)).toBe(false);
  });
});

describe('isMeleeReachable', () => {
  const at = (hex: Hex, elevation = 0) => ({ hex, elevation });
  it('horizontal adjacency AND ≤10 ft vertical', () => {
    expect(isMeleeReachable(at(h(0, 0)), at(h(1, 0)))).toBe(true);
    expect(isMeleeReachable(at(h(0, 0)), at(h(0, 0), 10))).toBe(true); // same hex, 10 ft up
    expect(isMeleeReachable(at(h(0, 0)), at(h(2, 0)))).toBe(false); // too far
    expect(isMeleeReachable(at(h(0, 0)), at(h(1, 0), 20))).toBe(false); // too high
  });
});

describe('FISTS_WEAPON', () => {
  it('is a regular melee weapon (range/maxRange 1, 1d1, no special flags)', () => {
    expect(isMeleeWeapon(FISTS_WEAPON)).toBe(true);
    expect(FISTS_WEAPON.damageDice).toBe('1d1');
    expect(FISTS_WEAPON.attackBonus).toBe(0);
    expect(FISTS_WEAPON.reach).toBe(false);
    expect(FISTS_WEAPON.noRetaliation).toBe(false);
    expect(FISTS_WEAPON.freeAction).toBe(false);
    expect(FISTS_WEAPON.isTwoHanded).toBe(false);
    expect(FISTS_WEAPON.numberOfAttacks).toBe(1);
  });
});

describe('isInAnyHostileKillZone', () => {
  it('true when standing in a hostile unit\'s front arc', () => {
    const me = makeUnit({ hex: h(0, -1) }); // directly in front of the hostile at facing 0
    const hostile = makeUnit({ id: 'h1', team: 'red', hex: h(0, 0), facing: 0 });
    expect(isInAnyHostileKillZone(me, [hostile], alliances as any)).toBe(true);
  });

  it('false when not in the hostile front arc', () => {
    const me = makeUnit({ hex: h(1, 0) }); // flank, not front
    const hostile = makeUnit({ id: 'h1', team: 'red', hex: h(0, 0), facing: 0 });
    expect(isInAnyHostileKillZone(me, [hostile], alliances as any)).toBe(false);
  });

  it('false for friendly, deleted, routed, and hidden hostiles', () => {
    const me = makeUnit({ hex: h(0, -1) });
    const friendly = makeUnit({ id: 'f1', team: 'blue', hex: h(0, 0), facing: 0 });
    const deleted = makeUnit({ id: 'd1', team: 'red', hex: h(0, 0), facing: 0, isDeleted: true });
    const routed = makeUnit({ id: 'r1', team: 'red', hex: h(0, 0), facing: 0, currentFormation: 'Routed' });
    const hidden = makeUnit({ id: 'x1', team: 'red', hex: h(0, 0), facing: 0, hidden: true });
    expect(isInAnyHostileKillZone(me, [friendly, deleted, routed, hidden], alliances as any)).toBe(false);
  });
});

describe('computeWeaponSwitchAc', () => {
  it('unchanged AC for a one-handed melee weapon', () => {
    const unit = makeUnit({ isShielded: true, baselineAc: 14, currentAc: 14 });
    expect(computeWeaponSwitchAc(unit, FISTS_WEAPON)).toBe(14);
  });

  it('-2 AC when a shielded unit draws a two-handed melee weapon', () => {
    const unit = makeUnit({ isShielded: true, baselineAc: 14, currentAc: 14 });
    const twoHanded = { ...FISTS_WEAPON, isTwoHanded: true };
    expect(computeWeaponSwitchAc(unit, twoHanded)).toBe(12);
  });
});

describe('attackKind', () => {
  const melee = { range: 1, maxRange: 1, magicDimension: 0 };
  const bow = { range: 6, maxRange: 8, magicDimension: 0 };
  const spell = { range: 6, maxRange: 6, magicDimension: 2 };

  it('a melee weapon is melee at adjacency (engaged or not) and cannot reach beyond', () => {
    expect(attackKind(melee, true, true)).toBe('melee');
    expect(attackKind(melee, true, false)).toBe('melee');
    expect(attackKind(melee, false, false)).toBe('none');
  });

  it('a ranged weapon is melee only when engaged in the opponent kill zone, else ranged', () => {
    expect(attackKind(bow, true, true)).toBe('melee');
    expect(attackKind(bow, true, false)).toBe('ranged');
    expect(attackKind(bow, false, true)).toBe('ranged');
    expect(attackKind(bow, false, false)).toBe('ranged');
  });

  it('a magic weapon always acts at range', () => {
    expect(attackKind(spell, true, true)).toBe('ranged');
    expect(attackKind(spell, false, false)).toBe('ranged');
  });
});

describe('canWeaponAttack', () => {
  const melee = { range: 1, maxRange: 1, magicDimension: 0, isHealing: false };
  const bow = { range: 6, maxRange: 8, magicDimension: 0, isHealing: false };
  const heal = { range: 1, maxRange: 1, magicDimension: 0, isHealing: true };
  // Facing 0 → edge 0 is the front; the two kill-zone hexes behind the target's
  // facing are (1,0)-ish. Use an explicit "attacker in front" geometry:
  // target at (0,0) facing 0 → its kill zone contains (1,0)? Just assert via the
  // helper's own adjacency/reach behaviour instead of hard-coding the arc.

  it('melee reaches only at horizontal adjacency within 10 ft', () => {
    const attacker = makeUnit({ hex: h(1, 0), elevation: 0 });
    const target = makeUnit({ hex: h(0, 0), elevation: 0 });
    expect(canWeaponAttack(melee, attacker, target)).toBe(true);
    const high = makeUnit({ hex: h(1, 0), elevation: 20 });
    expect(canWeaponAttack(melee, high, target)).toBe(false); // >10 ft vertical
    const far = makeUnit({ hex: h(3, 0), elevation: 0 });
    expect(canWeaponAttack(melee, far, target)).toBe(false);
  });

  it('ranged reaches within maxRange; climbing adds reach, shooting down does not', () => {
    const attacker = makeUnit({ hex: h(0, 0), elevation: 0 });
    const target = makeUnit({ hex: h(3, 0), elevation: 0 });
    expect(canWeaponAttack(bow, attacker, target)).toBe(true); // dist 3 ≤ 8
    const far = makeUnit({ hex: h(9, 0), elevation: 0 });
    expect(canWeaponAttack(bow, attacker, far)).toBe(false); // dist 9 > 8
    // Target 20 ft ABOVE at dist 9 → reach 9 + 2 = 11 > 8 → no.
    const high = makeUnit({ hex: h(9, 0), elevation: 20 });
    expect(canWeaponAttack(bow, attacker, high)).toBe(false);
    // Attacker 20 ft above a dist-3 target → shooting down adds nothing → 3 ≤ 8.
    const above = makeUnit({ hex: h(0, 0), elevation: 20 });
    expect(canWeaponAttack(bow, above, target)).toBe(true);
  });

  it('healing weapons are never usable offensively', () => {
    const attacker = makeUnit({ hex: h(1, 0) });
    const target = makeUnit({ hex: h(0, 0) });
    expect(canWeaponAttack(heal, attacker, target)).toBe(false);
  });
});
