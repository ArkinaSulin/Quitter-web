import { describe, it, expect } from 'vitest';
import { unitsBlockingLine, hasLineOfSight, structuresBlockingLine } from '@/packages/combat/lib/lineOfSight';
import { Hex } from '@/types/gameProtocol';
import { edgeRef } from '@/packages/movement';

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

describe('structuresBlockingLine (height-aware)', () => {
  const tpl = (elevation: number) => ({ id: 't', name: 'W', maxHp: 10, elevation }) as any;

  it('a hex structure strictly between blocks a 0-ft shot (cases 1 & 2)', () => {
    const from = h(0, 0);
    const to = h(0, -2); // structure on the middle hex (0,-1)
    expect(structuresBlockingLine(from, to, { '0,-1': { templateId: 't' } }, { t: tpl(10) }, { fromElevation: 0, toElevation: 0 })).toBe(true);
  });

  it('a 10-ft-tall structure still blocks a target at 10 ft (case 3)', () => {
    // line at t=0.5 = 0 + (10-0)*0.5 = 5 < 10 → blocked
    expect(structuresBlockingLine(h(0, 0), h(0, -2), { '0,-1': { templateId: 't' } }, { t: tpl(10) }, { fromElevation: 0, toElevation: 10 })).toBe(true);
  });

  it('a target at 20 ft clears a 10-ft structure (case 4)', () => {
    // line at t=0.5 = 0 + (20-0)*0.5 = 10 ≥ 10 → clear
    expect(structuresBlockingLine(h(0, 0), h(0, -2), { '0,-1': { templateId: 't' } }, { t: tpl(10) }, { fromElevation: 0, toElevation: 20 })).toBe(false);
  });

  it('a hex structure on A/B own hex never blocks', () => {
    expect(structuresBlockingLine(h(0, 0), h(0, -2), { '0,-2': { templateId: 't' }, '0,0': { templateId: 't' } }, { t: tpl(10) }, { fromElevation: 0, toElevation: 0 })).toBe(false);
  });

  it('ignores decorative (elevation 0) structures', () => {
    expect(structuresBlockingLine(h(0, 0), h(0, -3), { '0,-1': { templateId: 't' } }, { t: tpl(0) }, { fromElevation: 0, toElevation: 0 })).toBe(false);
    expect(structuresBlockingLine(h(0, 0), h(0, -3), null, null)).toBe(false);
  });

  it('an edge wall between two MIDDLE hexes blocks; edges in front of A/B do not', () => {
    const from = h(0, 0);
    const to = h(0, -3); // line (0,0),(0,-1),(0,-2),(0,-3); middle hexes (0,-1),(0,-2)
    const middleEdge = edgeRef(0, -1, 4).key; // (0,-1) -> (0,-2)
    const frontOfA = edgeRef(0, 0, 4).key;    // (0,0) -> (0,-1)
    const frontOfB = edgeRef(0, -2, 4).key;   // (0,-2) -> (0,-3)
    expect(structuresBlockingLine(from, to, { [middleEdge]: { templateId: 't' } }, { t: tpl(10) }, { fromElevation: 0, toElevation: 0 })).toBe(true);
    expect(structuresBlockingLine(from, to, { [frontOfA]: { templateId: 't' } }, { t: tpl(10) }, { fromElevation: 0, toElevation: 0 })).toBe(false);
    expect(structuresBlockingLine(from, to, { [frontOfB]: { templateId: 't' } }, { t: tpl(10) }, { fromElevation: 0, toElevation: 0 })).toBe(false);
  });

  it('hasLineOfSight accounts for height-aware structures', () => {
    const from = h(0, 0);
    const to = h(0, -3);
    expect(hasLineOfSight(from, to, [], new Set(), { '0,-1': { templateId: 't' } }, { t: tpl(10) }, { fromElevation: 0, toElevation: 0 })).toBe(false);
    expect(hasLineOfSight(from, to, [], new Set(), { '0,-1': { templateId: 't' } }, { t: tpl(0) }, { fromElevation: 0, toElevation: 0 })).toBe(true);
  });
});
