import { describe, it, expect } from 'vitest';
import { Unit } from '@/types/gameProtocol';
import { findAttachedHero, heroRideMoveStep, heroDetachStep } from '@/packages/units/lib/heroAttachment';

const h = (q: number, r: number) => ({ q, r, s: -q - r });

const mk = (id: string, over: Partial<Unit> = {}): Unit => ({
  id,
  team: 'red',
  hex: h(0, 0),
  facing: 0,
  isHero: false,
  isDeleted: false,
  hidden: false,
  attachedToUnitId: null,
  attachedPosition: null,
  currentFormation: 'Close Order',
  movementPoints: 4,
  movementPointsAvailable: 0,
  actionsAvailable: 1,
  currentUnitHp: 10,
  maxUnitHp: 10,
  ...over,
} as unknown as Unit);

describe('findAttachedHero', () => {
  it('finds the non-deleted hero riding a host, ignoring unrelated and deleted heroes', () => {
    const host = mk('host');
    const hero = mk('hero', { isHero: true, attachedToUnitId: 'host', attachedPosition: 'front' });
    const deleted = mk('gone', { isHero: true, attachedToUnitId: 'host', isDeleted: true });
    expect(findAttachedHero(host, [host, hero, deleted, mk('other')])?.id).toBe('hero');
  });
  it('returns null when no hero rides the host', () => {
    expect(findAttachedHero(mk('host'), [mk('host'), mk('other')])).toBeNull();
  });
});

describe('heroRideMoveStep', () => {
  it('moves the hero hex to the destination without touching anything else', () => {
    const hero = mk('hero', { isHero: true, attachedToUnitId: 'host', hex: h(0, 0) });
    const step = heroRideMoveStep(hero, h(2, 1), 'hero rides');
    expect(step.type).toBe('MOVE');
    expect(step.unitId).toBe('hero');
    expect(step.changes).toEqual([{ field: 'hex', from: h(0, 0), to: h(2, 1) }]);
  });
});

describe('heroDetachStep', () => {
  it('clears attachment and position, leaving the hex alone', () => {
    const hero = mk('hero', { isHero: true, attachedToUnitId: 'host', attachedPosition: 'back' });
    const step = heroDetachStep(hero, 'hero stays');
    expect(step.type).toBe('DETACH_HERO');
    expect(step.unitId).toBe('hero');
    expect(step.changes).toEqual([
      { field: 'attachedToUnitId', from: 'host', to: null },
      { field: 'attachedPosition', from: 'back', to: null },
    ]);
  });
});
