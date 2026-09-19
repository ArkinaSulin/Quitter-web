import { describe, it, expect } from 'vitest';
import { Unit } from '@/types/gameProtocol';
import { rearHexes, canWithdraw, withdrawDestinations } from './withdraw';

const h = (q: number, r: number) => ({ q, r, s: -q - r });
const mk = (over: Partial<Unit> = {}): Unit => ({
  id: 'u', team: 'red', hex: h(0, 0), facing: 0, isHero: false,
  currentFormation: 'Close Order', organizationLevel: 2, ...over,
} as unknown as Unit);

describe('rearHexes', () => {
  it('returns the two rear-arc hexes for a facing', () => {
    // Facing 0 → dirs 1 (0,1) and 2 (-1,1).
    expect(rearHexes(mk({ hex: h(0, 0), facing: 0 }))).toEqual([h(0, 1), h(-1, 1)]);
    // Facing 3 → dirs 4 (0,-1) and 5 (1,-1).
    expect(rearHexes(mk({ hex: h(0, 0), facing: 3 }))).toEqual([h(0, -1), h(1, -1)]);
  });
});

describe('canWithdraw', () => {
  it('formed non-heroes only', () => {
    expect(canWithdraw(mk({ currentFormation: 'Close Order' }))).toBe(true);
    expect(canWithdraw(mk({ currentFormation: 'Scattered' }))).toBe(false);
    expect(canWithdraw(mk({ currentFormation: 'Routed' }))).toBe(false);
    expect(canWithdraw(mk({ isHero: true, currentFormation: 'Hero' }))).toBe(false);
  });
});

describe('withdrawDestinations', () => {
  it('keeps empty, in-bounds rear hexes', () => {
    const u = mk({ hex: h(0, 0), facing: 0 }); // rear = (0,1),(-1,1)
    expect(withdrawDestinations(u, new Set(['0,1']), 12)).toEqual([h(-1, 1)]);
    expect(withdrawDestinations(u, new Set(), 12)).toEqual([h(0, 1), h(-1, 1)]);
  });
  it('excludes off-board rear hexes', () => {
    const u = mk({ hex: h(0, 0), facing: 0 });
    // radius 0: only (0,0) is in bounds, so neither rear hex qualifies.
    expect(withdrawDestinations(u, new Set(), 0)).toEqual([]);
  });
  it('excludes rear hexes inside an enemy kill zone (no retreat into danger)', () => {
    const u = mk({ hex: h(0, 0), facing: 0 });
    expect(withdrawDestinations(u, new Set(), 12, new Set(['0,1']))).toEqual([h(-1, 1)]);
    expect(withdrawDestinations(u, new Set(), 12, new Set(['0,1', '-1,1']))).toEqual([]);
  });
});
