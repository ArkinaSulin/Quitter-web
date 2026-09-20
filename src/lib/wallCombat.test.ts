import { describe, it, expect } from 'vitest';
import { wallAttackKind, resolveWallAttack, edgeHexes } from './wallCombat';
import { edgeRef, Wall } from './walls';
import { Hex } from '@/types/gameProtocol';

const h = (q: number, r: number): Hex => ({ q, r, s: -q - r });

// The canonical edge between (0,0) and (1,0).
const ref = edgeRef(0, 0, 0);

const bow = { damageDice: '1d6', range: 4, maxRange: 8 };
const thrown = { damageDice: '1d4', range: 1, maxRange: 3 };
const sword = { damageDice: '1d8', range: 1, maxRange: 1 };

describe('edgeHexes', () => {
  it('returns both endpoint hexes', () => {
    expect(edgeHexes(ref).map(x => `${x.q},${x.r}`)).toEqual(['0,0', '1,0']);
  });
});

describe('wallAttackKind', () => {
  it('melee when the attacker stands on either edge hex', () => {
    expect(wallAttackKind({ hex: h(0, 0) }, ref, sword)).toBe('melee');
    expect(wallAttackKind({ hex: h(1, 0) }, ref, sword)).toBe('melee');
    expect(wallAttackKind({ hex: h(1, 0) }, ref, bow)).toBe('melee'); // still an adjacent blow
  });

  it('ranged when a ranged weapon reaches the nearer edge hex', () => {
    expect(wallAttackKind({ hex: h(2, 0) }, ref, bow)).toBe('ranged');
    expect(wallAttackKind({ hex: h(0, 5) }, ref, bow)).toBe('ranged'); // dist 5 <= maxRange 8
  });

  it('null when out of range or the weapon cannot shoot', () => {
    expect(wallAttackKind({ hex: h(2, 0) }, ref, sword)).toBeNull(); // melee weapon, not adjacent
    expect(wallAttackKind({ hex: h(5, 0) }, ref, thrown)).toBeNull(); // dist 4 > maxRange 3
    expect(wallAttackKind({ hex: h(2, 0) }, ref, null)).toBeNull();
  });
});

describe('resolveWallAttack', () => {
  const wall = (over: Partial<Wall> = {}): Wall => ({ a: {}, b: {}, maxHp: 10, hp: 10, dt: 3, ...over });

  it('ignores damage at or below the DT (deflected)', () => {
    const rng = () => 0.5; // 1d6 → 4
    const deflected = resolveWallAttack(wall({ dt: 4 }), bow, rng);
    expect(deflected.damage).toBe(4);
    expect(deflected.deflected).toBe(true);
    expect(deflected.applied).toBe(0);
    expect(deflected.wall.hp).toBe(10);
  });

  it('applies full damage when above the DT', () => {
    const rng = () => 0.5; // 1d6 → 4
    const hit = resolveWallAttack(wall(), bow, rng);
    expect(hit.deflected).toBe(false);
    expect(hit.applied).toBe(4);
    expect(hit.wall.hp).toBe(6);
    expect(hit.destroyed).toBe(false);
  });

  it('destroys the segment at 0 HP', () => {
    const rng = () => 0.9; // 1d6 → 6
    const killed = resolveWallAttack(wall({ maxHp: 5, hp: 5 }), bow, rng);
    expect(killed.destroyed).toBe(true);
    expect(killed.wall.hp).toBe(0);
  });

  it('never damages a non-destructible wall', () => {
    const solid = resolveWallAttack({ a: { block: true }, b: {} }, bow, () => 0.9);
    expect(solid.damage).toBe(0);
    expect(solid.applied).toBe(0);
    expect(solid.destroyed).toBe(false);
  });
});
