import { describe, it, expect } from 'vitest';
import {
  computeRowCapacity,
  computeTotalAttacks,
  determineCombatPosition,
  determineRetaliationPosition,
  getEffectiveCombatPosition,
  isInFrontArc,
  rollD20,
  rollDamage,
  resolveCombatSequence,
  suppressRetaliation,
} from './unitCombat';
import { canMeleeTarget } from './formationRules';
import { Unit, Hex, Formation } from '@/types/gameProtocol';
import type { CombatOutcome } from './unitCombat';

function makeUnit(overrides: Partial<Unit> = {}): Unit {
  return {
    id: 'u1',
    scenarioId: 's1',
    templateId: null,
    unitName: 'Test Unit',
    raceId: '',
    raceName: '',
    armorName: '',
    mountId: null,
    mountName: '',
    isHero: false,
    attachedToUnitId: null,
    attachedPosition: null,
    currentTroopCount: 20,
    maxTroopCount: 20,
    level: 5,
    troopHp: 10,
    maxUnitHp: 200,
    currentUnitHp: 200,
    isShielded: false,
    baselineAc: 14,
    currentAc: 14,
    weaponString: '',
    movementPoints: 3,
    movementPointsAvailable: 3,
    aggressiveness: 7,
    baseMorale: 7,
    currentMoraleModifier: 0,
    sizeCategory: 100,
    visualScale: 100,
    currentFormation: 'Open Order',
    formationAvailability: [],
    equipCostGp: 0,
    raceIconUrl: '',
    unitTypeIconUrl: '',
    customImageUrl: '',
    canCharge: false,
    ignoreMoraleChecks: false,
    hex: { q: 0, r: 0, s: 0 },
    facing: 0,
    team: 'blue',
    isRouting: false,
    hidden: false,
    isDeleted: false,
    isCharging: false,
    chargeDistance: 0,
    organizationLevel: 1,
    actionsAvailable: 1,
    activeWeaponIndex: 0,
    ...overrides,
  };
}

function seededRng(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) & 0xffffffff;
    return (s >>> 0) / 0x100000000;
  };
}

describe('computeRowCapacity', () => {
  it('returns 10 for Medium (100) with default multiplier', () => expect(computeRowCapacity(100, 1)).toBe(10));
  it('returns 5 for Large (200) with multiplier 1', () => expect(computeRowCapacity(200, 1)).toBe(5));
  it('returns 2 for Huge (300) with multiplier 1', () => expect(computeRowCapacity(300, 1)).toBe(2));
  it('returns 1 for Gargantuan (400) with multiplier 1', () => expect(computeRowCapacity(400, 1)).toBe(1));
  it('returns 10 for Small (75) with multiplier 1', () => expect(computeRowCapacity(75, 1)).toBe(10));
  it('applies row cap multiplier', () => {
    expect(computeRowCapacity(100, 2)).toBe(20);
    expect(computeRowCapacity(100, 3)).toBe(30);
    expect(computeRowCapacity(200, 2)).toBe(10);
    expect(computeRowCapacity(400, 2)).toBe(2);
  });
  it('clamps to size category ranges', () => {
    expect(computeRowCapacity(199, 1)).toBe(10);
    expect(computeRowCapacity(299, 1)).toBe(5);
    expect(computeRowCapacity(399, 1)).toBe(2);
  });
});

describe('computeTotalAttacks', () => {
  it('multiplies row capacity by number of attacks', () => {
    expect(computeTotalAttacks(10, 1)).toBe(10);
    expect(computeTotalAttacks(10, 2)).toBe(20);
    expect(computeTotalAttacks(5, 1)).toBe(5);
  });
  it('returns 0 for 0 capacity or 0 attacks', () => {
    expect(computeTotalAttacks(0, 10)).toBe(0);
    expect(computeTotalAttacks(10, 0)).toBe(0);
  });
});

describe('isInFrontArc', () => {
  it('returns true for a hex in the front arc facing 0', () => {
    expect(isInFrontArc({ q: 0, r: 0, s: 0 }, 0, { q: 0, r: -1, s: 1 })).toBe(true);
  });
  it('returns true for the other front hex facing 0', () => {
    expect(isInFrontArc({ q: 0, r: 0, s: 0 }, 0, { q: 1, r: -1, s: 0 })).toBe(true);
  });
  it('returns false for a rear hex', () => {
    expect(isInFrontArc({ q: 0, r: 0, s: 0 }, 0, { q: 0, r: 1, s: -1 })).toBe(false);
  });
  it('returns false for a flank hex', () => {
    expect(isInFrontArc({ q: 0, r: 0, s: 0 }, 0, { q: -1, r: 0, s: 1 })).toBe(false);
  });
  it('returns false for non-adjacent hex', () => {
    expect(isInFrontArc({ q: 0, r: 0, s: 0 }, 0, { q: 5, r: -2, s: -3 })).toBe(false);
  });
  it('works with different facing', () => {
    expect(isInFrontArc({ q: 0, r: 0, s: 0 }, 2, { q: 1, r: 0, s: -1 })).toBe(true);
  });
});

describe('determineCombatPosition', () => {
  const center: Hex = { q: 0, r: 0, s: 0 };

  it('returns front when attacker is in front kill zone (facing 0 = up)', () => {
    const frontHex: Hex = { q: 0, r: -1, s: 1 };
    expect(determineCombatPosition(frontHex, center, 0)).toBe('front');
  });

  it('returns rear when attacker is behind defender', () => {
    const rearHex: Hex = { q: 0, r: 1, s: -1 };
    expect(determineCombatPosition(rearHex, center, 0)).toBe('rear');
  });

  it('returns flank when attacker is on the side', () => {
    const flankHex: Hex = { q: -1, r: 0, s: 1 };
    expect(determineCombatPosition(flankHex, center, 0)).toBe('flank');
    const flankHex2: Hex = { q: 1, r: 0, s: -1 };
    expect(determineCombatPosition(flankHex2, center, 0)).toBe('flank');
  });

  it('works with different facing', () => {
    const frontForFacing1: Hex = { q: 1, r: 0, s: -1 };
    expect(determineCombatPosition(frontForFacing1, center, 1)).toBe('front');
    const rearForFacing1: Hex = { q: -1, r: 0, s: 1 };
    expect(determineCombatPosition(rearForFacing1, center, 1)).toBe('rear');
  });

  it('returns front for non-adjacent hex (fallback)', () => {
    const farHex: Hex = { q: 5, r: -2, s: -3 };
    expect(determineCombatPosition(farHex, center, 0)).toBe('front');
  });
});

describe('melee arc-validation frame of reference', () => {
  // Matches migration 027's Close Order row: melee into front only.
  const closeOrder: Formation = {
    id: 'co',
    name: 'Close Order',
    ac_modifier: 0,
    movement_multiplier: 1,
    attack_modifier: 0,
    morale_modifier: 0,
    row_capacity_multiplier: 1,
    attack_capacity_multiplier: 1,
    melee_target_arcs: ['front'],
    ranged_target_arcs: ['front', 'flank', 'rear'],
    threat_arcs: ['front', 'flank'],
    double_threat_arcs: ['rear'],
    retaliate_arcs: { front: 'full', flank: 'rows', rear: 'none' },
    retaliate_vs_ranged: false,
    can_charge: true,
    stop_enemy_movement_arcs: ['front'],
    charge_through_arcs: ['flank'],
    be_attacked_melee_modifier: 1,
    be_attacked_range_modifier: 1,
  };

  it('a target in the attacker front arc is meleeable (arcs are attacker-relative)', () => {
    const scoutHex: Hex = { q: 0, r: 0, s: 0 };
    const heroHex: Hex = { q: 0, r: -1, s: 1 }; // in the scout's front arc at facing 0
    const arc = determineCombatPosition(heroHex, scoutHex, 0);
    expect(arc).toBe('front');
    expect(canMeleeTarget(closeOrder, arc)).toBe(true);
  });

  it('uses the attacker facing, not the target facing, for the arc', () => {
    const scoutHex: Hex = { q: 0, r: 0, s: 0 };
    const heroHex: Hex = { q: 1, r: -1, s: 0 }; // right-front of the scout (facing 0)
    // Correct frame: target relative to the ATTACKER (scout) — front, meleeable.
    expect(determineCombatPosition(heroHex, scoutHex, 0)).toBe('front');
    expect(canMeleeTarget(closeOrder, determineCombatPosition(heroHex, scoutHex, 0))).toBe(true);
    // The old code passed the target's facing, making the hero's orientation decide
    // the result — a hero facing away could show 'flank' and wrongly block the attack.
    expect(determineCombatPosition(heroHex, scoutHex, 2)).toBe('flank');
  });
});

describe('determineRetaliationPosition', () => {
  it('passes through front, flank, rear for normal formations', () => {
    expect(determineRetaliationPosition('Open Order', 'front')).toBe('front');
    expect(determineRetaliationPosition('Close Order', 'flank')).toBe('flank');
    expect(determineRetaliationPosition('Phalanx', 'rear')).toBe('rear');
  });
  it('returns flank for Scattered regardless of raw position', () => {
    expect(determineRetaliationPosition('Scattered', 'front')).toBe('flank');
    expect(determineRetaliationPosition('Scattered', 'flank')).toBe('flank');
    expect(determineRetaliationPosition('Scattered', 'rear')).toBe('flank');
  });
  it('returns rear for Routed regardless of raw position', () => {
    expect(determineRetaliationPosition('Routed', 'front')).toBe('rear');
    expect(determineRetaliationPosition('Routed', 'flank')).toBe('rear');
    expect(determineRetaliationPosition('Routed', 'rear')).toBe('rear');
  });
  it('returns front for Hero regardless of raw position', () => {
    expect(determineRetaliationPosition('Hero', 'front')).toBe('front');
    expect(determineRetaliationPosition('Hero', 'flank')).toBe('front');
    expect(determineRetaliationPosition('Hero', 'rear')).toBe('front');
  });
});

describe('getEffectiveCombatPosition', () => {
  const hero = { isHero: true, currentFormation: 'Hero', isRouting: false };
  const scattered = { isHero: false, currentFormation: 'Scattered', isRouting: false };
  const routed = { isHero: false, currentFormation: 'Routed', isRouting: true };
  const formed = { isHero: false, currentFormation: 'Open Order', isRouting: false };

  it('hero: all sides are front (no behind)', () => {
    expect(getEffectiveCombatPosition(hero, 'front')).toBe('front');
    expect(getEffectiveCombatPosition(hero, 'flank')).toBe('front');
    expect(getEffectiveCombatPosition(hero, 'rear')).toBe('front');
  });

  it('scattered: all sides are flank', () => {
    expect(getEffectiveCombatPosition(scattered, 'front')).toBe('flank');
    expect(getEffectiveCombatPosition(scattered, 'flank')).toBe('flank');
    expect(getEffectiveCombatPosition(scattered, 'rear')).toBe('flank');
  });

  it('routed: all sides are rear', () => {
    expect(getEffectiveCombatPosition(routed, 'front')).toBe('rear');
    expect(getEffectiveCombatPosition(routed, 'flank')).toBe('rear');
    expect(getEffectiveCombatPosition(routed, 'rear')).toBe('rear');
  });

  it('passes through raw position for formed units', () => {
    expect(getEffectiveCombatPosition(formed, 'front')).toBe('front');
    expect(getEffectiveCombatPosition(formed, 'flank')).toBe('flank');
    expect(getEffectiveCombatPosition(formed, 'rear')).toBe('rear');
  });

  it('treats isRouting flag alone as routed', () => {
    expect(getEffectiveCombatPosition({ ...formed, isRouting: true }, 'front')).toBe('rear');
  });
});

describe('rollD20', () => {
  it('returns values between 1 and 20', () => {
    const rng = seededRng(42);
    for (let i = 0; i < 100; i++) {
      const roll = rollD20(rng);
      expect(roll).toBeGreaterThanOrEqual(1);
      expect(roll).toBeLessThanOrEqual(20);
    }
  });

  it('is deterministic with same seed', () => {
    const a = rollD20(seededRng(42));
    const b = rollD20(seededRng(42));
    expect(a).toBe(b);
  });
});

describe('rollDamage', () => {
  it('parses simple dice notation', () => {
    const rng = seededRng(99);
    const result = rollDamage('1d8', rng);
    expect(result).toBeGreaterThanOrEqual(1);
    expect(result).toBeLessThanOrEqual(8);
  });

  it('parses dice with bonus', () => {
    const rng = seededRng(99);
    const result = rollDamage('1d6+2', rng);
    expect(result).toBeGreaterThanOrEqual(3);
    expect(result).toBeLessThanOrEqual(8);
  });

  it('parses multiple dice', () => {
    const rng = seededRng(42);
    const result = rollDamage('2d6', rng);
    expect(result).toBeGreaterThanOrEqual(2);
    expect(result).toBeLessThanOrEqual(12);
  });

  it('returns 0 for invalid format', () => {
    expect(rollDamage('invalid', () => 0.5)).toBe(0);
  });

  it('is deterministic with same seed', () => {
    const a = rollDamage('2d6', seededRng(42));
    const b = rollDamage('2d6', seededRng(42));
    expect(a).toBe(b);
  });
});

describe('resolveCombatSequence', () => {
  const attacker = makeUnit({
    id: 'att',
    unitName: 'Attacker',
    aggressiveness: 7,
    sizeCategory: 100,
    currentAc: 14,
    troopHp: 10,
    currentTroopCount: 80,
    maxTroopCount: 80,
    hex: { q: 0, r: -1, s: 1 },
  });

  const defender = makeUnit({
    id: 'def',
    unitName: 'Defender',
    sizeCategory: 100,
    currentAc: 14,
    troopHp: 10,
    currentTroopCount: 80,
    maxTroopCount: 80,
    hex: { q: 0, r: 0, s: 0 },
    facing: 0,
  });

  const aw = { attackBonus: 3, damageDice: '1d8', is_reach: false, numberOfAttacks: 1 };
  const dw = { attackBonus: 2, damageDice: '1d6', is_reach: false, numberOfAttacks: 1 };
  const rowCap = 10;
  const visualDotsPerRow = 20;

  // Helper to call with default extra params
  type WeaponArg = { attackBonus: number; damageDice: string; is_reach: boolean; noRetaliation?: boolean; freeAction?: boolean; numberOfAttacks?: number; range?: number; maxRange?: number };
  function callCombat(
    att: Unit,
    def: Unit,
    atkW: WeaponArg = aw,
    defW: WeaponArg | null = dw,
    formationAtkMod = 0,
    attackCapMult = 1,
    isRanged = false,
    isRear = false,
    attachedDefHero: { currentAc: number; troopHp: number } | null = null,
    attachedAtkHero: { currentAc: number; troopHp: number } | null = null,
  ) {
    return resolveCombatSequence(
      att, def, atkW, defW,
      formationAtkMod, attackCapMult, attackCapMult,
      rowCap, rowCap, visualDotsPerRow,
      isRanged, isRear, attachedDefHero, attachedAtkHero, seededRng(42),
    );
  }

  it('AGR failure returns no attacks', () => {
    const lowAggrAttacker = { ...attacker, aggressiveness: 1 };
    const result = callCombat(lowAggrAttacker, defender);
    expect(result.aggrPassed).toBe(false);
    expect(result.aggrRoll).toBeGreaterThan(1);
    expect(result.firstStrikeAttacks).toHaveLength(0);
    expect(result.retaliationDamage).toBe(0);
  });

  it('AGR passes for normal unit with sufficient AGR', () => {
    const result = callCombat(attacker, defender);
    expect(result.aggrPassed).toBe(true);
  });

  it('AGR skips for hero attacker', () => {
    const heroAttacker = { ...attacker, isHero: true, aggressiveness: 1 };
    const result = callCombat(heroAttacker, defender);
    expect(result.aggrPassed).toBe(true);
  });

  it('AGR skips for ranged attacker', () => {
    const lowAggrAttacker = { ...attacker, aggressiveness: 1 };
    const result = callCombat(lowAggrAttacker, defender, aw, dw, 0, 1, true);
    expect(result.aggrPassed).toBe(true);
  });

  it('AGR skips when target is routed', () => {
    const lowAggrAttacker = { ...attacker, aggressiveness: 1 };
    const result = callCombat(lowAggrAttacker, { ...defender, isRouting: true });
    expect(result.aggrPassed).toBe(true);
  });

  it('AGR skips for rear attack', () => {
    const lowAggrAttacker = { ...attacker, aggressiveness: 1 };
    const result = callCombat(lowAggrAttacker, defender, aw, dw, 0, 1, false, true);
    expect(result.aggrPassed).toBe(true);
  });

  it('hero attacker uses weapon numberOfAttacks directly, not scaled', () => {
    const heroAttacker = { ...attacker, isHero: true };
    const result = callCombat(heroAttacker, defender, { ...aw, numberOfAttacks: 1 });
    expect(result.firstStrikeCount).toBe(1);
  });

  it('hero attacker with a weapon of numberOfAttacks 3 makes 3 attacks', () => {
    const heroAttacker = { ...attacker, isHero: true };
    const result = callCombat(heroAttacker, defender, { ...aw, numberOfAttacks: 3 });
    expect(result.firstStrikeCount).toBe(3);
  });

  it('non-hero attack count scales with weapon numberOfAttacks', () => {
    const result = callCombat(attacker, defender, { ...aw, numberOfAttacks: 2 });
    // min(80, 10 * 1) * 2 = 20
    expect(result.firstStrikeCount).toBe(20);
  });

  it('attack count caps at currentTroopCount', () => {
    const fewTroops = { ...attacker, currentTroopCount: 5, maxTroopCount: 5 };
    const result = callCombat(fewTroops, defender);
    // min(5, 10*1) * 1 = 5
    expect(result.firstStrikeCount).toBe(5);
  });

  it('applies attack capacity multiplier to attack count', () => {
    const result = callCombat(attacker, defender, aw, dw, 0, 2);
    // min(80, 10*2) * 1 = 20
    expect(result.firstStrikeCount).toBe(20);
  });

  it('ranged attack strikes first and provokes no retaliation', () => {
    const result = callCombat(attacker, defender, aw, dw, 0, 1, true);
    expect(result.aggrPassed).toBe(true);
    expect(result.strikerFirst).toBe('attacker');
    expect(result.firstStrikeCount).toBeGreaterThan(0);
    expect(result.retaliationCount).toBe(0);
    expect(result.retaliationDamage).toBe(0);
  });

  it('reach defender cannot strike first or retaliate against a ranged attack', () => {
    const noReach = { ...aw, is_reach: false };
    const withReach = { ...dw, is_reach: true };
    const result = callCombat(attacker, defender, noReach, withReach, 0, 1, true);
    expect(result.strikerFirst).toBe('attacker');
    expect(result.retaliationCount).toBe(0);
    expect(result.retaliationDamage).toBe(0);
  });

  it('long-range shots beyond the weapon range are made at disadvantage (roll two, take lower)', () => {
    // Hero attacker at distance 4, weapon range 2 / maxRange 6 → disadvantage.
    const heroAttacker = { ...attacker, isHero: true, hex: { q: 0, r: 0, s: 0 } };
    const farDefender = { ...defender, hex: { q: 0, r: -4, s: 4 }, currentAc: 10, isRouting: false };
    const rangedWeapon = { attackBonus: 0, damageDice: '1d6', is_reach: false, numberOfAttacks: 1, range: 2, maxRange: 6 };
    const seq = [0.7, 0.3]; // roll1 = 15, roll2 = 7 → taken 7
    const rng = () => seq.shift() ?? 0.5;
    const result = resolveCombatSequence(heroAttacker, farDefender, rangedWeapon, null, 0, 1, 1, 10, 10, 20, true, false, null, null, rng);
    expect(result.firstStrikeAttacks).toHaveLength(1);
    expect(result.firstStrikeAttacks[0].roll).toBe(7); // min(15, 7)
    expect(result.firstStrikeAttacks[0].isHit).toBe(false); // 7 + 0 < AC 10
  });

  it('shots within range are not disadvantaged', () => {
    // Distance 1 ≤ range 2 → a single roll, normal hit.
    const heroAttacker = { ...attacker, isHero: true, hex: { q: 0, r: 0, s: 0 } };
    const nearDefender = { ...defender, hex: { q: 0, r: -1, s: 1 }, currentAc: 10, isRouting: false };
    const rangedWeapon = { attackBonus: 0, damageDice: '1d6', is_reach: false, numberOfAttacks: 1, range: 2, maxRange: 6 };
    const seq = [0.7, 0.5]; // single roll = 15 → hit; 0.5 feeds the damage roll
    const rng = () => seq.shift() ?? 0.5;
    const result = resolveCombatSequence(heroAttacker, nearDefender, rangedWeapon, null, 0, 1, 1, 10, 10, 20, true, false, null, null, rng);
    expect(result.firstStrikeAttacks).toHaveLength(1);
    expect(result.firstStrikeAttacks[0].roll).toBe(15);
    expect(result.firstStrikeAttacks[0].isHit).toBe(true); // 15 + 0 >= AC 10
  });

  it('a melee-range weapon thrown beyond reach (range 1, maxRange 3) is disadvantaged', () => {
    // Distance 2 > range 1, ≤ maxRange 3 → disadvantage (two rolls, take lower).
    const heroAttacker = { ...attacker, isHero: true, hex: { q: 0, r: 0, s: 0 } };
    const midDefender = { ...defender, hex: { q: 0, r: -2, s: 2 }, currentAc: 10, isRouting: false };
    const thrownWeapon = { attackBonus: 0, damageDice: '1d6', is_reach: false, numberOfAttacks: 1, range: 1, maxRange: 3 };
    const seq = [0.7, 0.3]; // roll1 = 15, roll2 = 7 → taken 7
    const rng = () => seq.shift() ?? 0.5;
    const result = resolveCombatSequence(heroAttacker, midDefender, thrownWeapon, null, 0, 1, 1, 10, 10, 20, true, false, null, null, rng);
    expect(result.firstStrikeAttacks).toHaveLength(1);
    expect(result.firstStrikeAttacks[0].roll).toBe(7); // min(15, 7)
    expect(result.firstStrikeAttacks[0].isHit).toBe(false); // 7 + 0 < AC 10
  });

  it('rear attack skips AGR and retaliation', () => {
    const rearAttacker = { ...attacker, hex: { q: 0, r: 1, s: -1 } };
    const result = callCombat(rearAttacker, defender, aw, dw, 0, 1, false, true);
    expect(result.aggrPassed).toBe(true);
    expect(result.strikerFirst).toBe('attacker');
    expect(result.firstStrikeCount).toBeGreaterThan(0);
    expect(result.retaliationDamage).toBe(0);
  });

  it('rear attack strikes first even when the defender has reach', () => {
    const rearAttacker = { ...attacker, hex: { q: 0, r: 1, s: -1 } };
    const noReach = { ...aw, is_reach: false };
    const withReach = { ...dw, is_reach: true };
    const result = callCombat(rearAttacker, defender, noReach, withReach, 0, 1, false, true);
    expect(result.strikerFirst).toBe('attacker');
    expect(result.firstStrikeCount).toBeGreaterThan(0);
    expect(result.retaliationCount).toBe(0);
    expect(result.retaliationDamage).toBe(0);
  });

  it('flank retaliation uses rows formula', () => {
    const flankAttacker = { ...attacker, hex: { q: -1, r: 0, s: 1 } };
    const result = callCombat(flankAttacker, defender);
    expect(result.firstStrikeCount).toBeGreaterThan(0);
    // flank: ceil(80/20) * 1 = 4 rows
    expect(result.retaliationCount).toBe(4);
  });

  it('defender strikes first when defender has reach and attacker does not', () => {
    const noReach = { ...aw, is_reach: false };
    const withReach = { ...dw, is_reach: true };
    const result = callCombat(attacker, defender, noReach, withReach);
    expect(result.strikerFirst).toBe('defender');
  });

  it('attacker strikes first when both have or both lack reach', () => {
    const bothNoReach = callCombat(attacker, defender, aw, dw);
    expect(bothNoReach.strikerFirst).toBe('attacker');

    const bothReach = callCombat(attacker, defender, { ...aw, is_reach: true }, { ...dw, is_reach: true });
    expect(bothReach.strikerFirst).toBe('attacker');
  });

  it('routed defender never strikes first', () => {
    const routedDef = { ...defender, isRouting: true };
    const result = callCombat(attacker, routedDef, { ...aw, is_reach: false }, { ...dw, is_reach: true });
    expect(result.strikerFirst).toBe('attacker');
  });

  it('routed defender cannot retaliate', () => {
    const routedDefender = { ...defender, isRouting: true };
    const result = callCombat(attacker, routedDefender);
    expect(result.aggrPassed).toBe(true);
    expect(result.firstStrikeCount).toBeGreaterThan(0);
    expect(result.retaliationDamage).toBe(0);
  });

  it('routed attacker cannot retaliate when defender strikes first', () => {
    const routedAttacker = { ...attacker, isRouting: true };
    const result = callCombat(routedAttacker, defender, { ...aw, is_reach: false }, { ...dw, is_reach: true });
    expect(result.strikerFirst).toBe('defender');
    expect(result.firstStrikeCount).toBeGreaterThan(0);
    expect(result.retaliationDamage).toBe(0);
  });

  it('Scattered defender always uses flank retaliation', () => {
    const scatteredDef = { ...defender, currentFormation: 'Scattered' };
    const result = callCombat(attacker, scatteredDef);
    // Ceil(80/20) = 4 rows
    expect(result.retaliationCount).toBe(4);
  });

  it('Scattered defender can still be attacked from any position', () => {
    const scatteredDef = { ...defender, currentFormation: 'Scattered' };
    // rear hex + non-rear flag = defender can retaliate but at flank rate
    const rearAttacker = { ...attacker, hex: { q: 0, r: 1, s: -1 } };
    const result = callCombat(rearAttacker, scatteredDef, aw, dw, 0, 1, false, false);
    expect(result.retaliationCount).toBe(4);
  });

  it('Routed defender gives no retaliation from any position', () => {
    const routedDef = { ...defender, isRouting: true, currentFormation: 'Routed' };
    const result = callCombat(attacker, routedDef);
    expect(result.retaliationDamage).toBe(0);
  });

  it('first strike damage is capped at troopHp per hit', () => {
    const highDmg = { ...aw, damageDice: '1d100' };
    const result = callCombat(attacker, defender, highDmg);
    for (const atk of result.firstStrikeAttacks) {
      if (atk.isHit) {
        expect(atk.actualDamage).toBeLessThanOrEqual(defender.troopHp);
      }
    }
  });

  it('uses formation attack modifier', () => {
    const withFormation = callCombat(attacker, defender, aw, dw, 2);
    const withoutFormation = callCombat(attacker, defender, aw, dw, 0);
    expect(withFormation.firstStrikeAttacks.length).toBe(withoutFormation.firstStrikeAttacks.length);
  });

  it('when defender strikes first, attacker retaliates', () => {
    const result = callCombat(
      attacker, defender,
      { ...aw, is_reach: false }, { ...dw, is_reach: true },
    );
    expect(result.strikerFirst).toBe('defender');
    expect(result.firstStrikeCount).toBeGreaterThan(0);
    expect(result.retaliationCount).toBeGreaterThan(0);
  });

  it('attacker gets no retaliation from rear', () => {
    const rearAttacker = { ...attacker, hex: { q: 0, r: 1, s: -1 } };
    const result = callCombat(rearAttacker, defender, aw, dw, 0, 1, false, true);
    expect(result.retaliationDamage).toBe(0);
  });

  it('attached hero takes 30% of first strike attacks', () => {
    const heroDef: Unit & { heroAc: number; heroHp: number } = { ...defender } as any;
    const attachedHero = { currentAc: 12, troopHp: 8 };
    const result = callCombat(attacker, defender, aw, dw, 0, 1, false, false, attachedHero);
    // min(80, 10*1) * 1 = 10 attacks → ceil(10 * 0.30) = 3 to hero, 7 to unit
    expect(result.firstStrikeAttacks.length).toBe(10);
    expect(result.firstStrikeHeroAttacks.length).toBe(3);
    expect(result.firstStrikeHeroDamage).toBeGreaterThanOrEqual(0);
  });

  it('AGR skips when attacker weapon has freeAction', () => {
    const lowAggrAttacker = { ...attacker, aggressiveness: 1 };
    const freeW = { ...aw, freeAction: true };
    const result = callCombat(lowAggrAttacker, defender, freeW);
    expect(result.aggrPassed).toBe(true);
  });

  it('AGR skips when attacker weapon has noRetaliation', () => {
    const lowAggrAttacker = { ...attacker, aggressiveness: 1 };
    const safeW = { ...aw, noRetaliation: true };
    const result = callCombat(lowAggrAttacker, defender, safeW);
    expect(result.aggrPassed).toBe(true);
  });

  it('noRetaliation forces attacker to strike first even when defender has reach', () => {
    const safeW = { ...aw, noRetaliation: true, is_reach: false };
    const reachDefW = { ...dw, is_reach: true };
    const result = callCombat(attacker, defender, safeW, reachDefW);
    expect(result.strikerFirst).toBe('attacker');
  });

  it('noRetaliation suppresses retaliation entirely', () => {
    const safeW = { ...aw, noRetaliation: true };
    // Front attack, defender not routed → would normally retaliate at full capacity
    const result = callCombat(attacker, defender, safeW);
    expect(result.aggrPassed).toBe(true);
    expect(result.firstStrikeCount).toBeGreaterThan(0);
    expect(result.retaliationCount).toBe(0);
    expect(result.retaliationDamage).toBe(0);
  });

  it('flagged noRetaliation attack still splits 30% to an attached hero', () => {
    const safeW = { ...aw, noRetaliation: true };
    const attachedHero = { currentAc: 12, troopHp: 8 };
    const result = callCombat(attacker, defender, safeW, dw, 0, 1, false, false, attachedHero);
    expect(result.firstStrikeAttacks.length).toBe(10);
    expect(result.retaliationDamage).toBe(0);
  });
});

describe('suppressRetaliation', () => {
  function makeOutcome(): CombatOutcome {
    const att = makeUnit({ id: 'a', unitName: 'A', aggressiveness: 7, sizeCategory: 100, currentAc: 14, troopHp: 10, currentTroopCount: 80, maxTroopCount: 80, hex: { q: 0, r: -1, s: 1 } });
    const def = makeUnit({ id: 'd', unitName: 'D', sizeCategory: 100, currentAc: 14, troopHp: 10, currentTroopCount: 80, maxTroopCount: 80, hex: { q: 0, r: 0, s: 0 }, facing: 0 });
    const result = resolveCombatSequence(
      att, def,
      { attackBonus: 3, damageDice: '1d8', is_reach: false },
      { attackBonus: 2, damageDice: '1d6', is_reach: false },
      0, 1, 1, 10, 10, 20, false, false, null, null, seededRng(42),
    );
    return { ...result, retaliationAttacks: [{ roll: 12, isCrit: false, attackValue: 15, isHit: true, rawDamage: 5, actualDamage: 5 }], retaliationDamage: 5, retaliationCount: 2 };
  }

  it('suppresses retaliation in ordered combat when the retaliator was killed', () => {
    const result = suppressRetaliation(makeOutcome(), true, false, false);
    expect(result.retaliationDamage).toBe(0);
    expect(result.retaliationHeroDamage).toBe(0);
    expect(result.retaliationAttacks).toHaveLength(0);
    expect(result.retaliationCount).toBe(0);
    expect(result.firstStrikeDamage).toBeGreaterThan(0);
  });

  it('suppresses retaliation in ordered combat when the retaliator routed', () => {
    const result = suppressRetaliation(makeOutcome(), false, true, false);
    expect(result.retaliationDamage).toBe(0);
    expect(result.retaliationCount).toBe(0);
  });

  it('keeps retaliation in ordered combat when the retaliator survived', () => {
    const result = suppressRetaliation(makeOutcome(), false, false, false);
    expect(result.retaliationDamage).toBe(5);
    expect(result.retaliationCount).toBe(2);
  });

  it('keeps retaliation in simultaneous combat even when the retaliator was killed', () => {
    const result = suppressRetaliation(makeOutcome(), true, false, true);
    expect(result.retaliationDamage).toBe(5);
    expect(result.retaliationCount).toBe(2);
  });

  it('keeps retaliation in simultaneous combat even when the retaliator routed', () => {
    const result = suppressRetaliation(makeOutcome(), false, true, true);
    expect(result.retaliationDamage).toBe(5);
    expect(result.retaliationCount).toBe(2);
  });
});
