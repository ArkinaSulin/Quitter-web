import { describe, it, expect } from 'vitest';
import { attacksBlocked } from './attackBlock';
import { EffectModifier } from './effectTemplates';
import { MapStructures } from './mapStructures';
import { StructureTemplate } from '@/types/structure';
import { GroundEffect } from '@/types/gameProtocol';

// attackBlock only reads `hex` + `effects`, so a partial Unit is fine.
const u = (q: number, r: number, effects: Partial<EffectModifier>[] = []) =>
  ({ hex: { q, r, s: -q - r }, effects } as any);

const block = (over: Partial<EffectModifier> = {}): EffectModifier => ({ kind: 'block_attacks', ...over });

const zone = (q: number, r: number, over: Partial<GroundEffect> = {}): GroundEffect => ({
  key: `z-${q}-${r}`, q, r, name: 'Wall of force', color: '#fff', kind: 'block_attacks',
  duration: 0, turnsLeft: 0, permanent: true, ...over,
});

const tmpl = (mods: Partial<EffectModifier>[]): StructureTemplate =>
  ({ id: 't', name: 'Gate', modifiers: mods } as any);

describe('attacksBlocked — unit carriers', () => {
  it('blocks attacks INTO a unit with direction in/both', () => {
    const target = u(1, 0, [block()]); // both
    expect(attacksBlocked(u(0, 0), target, false)).toBe(true);
    expect(attacksBlocked(u(0, 0), target, true)).toBe(true);
    expect(attacksBlocked(u(0, 0), u(1, 0, [block({ direction: 'in' })]), true)).toBe(true);
  });

  it('blocks attacks OUT of a unit with direction out/both', () => {
    const attacker = u(0, 0, [block({ direction: 'out' })]);
    expect(attacksBlocked(attacker, u(1, 0), false)).toBe(true);
  });

  it('direction in does not block outgoing; out does not block incoming', () => {
    expect(attacksBlocked(u(0, 0, [block({ direction: 'in' })]), u(1, 0), false)).toBe(false);
    expect(attacksBlocked(u(0, 0), u(1, 0, [block({ direction: 'out' })]), false)).toBe(false);
  });

  it('respects the melee/ranged mode', () => {
    expect(attacksBlocked(u(0, 0), u(1, 0, [block({ mode: 'melee' })]), false)).toBe(true);
    expect(attacksBlocked(u(0, 0), u(1, 0, [block({ mode: 'melee' })]), true)).toBe(false);
    expect(attacksBlocked(u(0, 0), u(1, 0, [block({ mode: 'ranged' })]), true)).toBe(true);
  });

  it('ignores non-block kinds', () => {
    expect(attacksBlocked(u(0, 0), u(1, 0, [{ kind: 'advantage' }]), false)).toBe(false);
  });
});

describe('attacksBlocked — ground zones', () => {
  it('a block zone IN the target hex blocks incoming (both directions by default)', () => {
    const zones = [zone(1, 0)];
    expect(attacksBlocked(u(0, 0), u(1, 0), false, { zones })).toBe(true);
    expect(attacksBlocked(u(0, 0), u(1, 0), true, { zones })).toBe(true);
  });

  it('a block zone OUT of the attacker hex blocks outgoing', () => {
    const zones = [zone(0, 0, { direction: 'out' })];
    expect(attacksBlocked(u(0, 0), u(1, 0), false, { zones })).toBe(true);
    expect(attacksBlocked(u(0, 0), u(1, 0, []), false, { zones: [zone(0, 0, { direction: 'in' })] })).toBe(false);
  });
});

describe('attacksBlocked — structure through the edge', () => {
  const structures: MapStructures = { '0,0,0': { templateId: 't', outside: 'a' } };
  const templates = { t: tmpl([block()]) };

  it('a wall with block_attacks blocks a melee attack across it', () => {
    expect(attacksBlocked(u(0, 0), u(1, 0), false, { structures, templates })).toBe(true);
  });

  it('blocks a ranged shot entering through the walled edge (adjacent here)', () => {
    expect(attacksBlocked(u(0, 0), u(1, 0), true, { structures, templates })).toBe(true);
  });

  it('honours direction relative to inside/outside (attacker on outside => crossing IN)', () => {
    const outOnly = { t: tmpl([block({ direction: 'out' })]) };
    expect(attacksBlocked(u(0, 0), u(1, 0), false, { structures, templates: outOnly })).toBe(false);
    const inOnly = { t: tmpl([block({ direction: 'in' })]) };
    expect(attacksBlocked(u(0, 0), u(1, 0), false, { structures, templates: inOnly })).toBe(true);
  });

  it('does not block when the wall has no block_attacks modifier', () => {
    const plain = { t: tmpl([{ kind: 'ac', dice: '2' }]) };
    expect(attacksBlocked(u(0, 0), u(1, 0), false, { structures, templates: plain })).toBe(false);
  });
});
