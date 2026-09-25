import { describe, it, expect } from 'vitest';
import {
  parseStructures, structuresToWalls, isEdgeStructureKey, isHexStructureKey, structureCounts,
  structureBlocksOrg, zoneBlocksOrg, structureRangeBonus, structureIsOpen,
  structureHexEntryCost, structureHexBlocked, structureAuraFlags, structureZones,
} from './mapStructures';
import { meleeWallAc, rangedWallAc } from './walls';
import { StructureTemplate } from '@/types/structure';

const template = (over: Partial<StructureTemplate> = {}): StructureTemplate => ({
  id: 't1',
  name: 'Wood Wall',
  description: '',
  anchor: 'edge',
  color: '#c49a58',
  imageUrl: '',
  battlement: true,
  spikes: false,
  mpFootIn: 1,
  mpFootOut: 3,
  mpMountedIn: -1,
  mpMountedOut: null,
  doorHp: 30,
  maxHp: 30,
  dt: 15,
  modifiers: [{ kind: 'ac', dice: '2', mode: 'melee' }, { kind: 'ac', dice: '2', mode: 'ranged' }],
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
      '0,0,0': { templateId: 't1', hp: 5.6, doorHp: 20, outside: 'b' },
      '1,-1': { templateId: 't2', open: true },
      'bad': { templateId: 't1' },
      '2,2,9': { templateId: 't1' },
      '3,3,1': { templateId: '' },
      '4,4,1': { hp: 5 },
    });
    expect(Object.keys(s).sort()).toEqual(['0,0,0', '1,-1']);
    expect(s['0,0,0']).toEqual({ templateId: 't1', hp: 6, doorHp: 20, outside: 'b' });
    expect(s['1,-1']).toEqual({ templateId: 't2', open: true });
  });

  it('returns {} for non-objects', () => {
    expect(parseStructures(null)).toEqual({});
    expect(parseStructures([])).toEqual({});
  });
});

describe('structuresToWalls', () => {
  const templates = { t1: template() };

  it('maps in/out onto the canonical sides (outside = a)', () => {
    const walls = structuresToWalls({ '0,0,0': { templateId: 't1', outside: 'a' } }, templates);
    const w = walls['0,0,0'];
    // a = OUTSIDE: into-outside MP (foot 3; mounted unset), cover 2/2.
    expect(w.a).toEqual({ moveCostFoot: 3, meleeAc: 2, rangedAc: 2 });
    // b = INSIDE: into-inside MP (foot 1; mounted -1 = block), cover 2/2.
    expect(w.b).toEqual({ moveCostFoot: 1, moveCostMounted: -1, meleeAc: 2, rangedAc: 2 });
    expect(w.maxHp).toBe(30);
    expect(w.hp).toBe(30);
    expect(w.dt).toBe(15);
    expect(w.doorHp).toBe(30);
    expect(w.doorMax).toBe(30);
    expect(w.source).toBe('map');
  });

  it('swaps faces when outside = b', () => {
    const walls = structuresToWalls({ '0,0,0': { templateId: 't1', outside: 'b' } }, templates);
    expect(walls['0,0,0'].a).toEqual({ moveCostFoot: 1, moveCostMounted: -1, meleeAc: 2, rangedAc: 2 });
    expect(walls['0,0,0'].b).toEqual({ moveCostFoot: 3, meleeAc: 2, rangedAc: 2 });
  });

  it('applies instance HP/door/open and skips unknown / hex entries', () => {
    const walls = structuresToWalls(
      {
        '0,0,0': { templateId: 't1', hp: 40, doorHp: 10 },
        '1,-1': { templateId: 't1' }, // hex -> ignored
        '2,0,3': { templateId: 'nope' }, // unknown template -> ignored
      },
      templates,
    );
    expect(Object.keys(walls)).toEqual(['0,0,0']);
    expect(walls['0,0,0'].hp).toBe(40);
    expect(walls['0,0,0'].doorHp).toBe(10);
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

describe('enter_org_max gates', () => {
  const spikes = template({ modifiers: [{ kind: 'enter_org_max', dice: '1' }] });

  it('structureBlocksOrg allows org <= value and blocks above', () => {
    expect(structureBlocksOrg(spikes, 0)).toBe(false);
    expect(structureBlocksOrg(spikes, 1)).toBe(false);
    expect(structureBlocksOrg(spikes, 2)).toBe(true);
    expect(structureBlocksOrg(template({ modifiers: [] }), 3)).toBe(false);
    expect(structureBlocksOrg(null, 3)).toBe(false);
  });

  it('zoneBlocksOrg blocks over-level movers only on the zone hex', () => {
    const zones = [{ key: 'z', q: 0, r: 0, name: 'Spikes', color: '#fff', kind: 'enter_org_max' as const, dice: '1', duration: 3, turnsLeft: 3 }];
    expect(zoneBlocksOrg(zones, 0, 0, 2)).toBe(true);
    expect(zoneBlocksOrg(zones, 0, 0, 1)).toBe(false);
    expect(zoneBlocksOrg(zones, 1, 0, 2)).toBe(false);
    expect(zoneBlocksOrg(null, 0, 0, 2)).toBe(false);
  });
});

describe('hex structure helpers', () => {
  const tower = template({ id: 'tower', anchor: 'hex', mpFootIn: 2, mpMountedIn: -1, doorHp: 0, modifiers: [{ kind: 'range', dice: '1' }] });
  const gate = template({ id: 'gate', anchor: 'hex', mpFootIn: 2, mpMountedIn: -1, doorHp: 30, modifiers: [] });
  const templates = { tower, gate };

  it('structureRangeBonus sums range modifiers at the hex', () => {
    expect(structureRangeBonus({ q: 0, r: 0 }, { '0,0': { templateId: 'tower' } }, templates)).toBe(1);
    expect(structureRangeBonus({ q: 0, r: 0 }, { '0,0': { templateId: 'gate' } }, templates)).toBe(0);
    expect(structureRangeBonus({ q: 1, r: 0 }, {}, templates)).toBe(0);
  });

  it('structureHexEntryCost replaces terrain (undefined for open / no structure)', () => {
    expect(structureHexEntryCost({ q: 0, r: 0 }, { '0,0': { templateId: 'gate' } }, templates, false)).toBe(2);
    expect(structureHexEntryCost({ q: 0, r: 0 }, { '0,0': { templateId: 'gate' } }, templates, true)).toBeUndefined(); // mounted blocked
    expect(structureHexEntryCost({ q: 0, r: 0 }, { '0,0': { templateId: 'gate', open: true } }, templates, false)).toBeUndefined();
    expect(structureHexEntryCost({ q: 0, r: 0 }, {}, templates, false)).toBeUndefined();
  });

  it('structureHexBlocked reflects a standing door or a hard-block MP', () => {
    expect(structureHexBlocked({ q: 0, r: 0 }, { '0,0': { templateId: 'gate' } }, templates, false)).toBe(true); // door 30
    expect(structureHexBlocked({ q: 0, r: 0 }, { '0,0': { templateId: 'gate', open: true } }, templates, false)).toBe(false);
    expect(structureHexBlocked({ q: 0, r: 0 }, { '0,0': { templateId: 'tower' } }, templates, true)).toBe(true); // mounted -1
    expect(structureHexBlocked({ q: 0, r: 0 }, { '0,0': { templateId: 'tower' } }, templates, false)).toBe(false);
  });

  it('structureIsOpen reflects the instance flag', () => {
    expect(structureIsOpen({ templateId: 'gate' })).toBe(false);
    expect(structureIsOpen({ templateId: 'gate', open: true })).toBe(true);
    expect(structureIsOpen(null)).toBe(false);
  });

  it('structureAuraFlags reads tower modifiers, ignoring open/closed', () => {
    const aura = template({ id: 'a', anchor: 'hex', modifiers: [{ kind: 'advantage', dice: '0' }, { kind: 'grant_disadvantage', dice: '0' }] });
    const f = structureAuraFlags({ q: 0, r: 0 }, { '0,0': { templateId: 'a' } }, { a: aura });
    expect(f).toEqual({ advantage: true, disadvantage: false, grantAdvantage: false, grantDisadvantage: true });
    expect(structureAuraFlags({ q: 2, r: 0 }, {}, {})).toEqual({ advantage: false, disadvantage: false, grantAdvantage: false, grantDisadvantage: false });
  });

  it('instance modifier override beats the template', () => {
    const base = template({ id: 'a', anchor: 'hex', modifiers: [{ kind: 'range', dice: '1' }] });
    const overridden = { '0,0': { templateId: 'a', modifiers: [{ kind: 'range' as const, dice: '3' }] } };
    expect(structureRangeBonus({ q: 0, r: 0 }, overridden, { a: base })).toBe(3);
  });
});

describe('structureZones (hex structures → ground zones)', () => {
  it('expands a hex structure\'s modifiers into permanent zones; ignores edges', () => {
    const tower = template({ id: 'tower', anchor: 'hex', modifiers: [{ kind: 'range', dice: '1' }, { kind: 'block_attacks', mode: 'ranged', direction: 'in' }] });
    const zones = structureZones(
      { '2,0': { templateId: 'tower' }, '0,0,0': { templateId: 'tower' } }, // the edge is ignored
      { tower },
    );
    expect(zones).toHaveLength(2);
    expect(zones.map(z => [z.q, z.r])).toEqual([[2, 0], [2, 0]]);
    expect(zones[0]).toMatchObject({ kind: 'range', dice: '1', permanent: true });
    expect(zones[1]).toMatchObject({ kind: 'block_attacks', mode: 'ranged', direction: 'in', permanent: true });
  });

  it('returns [] with no structures', () => {
    expect(structureZones(null, {})).toEqual([]);
  });
});

describe('edge structure cover (wood wall regression)', () => {
  const woodWall = template({ id: 'wood-wall', anchor: 'edge' });
  const templates = { 'wood-wall': woodWall };

  it('grants its melee/ranged AC to the defender across the edge (either outside)', () => {
    for (const outside of ['a', 'b'] as const) {
      const walls = structuresToWalls({ '0,0,0': { templateId: 'wood-wall', outside } }, templates);
      expect(meleeWallAc(walls, { q: 0, r: 0 }, { q: 1, r: 0 })).toBe(2);
      expect(rangedWallAc(walls, { q: 0, r: 0 }, { q: 1, r: 0 })).toBe(2);
      expect(meleeWallAc(walls, { q: 1, r: 0 }, { q: 0, r: 0 })).toBe(2);
    }
  });
});
