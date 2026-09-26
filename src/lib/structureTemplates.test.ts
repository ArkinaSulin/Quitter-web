import { describe, it, expect } from 'vitest';
import {
  mapStructureRow,
  mapStructureToRow,
  blankStructureTemplate,
  sanitizeStructureTemplate,
  structureModifiers,
  templateDoorMax,
  structureHasDoor,
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
      spikes: false,
      mp_foot_in: null,
      mp_foot_out: null,
      mp_mounted_in: -1,
      mp_mounted_out: 2,
      door_hp: null,
      max_hp: 30,
      dt: 15,
      modifiers: [{ kind: 'ac', delta: 2, mode: 'melee' }],
      created_at: 'a',
      updated_at: 'b',
    });
    expect(t?.anchor).toBe('edge');
    expect(t?.mpFootIn).toBeNull();
    expect(t?.mpMountedIn).toBe(-1); // kept (hard block)
    expect(t?.mpMountedOut).toBe(2);
    expect(t?.doorHp).toBeNull();
    expect(t?.maxHp).toBe(30);
    expect(t?.hexBorder).toBe(true); // default when the row omits it
    expect(t?.modifiers).toEqual([{ kind: 'ac', dice: '2', mode: 'melee' }]);
    expect(templateDoorMax(t)).toBe(30); // null door defaults to maxHp
  });

  it('reads hex_border when present', () => {
    expect(mapStructureRow({ hex_border: false }).hexBorder).toBe(false);
  });

  it('normalizes a legacy numeric `delta` into `dice`', () => {
    const t = mapStructureRow({ modifiers: [{ kind: 'ac', delta: 2 }] });
    expect(t.modifiers).toEqual([{ kind: 'ac', dice: '2' }]);
  });

  it('defaults unknown anchors to edge and drops junk modifiers', () => {
    const t = mapStructureRow({ anchor: 'triangle', modifiers: [{ kind: 'nope', delta: 3 }, { kind: 'entry', delta: 2 }] });
    expect(t.anchor).toBe('edge');
    expect(t.modifiers).toEqual([{ kind: 'entry', dice: '2' }]);
  });
});

describe('mapStructureToRow', () => {
  const base = blankStructureTemplate();

  it('writes snake_case columns, nulls pass through', () => {
    const row = mapStructureToRow({ ...base, name: '  Gate Tower  ', anchor: 'hex', doorHp: 30, mpFootIn: 2, maxHp: 100, dt: 15 });
    expect(row.name).toBe('Gate Tower');
    expect(row.anchor).toBe('hex');
    expect(row.door_hp).toBe(30);
    expect(row.mp_foot_in).toBe(2);
    expect(row.max_hp).toBe(100);
    expect(row.mp_foot_out).toBeNull();
  });

  it('keeps negative movement (hard block) and clamps door to [0, maxHp]', () => {
    const row = mapStructureToRow({ ...base, mpFootIn: -3 as any, mpMountedIn: 2.6, doorHp: 500, maxHp: -5, dt: 15.4 });
    expect(row.mp_foot_in).toBe(-3);
    expect(row.mp_mounted_in).toBe(3);
    expect(row.max_hp).toBe(0);
    expect(row.door_hp).toBe(0); // clamped to maxHp 0
    expect(row.dt).toBe(15);
  });
});

describe('blankStructureTemplate', () => {
  it('uses the agreed defaults', () => {
    const t = blankStructureTemplate();
    expect(t.maxHp).toBe(30);
    expect(t.dt).toBe(15);
    expect(t.doorHp).toBe(30); // defaults to maxHp (no free passage)
    expect(t.anchor).toBe('edge');
    expect(t.modifiers).toEqual([]);
  });
});

describe('sanitizeStructureTemplate', () => {
  it('clamps DT and door, drops empty modifiers', () => {
    const t = sanitizeStructureTemplate({
      ...blankStructureTemplate(),
      dt: 1000,
      doorHp: 999,
      modifiers: [{ kind: 'advantage', delta: 0 }, null as any, undefined as any],
    });
    expect(t.dt).toBe(999);
    expect(t.doorHp).toBe(30); // clamped to maxHp
    expect(t.modifiers).toHaveLength(1);
  });
});

describe('structureHasDoor', () => {
  it('is true only for a distinct 0 < door_hp < max_hp pool', () => {
    expect(structureHasDoor({ doorHp: 30, maxHp: 100 } as any)).toBe(true);
    expect(structureHasDoor({ doorHp: 30, maxHp: 30 } as any)).toBe(false); // door == max -> no separate door
    expect(structureHasDoor({ doorHp: null, maxHp: 30 } as any)).toBe(false);
    expect(structureHasDoor({ doorHp: 0, maxHp: 30 } as any)).toBe(false);
    expect(structureHasDoor(null)).toBe(false);
  });
});

describe('structureModifiers', () => {
  it('is null-safe', () => {
    expect(structureModifiers(null)).toEqual([]);
    expect(structureModifiers({ modifiers: [{ kind: 'advantage', delta: 0 }] } as any)).toHaveLength(1);
  });
});
