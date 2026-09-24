import { describe, it, expect } from 'vitest';
import { parseHexEffects, expandHexEffects } from './mapEffects';
import { EffectTemplate } from './effectTemplates';

const template = (over: Partial<EffectTemplate> = {}): EffectTemplate => ({
  id: 't1',
  name: 'Haunted Marsh',
  description: '',
  color: '#81c784',
  imageUrl: '',
  imageScale: 100,
  transparentBackground: false,
  layer: 'below',
  scope: 'zone',
  defaultDuration: 3,
  modifiers: [{ kind: 'ac', dice: '-2' }],
  createdAt: '',
  updatedAt: '',
  ...over,
});

describe('parseHexEffects', () => {
  it('keeps one valid entry per hex and drops junk', () => {
    const out = parseHexEffects([
      { q: 0, r: 0, effectId: 't1' },
      { q: 0, r: 0, effectId: 'dup' }, // second on same hex -> dropped
      { q: 1, r: -1, effectId: 't2' },
      { q: 'x', r: 0, effectId: 't1' },
      { q: 2, r: 2 }, // no effectId
      null,
    ]);
    expect(out).toEqual([{ q: 0, r: 0, effectId: 't1' }, { q: 1, r: -1, effectId: 't2' }]);
  });

  it('returns [] for non-arrays', () => {
    expect(parseHexEffects(null)).toEqual([]);
    expect(parseHexEffects({})).toEqual([]);
  });
});

describe('expandHexEffects', () => {
  it('expands a template into permanent ground zones (one per modifier)', () => {
    const out = expandHexEffects([{ q: 2, r: -3, effectId: 't1' }], { t1: template() });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      key: 'auto-2,-3-0',
      q: 2,
      r: -3,
      name: 'Haunted Marsh',
      kind: 'ac',
      dice: '-2',
      duration: 0,
      turnsLeft: 0,
      permanent: true,
      casterUnitId: null,
    });
  });

  it('splits a composite template across modifiers', () => {
    const composite = template({ modifiers: [{ kind: 'ac', dice: '-2' }, { kind: 'morale', dice: '-1' }] });
    const out = expandHexEffects([{ q: 0, r: 0, effectId: 'c' }], { c: composite });
    expect(out.map(z => z.kind)).toEqual(['ac', 'morale']);
    expect(out.every(z => z.permanent)).toBe(true);
  });

  it('skips unknown template ids and handles null input', () => {
    expect(expandHexEffects([{ q: 0, r: 0, effectId: 'nope' }], {})).toEqual([]);
    expect(expandHexEffects(null, {})).toEqual([]);
  });
});
