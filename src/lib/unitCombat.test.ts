import { describe, it, expect } from 'vitest';
import {
  computeRowCapacity,
  computeTotalAttacks,
  determineCombatPosition,
  rollD20,
  rollDamage,
  resolveCombatSequence,
} from './unitCombat';
import { Unit, Hex } from '@/types/gameProtocol';

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
    currentTroopCount: 20,
    maxTroopCount: 20,
    level: 5,
    troopHp: 10,
    maxUnitHp: 200,
    currentUnitHp: 200,
    numberOfAttacks: 1,
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
    hex: { q: 0, r: 0, s: 0 },
    facing: 0,
    team: 'blue',
    isRouting: false,
    hidden: false,
    isDeleted: false,
    organizationLevel: 1,
    actionsAvailable: 1,
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
    numberOfAttacks: 1,
    currentAc: 14,
    troopHp: 10,
    hex: { q: 0, r: -1, s: 1 },
  });

  const defender = makeUnit({
    id: 'def',
    unitName: 'Defender',
    sizeCategory: 100,
    numberOfAttacks: 1,
    currentAc: 14,
    troopHp: 10,
    hex: { q: 0, r: 0, s: 0 },
    facing: 0,
  });

  const aw = { attackBonus: 3, damageDice: '1d8', is_reach: false };
  const dw = { attackBonus: 2, damageDice: '1d6', is_reach: false };

  it('AGR failure returns no attacks', () => {
    const lowAggrAttacker = { ...attacker, aggressiveness: 1 };
    const result = resolveCombatSequence(lowAggrAttacker, defender, aw, dw, 0, 1, seededRng(42));
    expect(result.aggrPassed).toBe(false);
    expect(result.aggrRoll).toBeGreaterThan(1);
    expect(result.firstStrikeAttacks).toHaveLength(0);
    expect(result.retaliationDamage).toBe(0);
  });

  it('AGR pass generates attacks with correct count', () => {
    const result = resolveCombatSequence(attacker, defender, aw, dw, 0, 1, seededRng(42));
    expect(result.aggrPassed).toBe(true);
    expect(result.firstStrikeAttacks.length).toBe(10);
  });

  it('rear attack skips AGR check and retaliation', () => {
    const rearAttacker = { ...attacker, hex: { q: 0, r: 1, s: -1 } };
    const result = resolveCombatSequence(rearAttacker, defender, aw, dw, 0, 1, seededRng(42));
    expect(result.aggrPassed).toBe(true);
    expect(result.position).toBe('rear');
    expect(result.firstStrikeAttacks.length).toBe(10);
    expect(result.retaliationDamage).toBe(0);
  });

  it('flank attack gets half retaliation', () => {
    const flankAttacker = { ...attacker, hex: { q: -1, r: 0, s: 1 } };
    const result = resolveCombatSequence(flankAttacker, defender, aw, dw, 0, 1, seededRng(42));
    expect(result.position).toBe('flank');
    expect(result.firstStrikeAttacks.length).toBe(10);
    expect(result.retaliationAttacks.length).toBe(5);
  });

  it('defender strikes first when defender has reach and attacker does not', () => {
    const noReach = { ...aw, is_reach: false };
    const withReach = { ...dw, is_reach: true };
    const result = resolveCombatSequence(attacker, defender, noReach, withReach, 0, 1, seededRng(42));
    expect(result.strikerFirst).toBe('defender');
  });

  it('attacker strikes first when both have or both lack reach', () => {
    const bothNoReach = resolveCombatSequence(attacker, defender, aw, dw, 0, 1, seededRng(42));
    expect(bothNoReach.strikerFirst).toBe('attacker');

    const bothReach = resolveCombatSequence(
      attacker, defender,
      { ...aw, is_reach: true },
      { ...dw, is_reach: true },
      0, 1, seededRng(42),
    );
    expect(bothReach.strikerFirst).toBe('attacker');
  });

  it('first strike damage is capped at troopHp per hit', () => {
    const highDmg = { ...aw, damageDice: '1d100' };
    const result = resolveCombatSequence(attacker, defender, highDmg, dw, 0, 1, seededRng(42));
    for (const atk of result.firstStrikeAttacks) {
      if (atk.isHit) {
        expect(atk.actualDamage).toBeLessThanOrEqual(defender.troopHp);
      }
    }
  });

  it('uses formation attack modifier', () => {
    const withFormation = resolveCombatSequence(attacker, defender, aw, dw, 2, 1, seededRng(42));
    const withoutFormation = resolveCombatSequence(attacker, defender, aw, dw, 0, 1, seededRng(42));
    expect(withFormation.firstStrikeAttacks.length).toBe(withoutFormation.firstStrikeAttacks.length);
  });

  it('when defender strikes first, attacker retaliates', () => {
    const result = resolveCombatSequence(
      attacker,
      defender,
      { ...aw, is_reach: false },
      { ...dw, is_reach: true },
      0,
      1,
      seededRng(42),
    );
    expect(result.strikerFirst).toBe('defender');
    expect(result.firstStrikeAttacks.length).toBe(10);
    expect(result.retaliationAttacks.length).toBe(10);
  });

  it('routed defender cannot retaliate', () => {
    const routedDefender = { ...defender, isRouting: true };
    const result = resolveCombatSequence(attacker, routedDefender, aw, dw, 0, 1, seededRng(42));
    expect(result.aggrPassed).toBe(true);
    expect(result.firstStrikeAttacks.length).toBe(10);
    expect(result.retaliationDamage).toBe(0);
  });

  it('routed attacker cannot retaliate when defender strikes first', () => {
    const routedAttacker = { ...attacker, isRouting: true };
    const result = resolveCombatSequence(
      routedAttacker,
      defender,
      { ...aw, is_reach: false },
      { ...dw, is_reach: true },
      0,
      1,
      seededRng(42),
    );
    expect(result.strikerFirst).toBe('defender');
    expect(result.firstStrikeAttacks.length).toBe(10);
    expect(result.retaliationDamage).toBe(0);
  });

  it('applies row cap multiplier to attack count', () => {
    const result = resolveCombatSequence(attacker, defender, aw, dw, 0, 2, seededRng(42));
    expect(result.firstStrikeAttacks.length).toBe(20);
  });
});
