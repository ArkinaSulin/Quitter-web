import { describe, it, expect } from 'vitest';
import { hexMpLabelAt, makeCostOfHex, mpCostOverrides } from './mapGeometry';
import { StructureTemplate } from '@/types/structure';
import { GroundEffect } from '@/types/gameProtocol';

const template = (over: Partial<StructureTemplate> = {}): StructureTemplate => ({
  id: 't1',
  name: 'Gate',
  description: '',
  anchor: 'hex',
  color: '#c49a58',
  imageUrl: '',
  battlement: false,
  spikes: false,
  hexBorder: true,
  mpFootIn: null,
  mpFootOut: null,
  mpMountedIn: null,
  mpMountedOut: null,
  doorHp: null,
  maxHp: 30,
  dt: 15,
  modifiers: [],
  createdAt: '',
  updatedAt: '',
  ...over,
});

const zone = (q: number, r: number, dice: string): GroundEffect => ({
  key: `z-${q}-${r}-${dice}`,
  q,
  r,
  name: 'Mud',
  color: '#fff',
  kind: 'mp_cost',
  dice,
  duration: 3,
  turnsLeft: 3,
});

describe('hexMpLabelAt', () => {
  it('is null for a plain hex', () => {
    expect(hexMpLabelAt({ q: 0, r: 0 }, null, null, null)).toBeNull();
    expect(hexMpLabelAt({ q: 0, r: 0 }, {}, {}, [])).toBeNull();
  });

  it('shows a zone mp_cost as a single number (foot == mounted)', () => {
    const label = hexMpLabelAt({ q: 1, r: 0 }, null, null, [zone(1, 0, '2')]);
    expect(label?.text).toBe('2');
    expect(label?.blocked).toBe(false);
  });

  it('shows a structure foot cost and a mounted block as "3/X"', () => {
    const t = template({ mpFootIn: 3, mpMountedIn: -1 });
    const label = hexMpLabelAt({ q: 0, r: 0 }, { '0,0': { templateId: 't1' } }, { t1: t }, null);
    expect(label?.text).toBe('3/X');
    expect(label?.blocked).toBe(true);
  });

  it('shows "X" when both locomotions are blocked', () => {
    const t = template({ mpFootIn: -1, mpMountedIn: -1 });
    const label = hexMpLabelAt({ q: 0, r: 0 }, { '0,0': { templateId: 't1' } }, { t1: t }, null);
    expect(label?.text).toBe('X');
    expect(label?.blocked).toBe(true);
  });

  it('takes the higher of structure entry MP and a zone mp_cost', () => {
    const t = template({ mpFootIn: 3, mpMountedIn: 3 });
    const label = hexMpLabelAt({ q: 0, r: 0 }, { '0,0': { templateId: 't1' } }, { t1: t }, [zone(0, 0, '5')]);
    expect(label?.text).toBe('5');
  });

  it('takes the highest of multiple terrain-cost zones (not their sum)', () => {
    const label = hexMpLabelAt({ q: 0, r: 0 }, null, null, [zone(0, 0, '4'), zone(0, 0, '2'), zone(0, 0, '7')]);
    expect(label?.text).toBe('7');
  });

  it('waives the structure MP when its door is open/broken', () => {
    const t = template({ mpFootIn: 3, mpMountedIn: 3, doorHp: 30, maxHp: 30 });
    const label = hexMpLabelAt({ q: 0, r: 0 }, { '0,0': { templateId: 't1', open: true } }, { t1: t }, null);
    expect(label).toBeNull();
  });
});

describe('mpCostOverrides (terrain cost replaces the base MP)', () => {
  it('replaces, not offsets — "4" is 4 MP, not 5', () => {
    expect(mpCostOverrides([zone(0, 0, '4')])).toEqual({ '0,0': 4 });
  });

  it('highest wins when several terrain-cost zones land on one hex', () => {
    expect(mpCostOverrides([zone(0, 0, '2'), zone(0, 0, '5'), zone(0, 0, '3')])).toEqual({ '0,0': 5 });
  });

  it('clamps to 0..9, drops the default 1, and treats negatives as free (0)', () => {
    expect(mpCostOverrides([zone(0, 0, '15')])).toEqual({ '0,0': 9 });
    expect(mpCostOverrides([zone(0, 0, '1')])).toEqual({});
    expect(mpCostOverrides([zone(0, 0, '-2')])).toEqual({ '0,0': 0 });
  });
});

describe('makeCostOfHex (higher of the two)', () => {
  const t = template({ mpFootIn: 3, mpMountedIn: 3 });
  const structures = { '0,0': { templateId: 't1' } };
  const templates = { t1: t };

  it('uses the structure entry MP when no zone overrides it', () => {
    const cost = makeCostOfHex({}, null, { structures, templates, isMounted: false });
    expect(cost(0, 0, -1, 0)).toBe(3); // entering (0,0) from neighbour (-1,0)
  });

  it('returns the higher of structure MP and zone mp_cost', () => {
    const cost = makeCostOfHex({ '0,0': 5 }, null, { structures, templates, isMounted: false });
    expect(cost(0, 0, -1, 0)).toBe(5);
  });

  it('falls back to the zone mp_cost when there is no structure', () => {
    const cost = makeCostOfHex({ '0,0': 2 }, null, { isMounted: false });
    expect(cost(0, 0, -1, 0)).toBe(2);
  });

  it('returns the base 1 MP for a plain hex', () => {
    const cost = makeCostOfHex({}, null, { isMounted: false });
    expect(cost(0, 0, -1, 0)).toBe(1);
  });
});
