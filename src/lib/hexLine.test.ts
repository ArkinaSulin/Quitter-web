import { describe, it, expect } from 'vitest';
import { hexLine, hexEnteringFrom } from './hexLine';
import { Hex } from '@/types/gameProtocol';

const h = (q: number, r: number): Hex => ({ q, r, s: -q - r });

describe('hexLine', () => {
  it('walks a straight axial line inclusive of both endpoints', () => {
    expect(hexLine(h(0, 0), h(2, 0))).toEqual([h(0, 0), h(1, 0), h(2, 0)]);
  });

  it('returns a single hex for the same start and end', () => {
    expect(hexLine(h(3, -1), h(3, -1))).toEqual([h(3, -1)]);
  });

  it('produces one hex per step for a diagonal line', () => {
    const line = hexLine(h(0, 0), h(2, -2));
    expect(line[0]).toEqual(h(0, 0));
    expect(line[line.length - 1]).toEqual(h(2, -2));
    expect(line).toHaveLength(3);
  });
});

describe('hexEnteringFrom', () => {
  it('returns the hex the line passes through just before the defender', () => {
    expect(hexEnteringFrom(h(0, 0), h(3, 0))).toEqual(h(2, 0));
  });

  it('returns null when attacker and defender share a hex', () => {
    expect(hexEnteringFrom(h(1, 1), h(1, 1))).toBeNull();
  });
});
