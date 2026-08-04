// src/lib/spellDamage.test.ts
import { describe, it, expect } from 'vitest';
import { resolveSpellDamage } from './spellDamage';

function seededRng(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) & 0xffffffff;
    return (s >>> 0) / 0x100000000;
  };
}

describe('resolveSpellDamage', () => {
  it('rolls base damage once and applies it to every failed troop', () => {
    // Deterministic rng: verify by rolling 1d100 — any roll >= DC fails all troops
    // when saveBonus is negative enough, so every troop takes full base damage.
    const result = resolveSpellDamage({
      damageDice: '1d10',
      saveBonus: -20,
      saveDC: 20,
      halfOnSave: true,
      affectedCount: 5,
      troopHp: 100,
      rng: seededRng(42),
    });
    expect(result.baseDamage).toBeGreaterThan(0);
    expect(result.perTroop).toHaveLength(5);
    for (const t of result.perTroop) {
      expect(t.success).toBe(false);
      expect(t.damage).toBe(result.baseDamage);
    }
    expect(result.totalDamage).toBe(result.baseDamage * 5);
  });

  it('applies half (floored) damage on success when halfOnSave is set', () => {
    // saveBonus huge → every troop succeeds → each takes floor(base/2)
    const result = resolveSpellDamage({
      damageDice: '1d6',
      saveBonus: 100,
      saveDC: 5,
      halfOnSave: true,
      affectedCount: 3,
      troopHp: 100,
      rng: seededRng(7),
    });
    const expected = Math.floor(result.baseDamage / 2);
    for (const t of result.perTroop) {
      expect(t.success).toBe(true);
      expect(t.damage).toBe(expected);
    }
    expect(result.totalDamage).toBe(expected * 3);
  });

  it('applies 0 damage on success when negate (halfOnSave false)', () => {
    const result = resolveSpellDamage({
      damageDice: '1d6',
      saveBonus: 100,
      saveDC: 5,
      halfOnSave: false,
      affectedCount: 4,
      troopHp: 100,
      rng: seededRng(7),
    });
    expect(result.baseDamage).toBeGreaterThan(0);
    for (const t of result.perTroop) {
      expect(t.success).toBe(true);
      expect(t.damage).toBe(0);
    }
    expect(result.totalDamage).toBe(0);
  });

  it('caps damage per troop at troopHp', () => {
    const result = resolveSpellDamage({
      damageDice: '1d6',
      saveBonus: -100,
      saveDC: 99,
      halfOnSave: true,
      affectedCount: 2,
      troopHp: 3,
      rng: seededRng(42),
    });
    for (const t of result.perTroop) {
      expect(t.success).toBe(false);
      expect(t.damage).toBeLessThanOrEqual(3);
    }
  });

  it('total damage is the sum of per-troop damage', () => {
    const result = resolveSpellDamage({
      damageDice: '1d20',
      saveBonus: 0,
      saveDC: 10,
      halfOnSave: true,
      affectedCount: 8,
      troopHp: 100,
      rng: seededRng(1234),
    });
    const sum = result.perTroop.reduce((acc, t) => acc + t.damage, 0);
    expect(result.totalDamage).toBe(sum);
  });

  it('reports the raw save roll and save result', () => {
    const result = resolveSpellDamage({
      damageDice: '1d6',
      saveBonus: 5,
      saveDC: 15,
      halfOnSave: true,
      affectedCount: 1,
      troopHp: 100,
      rng: seededRng(1),
    });
    const t = result.perTroop[0];
    expect(t.roll).toBeGreaterThanOrEqual(1);
    expect(t.roll).toBeLessThanOrEqual(20);
    expect(t.saveResult).toBe(t.roll + 5);
    expect(t.success).toBe(t.saveResult >= 15);
  });

  it('handles zero affected troops', () => {
    const result = resolveSpellDamage({
      damageDice: '1d6',
      saveBonus: 0,
      saveDC: 10,
      halfOnSave: true,
      affectedCount: 0,
      troopHp: 100,
      rng: seededRng(42),
    });
    expect(result.perTroop).toHaveLength(0);
    expect(result.totalDamage).toBe(0);
  });
});
