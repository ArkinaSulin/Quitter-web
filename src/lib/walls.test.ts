import { describe, it, expect } from 'vitest';
import {
  edgeRef,
  wallBetween,
  isBlockedEdge,
  crossingCost,
  meleeWallAc,
  rangedWallAc,
  hasWallEdge,
  nearestEdge,
  nearestWallEdge,
  parseWalls,
  applyWallDamage,
  isDestructibleWall,
  wallHp,
  directionBetween,
  oppositeDir,
  WALL_DIRS,
  Walls,
} from './walls';

const wall = (a: any = {}, b: any = {}): Walls => ({ '0,0,0': { a, b } });

describe('walls geometry', () => {
  it('directionBetween finds the neighbour direction and -1 otherwise', () => {
    expect(directionBetween({ q: 0, r: 0 }, { q: 1, r: 0 })).toBe(0);
    expect(directionBetween({ q: 0, r: 0 }, { q: 0, r: -1 })).toBe(4);
    expect(directionBetween({ q: 0, r: 0 }, { q: 3, r: 0 })).toBe(-1);
  });

  it('oppositeDir adds 3 mod 6', () => {
    expect(oppositeDir(0)).toBe(3);
    expect(oppositeDir(4)).toBe(1);
  });

  it('edgeRef canonicalises both directed edges to one key', () => {
    const fromA = edgeRef(0, 0, 0); // (0,0) -> (1,0)
    const fromB = edgeRef(1, 0, 3); // (1,0) -> (0,0)
    expect(fromA.key).toBe(fromB.key);
    expect(fromA.key).toBe('0,0,0');
    expect(fromA.aq).toBe(0);
    expect(fromA.bq).toBe(1);
  });

  it('canonicalises by the smaller (q, r) tuple regardless of direction', () => {
    // (0,1) -> (0,0) is direction 4's opposite; the canonical endpoint must be (0,0).
    const ref = edgeRef(0, 1, 4);
    expect(ref.aq).toBe(0);
    expect(ref.ar).toBe(0);
    expect(ref.bq).toBe(0);
    expect(ref.br).toBe(1);
  });

  it('wallBetween exposes the face on each side', () => {
    const w = wall({ moveCostFoot: 2 }, { block: true });
    const hit = wallBetween(w, { q: 0, r: 0 }, { q: 1, r: 0 });
    expect(hit?.faceFrom.moveCostFoot).toBe(2);
    expect(hit?.faceTo.block).toBe(true);
  });

  it('crossingCost returns the destination face move cost (replacing terrain)', () => {
    const w = wall({ moveCostFoot: 0 }, { moveCostFoot: 5 });
    expect(crossingCost(w, { q: 0, r: 0 }, { q: 1, r: 0 })).toBe(5); // into b
    expect(crossingCost(w, { q: 1, r: 0 }, { q: 0, r: 0 })).toBe(0); // into a
    expect(crossingCost(w, { q: 0, r: 0 }, { q: 0, r: 1 })).toBeUndefined(); // no wall there
  });

  it('crossingCost picks the locomotion face and ignores negatives (blocks)', () => {
    const w = wall({ moveCostFoot: 2, moveCostMounted: -1 }, {});
    expect(crossingCost(w, { q: 1, r: 0 }, { q: 0, r: 0 }, false)).toBe(2);
    expect(crossingCost(w, { q: 1, r: 0 }, { q: 0, r: 0 }, true)).toBeUndefined();
  });

  it('blockedStep / isBlockedEdge reflect the from-side face', () => {
    const w = wall({ block: true }, {});
    expect(isBlockedEdge(w, { q: 0, r: 0 }, { q: 1, r: 0 })).toBe(true);
    expect(isBlockedEdge(w, { q: 1, r: 0 }, { q: 0, r: 0 })).toBe(false);
    expect(hasWallEdge(w, 1, 0, 0, 0)).toBe(true);
    expect(hasWallEdge(w, 0, 0, 0, 1)).toBe(false); // no wall on that edge
  });

  it('negative MP blocks that locomotion; a door NEVER gates movement', () => {
    const w = wall({}, { moveCostFoot: 2, moveCostMounted: -1 });
    expect(isBlockedEdge(w, { q: 1, r: 0 }, { q: 0, r: 0 }, true)).toBe(true); // mounted blocked
    expect(isBlockedEdge(w, { q: 1, r: 0 }, { q: 0, r: 0 }, false)).toBe(false); // foot passes
    // A "standing door" (doorHp > 0, not open) no longer blocks — mirrors hex.
    const door: Walls = { '0,0,0': { a: {}, b: {}, doorHp: 5 } };
    expect(isBlockedEdge(door, { q: 1, r: 0 }, { q: 0, r: 0 })).toBe(false);
    const openDoor: Walls = { '0,0,0': { a: {}, b: {}, doorHp: 5, open: true } };
    expect(isBlockedEdge(openDoor, { q: 1, r: 0 }, { q: 0, r: 0 })).toBe(false);
  });

  it('melee/ranged wall AC is granted to the defender side', () => {
    const w = wall({ meleeAc: 2, rangedAc: 1 }, { meleeAc: 5, rangedAc: 3 });
    expect(meleeWallAc(w, { q: 1, r: 0 }, { q: 0, r: 0 })).toBe(2);
    expect(meleeWallAc(w, { q: 0, r: 0 }, { q: 1, r: 0 })).toBe(5);
    expect(rangedWallAc(w, { q: 1, r: 0 }, { q: 0, r: 0 })).toBe(1);
  });
});

describe('walls rendering geometry', () => {
  it('nearestEdge picks the edge facing the point', () => {
    expect(nearestEdge({ q: 0, r: 0 }, { x: 60, y: 0 }, 100).dir).toBe(0); // east
    expect(nearestEdge({ q: 0, r: 0 }, { x: -60, y: 0 }, 100).dir).toBe(3); // west
    // The neighbour centre direction (0,1) is 60deg below-right.
    const n = WALL_DIRS[1];
    const center = { x: 100 * (Math.sqrt(3) * n.q + Math.sqrt(3) / 2 * n.r), y: 100 * 1.5 * n.r };
    expect(nearestEdge({ q: 0, r: 0 }, { x: center.x / 2, y: center.y / 2 }, 100).dir).toBe(1);
  });

  it('nearestWallEdge only considers edges that carry a wall', () => {
    const walls: Walls = { '0,0,0': { a: { block: true }, b: {} } };
    // A point right on the east edge, which has the wall.
    expect(nearestWallEdge(walls, { q: 0, r: 0 }, { x: 86, y: 0 }, 100, 20)?.key).toBe('0,0,0');
    // The west edge is close to the point but has no wall → null.
    expect(nearestWallEdge(walls, { q: 0, r: 0 }, { x: -86, y: 0 }, 100, 20)).toBeNull();
    // Too far from any wall edge → null.
    expect(nearestWallEdge(walls, { q: 0, r: 0 }, { x: 0, y: 0 }, 100, 20)).toBeNull();
  });
});

describe('wall destructibility', () => {
  it('isDestructibleWall requires maxHp; wallHp falls back to maxHp', () => {
    expect(isDestructibleWall({ a: {}, b: {} })).toBe(false);
    expect(isDestructibleWall({ a: {}, b: {}, maxHp: 10 })).toBe(true);
    expect(wallHp({ a: {}, b: {}, maxHp: 10 })).toBe(10);
    expect(wallHp({ a: {}, b: {}, maxHp: 10, hp: 4 })).toBe(4);
  });

  it('ignores damage at or below the DT and applies full damage above it', () => {
    const w = { a: {}, b: {}, maxHp: 12, hp: 12, dt: 4 };
    const deflected = applyWallDamage(w, 4);
    expect(deflected.deflected).toBe(true);
    expect(deflected.applied).toBe(0);
    expect(deflected.wall.hp).toBe(12);
    const hit = applyWallDamage(w, 7);
    expect(hit.deflected).toBe(false);
    expect(hit.applied).toBe(7);
    expect(hit.wall.hp).toBe(5);
    expect(hit.destroyed).toBe(false);
  });

  it('destroys at 0 HP and never damages a non-destructible wall', () => {
    const w = { a: {}, b: {}, maxHp: 5, hp: 5 };
    const killed = applyWallDamage(w, 9);
    expect(killed.destroyed).toBe(true);
    expect(killed.wall.hp).toBe(0);
    const solid = applyWallDamage({ a: {}, b: {} }, 99);
    expect(solid.destroyed).toBe(false);
    expect(solid.applied).toBe(0);
  });
});

describe('parseWalls', () => {
  it('keeps valid keys and sanitizes faces', () => {
    const parsed = parseWalls({
      '0,0,0': { a: { moveCostFoot: 3.6, meleeAc: 2, block: true, junk: 1 }, b: { rangedAc: -4 } },
      '1,2,9': { a: {} }, // dir out of range
      bad: { a: {} },
      '2,2,3': 'nope',
    });
    expect(Object.keys(parsed)).toEqual(['0,0,0']);
    expect(parsed['0,0,0'].a).toEqual({ moveCostFoot: 4, meleeAc: 2, block: true });
    expect(parsed['0,0,0'].b).toEqual({ rangedAc: -4 });
  });

  it('parses HP/DT and fills hp from maxHp when omitted', () => {
    const parsed = parseWalls({ '0,0,0': { a: {}, b: {}, maxHp: 10, dt: 3 } });
    expect(parsed['0,0,0'].maxHp).toBe(10);
    expect(parsed['0,0,0'].hp).toBe(10);
    expect(parsed['0,0,0'].dt).toBe(3);
  });

  it('returns {} for non-objects', () => {
    expect(parseWalls(null)).toEqual({});
    expect(parseWalls([])).toEqual({});
  });
});
