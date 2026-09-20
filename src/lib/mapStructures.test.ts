import { describe, it, expect } from 'vitest';
import { parseStructures, structuresToWalls, isEdgeStructureKey, isHexStructureKey, structureCounts } from './mapStructures';
import { StructureTemplate } from '@/types/structure';

const template = (over: Partial<StructureTemplate> = {}): StructureTemplate => ({
  id: 't1',
  name: 'Wood Wall',
  description: '',
  anchor: 'edge',
  color: '#c49a58',
  imageUrl: '',
  battlement: true,
  edgeABlock: true,
  edgeAMoveCost: 1,
  edgeAMeleeAc: 2,
  edgeARangedAc: 2,
  edgeBBlock: false,
  edgeBMoveCost: 3,
  edgeBMeleeAc: 4,
  edgeBRangedAc: null,
  hexMoveCost: null,
  doorHp: null,
  maxHp: 30,
  dt: 15,
  modifiers: [],
  createdAt: '',
  updatedAt: '',
  ...over,
});

describe('key predicates', () => {
  it('distinguishes edge and hex keys', () => {
    expect(isEdgeStructureKey('0,0,3')).toBe(true);
    expect(isHexStructureKey('0,0,3')).toBe(false);
    expect(isHexStructureKey('2,-1')).toBe(true);
    expect(isEdgeStructureKey('2,-1')).toBe(false);
    expect(isEdgeStructureKey('bad')).toBe(false);
  });
});

describe('parseStructures', () => {
  it('keeps valid entries and sanitizes overrides', () => {
    const s = parseStructures({
      '0,0,0': { templateId: 't1', hp: 5.6, maxHp: 30, dt: 15, outside: 'b' },
      '1,-1': { templateId: 't2', doorHp: 30 },
      'bad': { templateId: 't1' },
      '2,2,9': { templateId: 't1' },
      '3,3,1': { templateId: '' },
      '4,4,1': { hp: 5 },
    });
    expect(Object.keys(s).sort()).toEqual(['0,0,0', '1,-1']);
    expect(s['0,0,0']).toEqual({ templateId: 't1', hp: 6, maxHp: 30, dt: 15, outside: 'b' });
    expect(s['1,-1']).toEqual({ templateId: 't2', doorHp: 30 });
  });

  it('returns {} for non-objects', () => {
    expect(parseStructures(null)).toEqual({});
    expect(parseStructures([])).toEqual({});
  });
});

describe('structuresToWalls', () => {
  const templates = { t1: template() };

  it('maps inside/outside faces onto the canonical sides (outside = a)', () => {
    const walls = structuresToWalls({ '0,0,0': { templateId: 't1', outside: 'a' } }, templates);
    const w = walls['0,0,0'];
    // a = OUTSIDE (template B): no block, cost 3, melee AC 4.
    expect(w.a).toEqual({ moveCost: 3, meleeAc: 4 });
    // b = INSIDE (template A): block, cost 1, melee AC 2, ranged AC 2.
    expect(w.b).toEqual({ block: true, moveCost: 1, meleeAc: 2, rangedAc: 2 });
    expect(w.maxHp).toBe(30);
    expect(w.hp).toBe(30);
    expect(w.dt).toBe(15);
    expect(w.source).toBe('map');
  });

  it('swaps faces when outside = b', () => {
    const walls = structuresToWalls({ '0,0,0': { templateId: 't1', outside: 'b' } }, templates);
    expect(walls['0,0,0'].a).toEqual({ block: true, moveCost: 1, meleeAc: 2, rangedAc: 2 });
    expect(walls['0,0,0'].b).toEqual({ moveCost: 3, meleeAc: 4 });
  });

  it('applies instance durability overrides and skips unknown / hex entries', () => {
    const walls = structuresToWalls(
      {
        '0,0,0': { templateId: 't1', maxHp: 60, hp: 40, dt: 20 },
        '1,-1': { templateId: 't1' }, // hex -> ignored
        '2,0,3': { templateId: 'nope' }, // unknown template -> ignored
      },
      templates,
    );
    expect(Object.keys(walls)).toEqual(['0,0,0']);
    expect(walls['0,0,0'].maxHp).toBe(60);
    expect(walls['0,0,0'].hp).toBe(40);
    expect(walls['0,0,0'].dt).toBe(20);
  });

  it('omits HP for a non-destructible template (maxHp 0)', () => {
    const walls = structuresToWalls({ '0,0,0': { templateId: 't1' } }, { t1: template({ maxHp: 0 }) });
    expect(walls['0,0,0'].maxHp).toBeUndefined();
    expect(walls['0,0,0'].hp).toBeUndefined();
  });
});

describe('structureCounts', () => {
  it('counts edge and hex structures separately', () => {
    expect(structureCounts({ '0,0,0': { templateId: 't' }, '1,-1': { templateId: 't' } })).toEqual({ edges: 1, hexes: 1 });
  });
});
