import { describe, it, expect } from 'vitest';
import { wallAttackKind, resolveWallAttack, edgeHexes } from './wallCombat';
import { edgeRef, Wall } from './walls';
import { Hex, Unit, Formation } from '@/types/gameProtocol';

const h = (q: number, r: number): Hex => ({ q, r, s: -q - r });

// Attacker fixture: defaults to a non-routed formed unit facing 0.
const at = (hex: Hex, over: Partial<Pick<Unit, 'facing' | 'currentFormation' | 'isHero'>> = {}) =>
  ({ hex, facing: 0, currentFormation: 'Open Order', isHero: false, ...over });

const form = (meleeArcs: string[]): Formation =>
  ({ melee_target_arcs: meleeArcs, ranged_target_arcs: ['front', 'flank', 'rear'] } as unknown as Formation);

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
    expect(wallAttackKind(at(h(0, 0)), ref, sword)).toBe('melee');
    expect(wallAttackKind(at(h(1, 0)), ref, sword)).toBe('melee');
    expect(wallAttackKind(at(h(1, 0)), ref, bow)).toBe('melee'); // still an adjacent blow
  });

  it('melee is gated by the universal attack arc (normal = front only)', () => {
    // From (0,0) the wall lies toward (1,0) (direction index 0); front at facing 2.
    expect(wallAttackKind(at(h(0, 0), { facing: 2 }), ref, sword, form(['front']))).toBe('melee');
    expect(wallAttackKind(at(h(0, 0), { facing: 5 }), ref, sword, form(['front']))).toBeNull(); // back to the wall
    // Scattered / Hero reach all around.
    expect(wallAttackKind(at(h(0, 0), { facing: 5, currentFormation: 'Scattered' }), ref, sword, form(['front', 'flank', 'rear']))).toBe('melee');
    // Routed cannot strike at all.
    expect(wallAttackKind(at(h(0, 0), { facing: 2, currentFormation: 'Routed' }), ref, sword, form(['front', 'flank', 'rear']))).toBeNull();
  });

  it('ranged when a ranged weapon reaches the nearer edge hex', () => {
    expect(wallAttackKind(at(h(2, 0)), ref, bow)).toBe('ranged');
    expect(wallAttackKind(at(h(0, 5)), ref, bow)).toBe('ranged'); // dist 5 <= maxRange 8
  });

  it('null when out of range or the weapon cannot shoot', () => {
    expect(wallAttackKind(at(h(2, 0)), ref, sword)).toBeNull(); // melee weapon, not adjacent
    expect(wallAttackKind(at(h(5, 0)), ref, thrown)).toBeNull(); // dist 4 > maxRange 3
    expect(wallAttackKind(at(h(2, 0)), ref, null)).toBeNull();
  });
});

describe('resolveWallAttack', () => {
  const wall = (over: Partial<Wall> = {}): Wall => ({ a: {}, b: {}, maxHp: 10, hp: 10, dt: 3, ...over });

  it('ignores damage below the DT (deflected)', () => {
    const rng = () => 0.5; // 1d6 → 4
    const deflected = resolveWallAttack(wall({ dt: 5 }), bow, rng);
    expect(deflected.damage).toBe(4);
    expect(deflected.deflected).toBe(true);
    expect(deflected.applied).toBe(0);
    expect(deflected.wall.hp).toBe(10);
  });

  it('lands a hit at exactly the DT', () => {
    const rng = () => 0.5; // 1d6 → 4
    const atThreshold = resolveWallAttack(wall({ dt: 4 }), bow, rng);
    expect(atThreshold.deflected).toBe(false);
    expect(atThreshold.applied).toBe(4);
    expect(atThreshold.wall.hp).toBe(6);
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

  it('multi-attack sums the surviving hits (DT gate per hit)', () => {
    const rng = () => 0.5; // each 1d6 → 4
    const r = resolveWallAttack(wall({ dt: 3, maxHp: 30, hp: 30 }), bow, rng, 3);
    expect(r.damage).toBe(12);
    expect(r.applied).toBe(12);
    expect(r.rolls).toEqual([4, 4, 4]);
    expect(r.wall.hp).toBe(18);
  });
});
