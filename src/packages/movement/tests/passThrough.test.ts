import { describe, it, expect } from 'vitest';
import { Unit, AllianceGroup } from '@/types/gameProtocol';
import { isPassThroughUnit } from '@/packages/movement/lib/formationRules';
import { loosePassThroughHexes } from '@/packages/movement/lib/passThrough';
import { computeReachableMap } from '@/packages/movement/lib/moveCost';

const h = (q: number, r: number) => ({ q, r, s: -q - r });
const u = (over: Partial<Unit> = {}): Unit => ({
  id: 'u', team: 'blue', hex: h(0, 0), isDeleted: false, attachedToUnitId: null, attachedPosition: null,
  isHero: false, currentFormation: 'Scattered', sizeCategory: 100, elevation: 0,
  currentUnitHp: 10, ...over,
} as unknown as Unit);
const groups: Record<string, AllianceGroup> = { blue: 'friendly', red: 'enemy' };

describe('isPassThroughUnit', () => {
  it('Open Order / Scattered / Routed and heroes <= Large pass; bigger heroes and Close+ do not', () => {
    expect(isPassThroughUnit(u({ currentFormation: 'Open Order' }))).toBe(true);
    expect(isPassThroughUnit(u({ currentFormation: 'Scattered' }))).toBe(true);
    expect(isPassThroughUnit(u({ currentFormation: 'Routed' }))).toBe(true);
    expect(isPassThroughUnit(u({ isHero: true, currentFormation: 'Hero', sizeCategory: 200 }))).toBe(true);
    expect(isPassThroughUnit(u({ isHero: true, currentFormation: 'Hero', sizeCategory: 300 }))).toBe(false);
    expect(isPassThroughUnit(u({ currentFormation: 'Close Order' }))).toBe(false);
    expect(isPassThroughUnit(u({ currentFormation: 'Phalanx' }))).toBe(false);
  });
});

describe('loosePassThroughHexes', () => {
  it('includes only friendly, pass-eligible, same-layer units when the mover also passes', () => {
    const mover = u({ id: 'm', currentFormation: 'Scattered' });
    const friend = u({ id: 'f', hex: h(1, 0), currentFormation: 'Open Order' });
    const closed = u({ id: 'c', hex: h(0, 1), currentFormation: 'Close Order' });
    const enemy = u({ id: 'e', team: 'red', hex: h(-1, 0), currentFormation: 'Scattered' });
    const air = u({ id: 'a', hex: h(0, -1), currentFormation: 'Scattered', elevation: 10 });
    const set = loosePassThroughHexes([mover, friend, closed, enemy, air], mover, groups, 'ground', 0);
    expect(Array.from(set)).toEqual(['1,0']);
  });

  it('a non-pass mover gets an empty set', () => {
    const mover = u({ id: 'm', currentFormation: 'Close Order' });
    const friend = u({ id: 'f', hex: h(1, 0), currentFormation: 'Open Order' });
    expect(loosePassThroughHexes([mover, friend], mover, groups, 'ground', 0).size).toBe(0);
  });
});

describe('computeReachableMap — pass-through', () => {
  it('traverses a pass hex but never returns it as a destination', () => {
    const mover = { hex: h(0, 0), facing: 0, currentFormation: 'Scattered' };
    const occupied = new Set(['1,0']);
    const pass = new Set(['1,0']);
    const reach = computeReachableMap(mover, 2, occupied, new Set(), undefined, false, undefined, undefined, pass);
    expect(reach.has('1,0')).toBe(false); // occupied pass hex is not a destination
    expect(reach.has('2,0')).toBe(true);  // reachable THROUGH the friendly
  });

  it('without pass-through the friendly blocks the path', () => {
    const mover = { hex: h(0, 0), facing: 0, currentFormation: 'Scattered' };
    const occupied = new Set(['1,0']);
    const reach = computeReachableMap(mover, 2, occupied, new Set(), undefined, false, undefined, undefined, new Set());
    expect(reach.has('2,0')).toBe(false);
  });
});
