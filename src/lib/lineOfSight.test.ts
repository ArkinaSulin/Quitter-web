import { describe, it, expect } from 'vitest';
import { unitsBlockingLine, hasLineOfSight } from './lineOfSight';
import { Hex } from '@/types/gameProtocol';

const h = (q: number, r: number): Hex => ({ q, r, s: -q - r });

const unit = (id: string, hex: Hex, overrides: Partial<any> = {}) => ({
  id,
  hex,
  isDeleted: false,
  hidden: false,
  currentUnitHp: 10,
  ...overrides,
});

describe('unitsBlockingLine', () => {
  it('reports a unit standing between the endpoints', () => {
    const from = h(0, 0);
    const to = h(0, -3);
    const blocker = unit('b', h(0, -1));
    const blockers = unitsBlockingLine(from, to, [blocker]);
    expect(blockers.map(b => b.id)).toEqual(['b']);
    expect(hasLineOfSight(from, to, [blocker])).toBe(false);
  });

  it('ignores the endpoints themselves', () => {
    const from = h(0, 0);
    const to = h(0, -2);
    const attacker = unit('a', from);
    const target = unit('t', to);
    expect(hasLineOfSight(from, to, [attacker, target])).toBe(true);
  });

  it('a clear line has no blockers', () => {
    const from = h(0, 0);
    const to = h(0, -3);
    expect(hasLineOfSight(from, to, [unit('x', h(2, 0))])).toBe(true);
  });

  it('hidden, deleted and dead units do not block', () => {
    const from = h(0, 0);
    const to = h(0, -3);
    const hidden = unit('h', h(0, -1), { hidden: true });
    const deleted = unit('d', h(0, -1), { isDeleted: true });
    const dead = unit('k', h(0, -1), { currentUnitHp: 0 });
    expect(hasLineOfSight(from, to, [hidden])).toBe(true);
    expect(hasLineOfSight(from, to, [deleted])).toBe(true);
    expect(hasLineOfSight(from, to, [dead])).toBe(true);
  });

  it('excluded ids never count', () => {
    const from = h(0, 0);
    const to = h(0, -3);
    const blocker = unit('b', h(0, -1));
    expect(hasLineOfSight(from, to, [blocker], new Set(['b']))).toBe(true);
  });

  it('adjacent endpoints have nothing between', () => {
    expect(hasLineOfSight(h(0, 0), h(0, -1), [unit('b', h(0, -2))])).toBe(true);
  });
});
