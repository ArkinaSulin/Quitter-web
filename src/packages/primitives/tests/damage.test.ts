import { describe, it, expect } from 'vitest';
import { clampDamage, rollAppliedDamage, rollDamageDetailed, MIN_DAMAGE } from '@/packages/primitives/lib/damage';

describe('damage parser', () => {
  it('MIN_DAMAGE is 1', () => {
    expect(MIN_DAMAGE).toBe(1);
  });

  it('clampDamage floors at 1 and caps', () => {
    expect(clampDamage(0)).toBe(1);
    expect(clampDamage(-5)).toBe(1);
    expect(clampDamage(0.4)).toBe(1);
    expect(clampDamage(7)).toBe(7);
    expect(clampDamage(7, 3)).toBe(3);
    expect(clampDamage(-2, 3)).toBe(1);
  });

  it('rollDamageDetailed stays RAW (a no-die string rolls 0)', () => {
    expect(rollDamageDetailed('1', () => 0.5)).toEqual({ total: 0, faces: [], bonus: 0 });
  });

  it('rollAppliedDamage floors a low roll to 1 and caps at the target', () => {
    // 1d6-4 rolling a 1 => -3 raw, applied 1.
    const low = rollAppliedDamage('1d6-4', { rng: () => 0 });
    expect(low.raw).toBe(-3);
    expect(low.applied).toBe(1);
    // capped at troopHp (2).
    const capped = rollAppliedDamage('1d6+10', { rng: () => 0.5, cap: 2 });
    expect(capped.applied).toBe(2);
  });

  it('rollAppliedDamage doubles only the FACES (crit/charge)', () => {
    // 1d4 (roll 4 via rng 0.9 -> floor(3.6)+1 = 4) + bonus 2, multiplier 2 => 4*2+2 = 10.
    const r = rollAppliedDamage('1d4+2', { rng: () => 0.9, multiplier: 2 });
    expect(r.faces).toEqual([4]);
    expect(r.raw).toBe(10);
    expect(r.applied).toBe(10);
  });
});
