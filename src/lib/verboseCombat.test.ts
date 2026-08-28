import { describe, expect, it } from 'vitest';
import {
  formatAttackRolls,
  formatHitCritRolls,
  formatDamageFaces,
  formatSaveRolls,
  formatSpellBaseFaces,
  formatStrikeDetail,
} from './verboseCombat';
import type { SingleAttackResult } from './unitCombat';
import type { SpellDamageResult } from './spellDamage';

function atk(partial: Partial<SingleAttackResult>): SingleAttackResult {
  return {
    roll: 10,
    isCrit: false,
    attackValue: 10,
    isHit: false,
    rawDamage: 0,
    actualDamage: 0,
    damageFaces: [],
    ...partial,
  };
}

describe('verboseCombat', () => {
  describe('formatAttackRolls', () => {
    it('prints bonus, AC and sorted rolls', () => {
      const attacks = [atk({ roll: 15 }), atk({ roll: 3 }), atk({ roll: 11 }), atk({ roll: 20 })];
      expect(formatAttackRolls(attacks, 3, 12)).toBe('{D20+3 vs 12: 3,11,15,20}');
    });
  });

  describe('formatHitCritRolls', () => {
    it('splits hit and crit rolls, sorted, omitting empty halves', () => {
      const attacks = [
        atk({ roll: 11, isHit: true }),
        atk({ roll: 13, isHit: true }),
        atk({ roll: 20, isHit: true, isCrit: true }),
        atk({ roll: 9 }),
      ];
      expect(formatHitCritRolls(attacks)).toBe('2 hits {11,13}, 1 critical {20}');
    });

    it('omits hits segment when no hits', () => {
      const attacks = [atk({ roll: 20, isHit: true, isCrit: true })];
      expect(formatHitCritRolls(attacks)).toBe('1 critical {20}');
    });
  });

  describe('formatDamageFaces', () => {
    it('shows hit faces as-is and crit faces once with the multiplier label', () => {
      const attacks = [
        atk({ isHit: true, damageFaces: [3] }),
        atk({ isHit: true, damageFaces: [5] }),
        atk({ isHit: true, isCrit: true, damageFaces: [4] }),
      ];
      expect(formatDamageFaces(attacks, '1d8+2', false)).toBe('{1d8+2: 3,5; (1d8+2)×2: 4}');
    });

    it('applies ×4 when crit and charging', () => {
      const attacks = [atk({ isHit: true, isCrit: true, damageFaces: [2] })];
      expect(formatDamageFaces(attacks, '1d6+1', true)).toBe('{(1d6+1)×4: 2}');
    });

    it('sorts faces across attacks', () => {
      const attacks = [
        atk({ isHit: true, damageFaces: [6] }),
        atk({ isHit: true, damageFaces: [1] }),
      ];
      expect(formatDamageFaces(attacks, '1d6', false)).toBe('{1d6: 1,6}');
    });

    it('returns empty for an all-miss volley', () => {
      expect(formatDamageFaces([atk({})], '1d6', false)).toBe('');
    });
  });

  describe('formatSaveRolls', () => {
    it('prints sorted save rolls with bonus and DC, skipping healing rows', () => {
      const result: SpellDamageResult = {
        baseDamage: 12,
        baseFaces: [12],
        perTroop: [
          { roll: 15, saveResult: 17, success: true, damage: 6 },
          { roll: 4, saveResult: 6, success: false, damage: 12 },
          { roll: 0, saveResult: 0, success: true, damage: 12 },
        ],
        totalDamage: 30,
      };
      expect(formatSaveRolls(result, 2, 13)).toBe('{D20+2 vs DC 13: 4,15}');
    });
  });

  describe('formatSpellBaseFaces', () => {
    it('prints sorted base dice faces', () => {
      const result: SpellDamageResult = {
        baseDamage: 12,
        baseFaces: [8, 2],
        perTroop: [],
        totalDamage: 0,
      };
      expect(formatSpellBaseFaces(result, '2d6')).toBe('{2d6: 2,8}');
    });

    it('returns empty when no faces', () => {
      const result: SpellDamageResult = { baseDamage: 0, baseFaces: [], perTroop: [], totalDamage: 0 };
      expect(formatSpellBaseFaces(result, '2d6')).toBe('');
    });
  });

  describe('formatStrikeDetail', () => {
    it('composes the full verbose strike clause', () => {
      const attacks = [
        atk({ roll: 11, isHit: true, damageFaces: [3] }),
        atk({ roll: 13, isHit: true, damageFaces: [5] }),
        atk({ roll: 20, isHit: true, isCrit: true, damageFaces: [4] }),
        atk({ roll: 9 }),
      ];
      expect(formatStrikeDetail(attacks, 3, 12, '1d8+2', false, 19))
        .toBe(', {D20+3 vs 12: 9,11,13,20}. 2 hits {11,13}, 1 critical {20}, 19 damage {1d8+2: 3,5; (1d8+2)×2: 4}');
    });

    it('handles an all-miss volley without a double comma', () => {
      const attacks = [atk({ roll: 7 }), atk({ roll: 9 })];
      expect(formatStrikeDetail(attacks, 2, 15, '1d6', false, 0))
        .toBe(', {D20+2 vs 15: 7,9}. 0 damage');
    });
  });
});
