import { describe, it, expect } from 'vitest';
import { HEX_DIRS, hexDirIndex, frontArcIndices, rearArcIndices, arcOf, frontVertex, rearVertex, rotateLeft, rotateRight } from './hexGeometry';
import { Hex } from '@/types/gameProtocol';

const h = (q: number, r: number): Hex => ({ q, r, s: -q - r });

describe('hexGeometry arcs', () => {
  it('HEX_DIRS is the six cube neighbours in order', () => {
    expect(HEX_DIRS).toHaveLength(6);
    expect(HEX_DIRS[0]).toEqual({ q: 1, r: 0, s: -1 });
    expect(HEX_DIRS[5]).toEqual({ q: 1, r: -1, s: 0 });
  });

  it('hexDirIndex maps neighbours; -1 for same hex / non-adjacent', () => {
    expect(hexDirIndex(h(0, 0), h(1, 0))).toBe(0);
    expect(hexDirIndex(h(0, 0), h(1, -1))).toBe(5);
    expect(hexDirIndex(h(0, 0), h(0, 0))).toBe(-1);
    expect(hexDirIndex(h(0, 0), h(2, 0))).toBe(-1);
  });

  it('frontArcIndices / rearArcIndices track facing', () => {
    expect(frontArcIndices(0)).toEqual([4, 5]);
    expect(rearArcIndices(0)).toEqual([1, 2]);
    expect(frontArcIndices(2)).toEqual([0, 1]);
  });

  it('vertices + rotations', () => {
    expect(frontVertex(0)).toBe(5);
    expect(rearVertex(0)).toBe(2);
    expect(rotateLeft(0)).toBe(5);
    expect(rotateRight(0)).toBe(1);
    expect(rotateLeft(rotateRight(3))).toBe(3);
  });

  it('arcOf: front/flank/rear; same hex & off-grid resolve to front', () => {
    // facing 0: front = HEX_DIRS[4],[5]; rear = [1],[2]; flank = [0],[3]
    expect(arcOf(h(0, 0), 0, h(0, -1))).toBe('front');
    expect(arcOf(h(0, 0), 0, h(1, -1))).toBe('front');
    expect(arcOf(h(0, 0), 0, h(1, 0))).toBe('flank');
    expect(arcOf(h(0, 0), 0, h(-1, 0))).toBe('flank');
    expect(arcOf(h(0, 0), 0, h(0, 1))).toBe('rear');
    expect(arcOf(h(0, 0), 0, h(0, 0))).toBe('front');
    expect(arcOf(h(0, 0), 0, h(3, 0))).toBe('front');
  });
});
