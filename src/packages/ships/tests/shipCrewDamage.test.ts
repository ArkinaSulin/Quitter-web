import { describe, expect, it } from 'vitest';
import type { ShipRuntime } from '@/packages/ships';
import {
  pickDistinct,
  rollMaxTargets,
  shipCardCrewTargets,
  shipCrewHitCount,
} from '@/packages/ships';
import type { Unit } from '@/types/gameProtocol';

function ship(overrides: Partial<ShipRuntime> = {}): ShipRuntime {
  return {
    id: 'ship-1',
    stations: {
      'component:helm': { crewIds: ['c1'], heroIds: ['h1'] },
      'component:sail': { crewIds: ['dead', 'c2'] },
    },
    crewState: {
      c1: { hp: 12 },
      c2: { hp: 8 },
      dead: { hp: 0, dead: true },
    },
    snapshot: {
      template: {
        crews: [
          { id: 'c1', name: 'Bosun', level: 3, hp: 20 },
          { id: 'c2', name: 'Deckhand', level: 1, hp: 10 },
          { id: 'dead', name: 'Lost', level: 1, hp: 10 },
        ],
      } as never,
    } as never,
    ...overrides,
  } as unknown as ShipRuntime;
}

function hero(id: string, name: string, hp = 14): Unit {
  return {
    id,
    unitName: name,
    isHero: true,
    isDeleted: false,
    attachedToShipId: 'ship-1',
    currentUnitHp: hp,
  } as unknown as Unit;
}

describe('rollMaxTargets', () => {
  it('rolls 1..maxTargets and always allows at least one', () => {
    expect(rollMaxTargets(3, () => 0)).toBe(1);
    expect(rollMaxTargets(3, () => 0.99)).toBe(3);
    expect(rollMaxTargets(1, () => 0.99)).toBe(1);
    expect(rollMaxTargets(0, () => 0.99)).toBe(1);
  });
});

describe('pickDistinct', () => {
  it('never picks the same target twice', () => {
    const picked = pickDistinct(['a', 'b', 'c'], 3, () => 0);
    expect(new Set(picked).size).toBe(3);
  });

  it('caps at the available targets', () => {
    expect(pickDistinct(['a'], 3, () => 0)).toEqual(['a']);
  });
});

describe('shipCardCrewTargets', () => {
  it('returns living crew and boarded heroes only', () => {
    const targets = shipCardCrewTargets(ship(), [hero('h1', 'Aria')], 'component:helm');
    expect(targets).toEqual([
      { id: 'c1', kind: 'crew', name: 'Bosun', hp: 12 },
      { id: 'h1', kind: 'hero', name: 'Aria', hp: 14 },
    ]);
  });

  it('skips dead crew and wounded-out heroes', () => {
    const targets = shipCardCrewTargets(
      ship(),
      [hero('h1', 'Aria', 0)],
      'component:sail',
    );
    expect(targets.map(t => t.id)).toEqual(['c2']);
  });

  it('caps the hit count by the living targets', () => {
    expect(shipCrewHitCount(3, 0, () => 0.99)).toBe(0);
    expect(shipCrewHitCount(3, 2, () => 0.99)).toBe(2);
    expect(shipCrewHitCount(3, 5, () => 0.99)).toBe(3);
  });
});
