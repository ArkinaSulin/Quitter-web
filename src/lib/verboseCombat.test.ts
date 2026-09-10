import { describe, expect, it } from 'vitest';
import {
  formatAttackRolls,
  formatHitCritRolls,
  formatDamageFaces,
  formatSpellRollLine,
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

    it('prints disadvantage pairs (taken,discarded) sorted by taken, no spaces', () => {
      const attacks = [
        atk({ roll: 4, dicePair: [4, 7] }),
        atk({ roll: 4, dicePair: [4, 20] }),
      ];
      expect(formatAttackRolls(attacks, 3, 12)).toBe('{D20+3 vs 12: (4,7),(4,20)}');
    });

    it('prints advantage-style pairs taken-first, sorted by taken', () => {
      const attacks = [
        atk({ roll: 7, dicePair: [7, 4] }),
        atk({ roll: 20, dicePair: [20, 4] }),
      ];
      expect(formatAttackRolls(attacks, 3, 12)).toBe('{D20+3 vs 12: (7,4),(20,4)}');
    });

    it('falls back to single rolls when only some attacks have pairs', () => {
      const attacks = [atk({ roll: 4, dicePair: [4, 7] }), atk({ roll: 15 })];
      expect(formatAttackRolls(attacks, 3, 12)).toBe('{D20+3 vs 12: 4,15}');
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

  describe('formatSpellRollLine', () => {
    it('prints the shared damage roll + faces, then each troop save total → damage', () => {
      const result: SpellDamageResult = {
        baseDamage: 21,
        baseFaces: [1, 1, 1, 2, 3, 4, 4, 5],
        perTroop: [
          { roll: 14, saveResult: 18, success: true, damage: 10 },
          { roll: 8, saveResult: 13, success: false, damage: 21 },
          { roll: 1, saveResult: 3, success: false, damage: 21 },
          { roll: 16, saveResult: 20, success: true, damage: 10 },
        ],
        totalDamage: 62,
      };
      expect(formatSpellRollLine(result, 16)).toBe('21 (1,1,1,2,3,4,4,5) per troop DC 16 → 18→10, 13→21, 3→21, 20→10');
    });

    it('prints only the damage roll when no troop rolled a save (healing)', () => {
      const result: SpellDamageResult = {
        baseDamage: 12,
        baseFaces: [8, 4],
        perTroop: [
          { roll: 0, saveResult: 0, success: true, damage: 12 },
          { roll: 0, saveResult: 0, success: true, damage: 12 },
        ],
        totalDamage: 24,
      };
      expect(formatSpellRollLine(result, 0)).toBe('12 (4,8) per troop');
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
