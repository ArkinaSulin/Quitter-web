import { describe, it, expect } from 'vitest';
import { parseStructures, structuresToWalls, isEdgeStructureKey, isHexStructureKey, structureCounts, structureBlocksOrg, zoneBlocksOrg, structureRangeBonus, structureIsOpen, structureHexMoveCost, structureAuraFlags } from './mapStructures';
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

describe('enter_org_max gates', () => {
  const spikes = template({ modifiers: [{ kind: 'enter_org_max', delta: 1 }] });

  it('structureBlocksOrg allows org <= value and blocks above', () => {
    expect(structureBlocksOrg(spikes, 0)).toBe(false);
    expect(structureBlocksOrg(spikes, 1)).toBe(false);
    expect(structureBlocksOrg(spikes, 2)).toBe(true);
    expect(structureBlocksOrg(template({ modifiers: [] }), 3)).toBe(false);
    expect(structureBlocksOrg(null, 3)).toBe(false);
  });

  it('zoneBlocksOrg blocks over-level movers only on the zone hex', () => {
    const zones = [{ key: 'z', q: 0, r: 0, name: 'Spikes', color: '#fff', kind: 'enter_org_max' as const, delta: 1, duration: 3, turnsLeft: 3 }];
    expect(zoneBlocksOrg(zones, 0, 0, 2)).toBe(true);
    expect(zoneBlocksOrg(zones, 0, 0, 1)).toBe(false);
    expect(zoneBlocksOrg(zones, 1, 0, 2)).toBe(false);
    expect(zoneBlocksOrg(null, 0, 0, 2)).toBe(false);
  });
});

describe('hex structure helpers', () => {
  const tower = template({ id: 'tower', anchor: 'hex', hexMoveCost: 2, doorHp: null, modifiers: [{ kind: 'range', delta: 1 }] });
  const gate = template({ id: 'gate', anchor: 'hex', hexMoveCost: 2, doorHp: 30, modifiers: [] });
  const templates = { tower, gate };

  it('structureRangeBonus sums range modifiers at the hex', () => {
    expect(structureRangeBonus({ q: 0, r: 0 }, { '0,0': { templateId: 'tower' } }, templates)).toBe(1);
    expect(structureRangeBonus({ q: 0, r: 0 }, { '0,0': { templateId: 'gate' } }, templates)).toBe(0);
    expect(structureRangeBonus({ q: 1, r: 0 }, {}, templates)).toBe(0);
  });

  it('structureHexMoveCost is 0 for open gates / no structure', () => {
    expect(structureHexMoveCost({ q: 0, r: 0 }, { '0,0': { templateId: 'gate' } }, templates)).toBe(2);
    expect(structureHexMoveCost({ q: 0, r: 0 }, { '0,0': { templateId: 'gate', open: true } }, templates)).toBe(0);
    expect(structureHexMoveCost({ q: 0, r: 0 }, {}, templates)).toBe(0);
  });

  it('structureIsOpen reflects the instance flag', () => {
    expect(structureIsOpen({ templateId: 'gate' })).toBe(false);
    expect(structureIsOpen({ templateId: 'gate', open: true })).toBe(true);
    expect(structureIsOpen(null)).toBe(false);
  });

  it('structureAuraFlags reads tower modifiers, ignoring open/closed', () => {
    const aura = template({ id: 'a', anchor: 'hex', modifiers: [{ kind: 'advantage', delta: 0 }, { kind: 'grant_disadvantage', delta: 0 }] });
    const f = structureAuraFlags({ q: 0, r: 0 }, { '0,0': { templateId: 'a' } }, { a: aura });
    expect(f).toEqual({ advantage: true, disadvantage: false, grantAdvantage: false, grantDisadvantage: true });
    expect(structureAuraFlags({ q: 2, r: 0 }, {}, {})).toEqual({ advantage: false, disadvantage: false, grantAdvantage: false, grantDisadvantage: false });
  });
});

describe('edge structure cover (wood wall regression)', () => {
  // Mirrors the seeded Wood Wall: block + 2 melee / 2 ranged AC on both faces.
  const woodWall = template({
    id: 'wood-wall', anchor: 'edge', battlement: true,
    edgeABlock: true, edgeAMeleeAc: 2, edgeARangedAc: 2,
    edgeBBlock: true, edgeBMeleeAc: 2, edgeBRangedAc: 2,
  });
  const templates = { 'wood-wall': woodWall };

  it('grants its melee/ranged AC to the defender across the edge (either outside)', () => {
    for (const outside of ['a', 'b'] as const) {
      const walls = structuresToWalls({ '0,0,0': { templateId: 'wood-wall', outside } }, templates);
      expect(meleeWallAc(walls, { q: 0, r: 0 }, { q: 1, r: 0 })).toBe(2);
      expect(rangedWallAc(walls, { q: 0, r: 0 }, { q: 1, r: 0 })).toBe(2);
      // ...and the other side likewise.
      expect(meleeWallAc(walls, { q: 1, r: 0 }, { q: 0, r: 0 })).toBe(2);
    }
  });
});
