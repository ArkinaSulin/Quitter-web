import { describe, it, expect } from 'vitest';
import {
  mapStructureRow,
  mapStructureToRow,
  blankStructureTemplate,
  sanitizeStructureTemplate,
  structureModifiers,
} from './structureTemplates';

describe('mapStructureRow', () => {
  it('parses a snake_case row with nullable stats and modifiers', () => {
    const t = mapStructureRow({
      id: 's1',
      name: 'Wood Wall',
      description: 'blocks',
      anchor: 'edge',
      color: '#c49a58',
      image_url: 'img.png',
      battlement: true,
      edge_a_block: true,
      edge_a_move_cost: null,
      edge_a_melee_ac: 2,
      edge_a_ranged_ac: '3',
      edge_b_block: false,
      edge_b_move_cost: 4,
      edge_b_melee_ac: null,
      edge_b_ranged_ac: null,
      hex_move_cost: null,
      door_hp: null,
      max_hp: 30,
      dt: 15,
      modifiers: [{ kind: 'advantage', delta: 0 }],
      created_at: 'a',
      updated_at: 'b',
    });
    expect(t?.anchor).toBe('edge');
    expect(t?.edgeAMoveCost).toBeNull();
    expect(t?.edgeARangedAc).toBe(3); // string coerced
    expect(t?.edgeBMoveCost).toBe(4);
    expect(t?.doorHp).toBeNull();
    expect(t?.maxHp).toBe(30);
    expect(t?.modifiers).toEqual([{ kind: 'advantage', delta: 0 }]);
  });

  it('defaults unknown anchors to edge and drops junk modifiers', () => {
    const t = mapStructureRow({ anchor: 'triangle', modifiers: [{ kind: 'nope', delta: 3 }, { kind: 'entry', delta: 2 }] });
    expect(t.anchor).toBe('edge');
    expect(t.modifiers).toEqual([{ kind: 'entry', delta: 2 }]);
  });
});

describe('mapStructureToRow', () => {
  const base = blankStructureTemplate();

  it('writes snake_case columns, nulls pass through', () => {
    const row = mapStructureToRow({ ...base, name: '  Gate Tower  ', anchor: 'hex', doorHp: 30, hexMoveCost: 2, maxHp: 100, dt: 15 });
    expect(row.name).toBe('Gate Tower');
    expect(row.anchor).toBe('hex');
    expect(row.door_hp).toBe(30);
    expect(row.hex_move_cost).toBe(2);
    expect(row.max_hp).toBe(100);
    expect(row.edge_a_move_cost).toBeNull();
  });

  it('rounds and clamps negatives to null', () => {
    const row = mapStructureToRow({ ...base, edgeAMoveCost: -3 as any, edgeAMeleeAc: 2.6, maxHp: -5, dt: 15.4 });
    expect(row.edge_a_move_cost).toBeNull();
    expect(row.edge_a_melee_ac).toBe(3);
    expect(row.max_hp).toBe(0);
    expect(row.dt).toBe(15);
  });
});

describe('blankStructureTemplate', () => {
  it('uses the agreed defaults', () => {
    const t = blankStructureTemplate();
    expect(t.maxHp).toBe(30);
    expect(t.dt).toBe(15);
    expect(t.doorHp).toBeNull();
    expect(t.anchor).toBe('edge');
    expect(t.modifiers).toEqual([]);
  });
});

describe('sanitizeStructureTemplate', () => {
  it('clamps DT and drops empty modifiers', () => {
    const t = sanitizeStructureTemplate({
      ...blankStructureTemplate(),
      dt: 1000,
      modifiers: [{ kind: 'advantage', delta: 0 }, null as any, undefined as any],
    });
    expect(t.dt).toBe(999);
    expect(t.modifiers).toHaveLength(1);
  });
});

describe('structureModifiers', () => {
  it('is null-safe', () => {
    expect(structureModifiers(null)).toEqual([]);
    expect(structureModifiers({ modifiers: [{ kind: 'advantage', delta: 0 }] } as any)).toHaveLength(1);
  });
});
