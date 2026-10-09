import { describe, it, expect } from 'vitest';
import { climbCostMp, structureSurfaceAt, structureClimbCostBetween, flightBlockedHexes, climbPlan, CLIMB_MP_PER_STEP, edgeStructureElevation } from '@/packages/movement';
import { blankStructureTemplate } from '@/packages/movement';
import { directionBetween, edgeRef } from '@/packages/movement';
import { StructureTemplate, StructureInstance } from '@/types/structure';

const tmpl = (over: Partial<StructureTemplate>): StructureTemplate => ({ ...blankStructureTemplate(), id: 't', createdAt: '', updatedAt: '', ...over });
const inst = (templateId: string, over: Partial<StructureInstance> = {}): StructureInstance => ({ templateId, ...over });

describe('structure elevation (2b)', () => {
  it('climbCostMp: 10 ft = 4 MP, 20 ft = 8 MP, 0 = free', () => {
    expect(climbCostMp(10)).toBe(4);
    expect(climbCostMp(20)).toBe(8);
    expect(climbCostMp(0)).toBe(0);
    expect(CLIMB_MP_PER_STEP).toBe(4);
  });

  it('climbPlan: rises as far as MP allows; completes only when affordable AND free', () => {
    expect(climbPlan(20, 8, 0, false)).toMatchObject({ steps: 2, cost: 8, complete: true, atTop: false });
    expect(climbPlan(20, 6, 0, false)).toMatchObject({ steps: 1, cost: 4, complete: false });
    expect(climbPlan(20, 8, 0, true)).toMatchObject({ steps: 2, complete: false });
    expect(climbPlan(20, 8, 2, false).atTop).toBe(true);
    expect(climbPlan(10, 3, 0, false).steps).toBe(0);
    // Continuing a partway climb (1 step done) with enough budget finishes it.
    expect(climbPlan(20, 4, 1, false)).toMatchObject({ steps: 1, complete: true });
  });

  it('structureSurfaceAt: a hex structure defines its surface, else 0', () => {
    const templates = { tower: tmpl({ anchor: 'hex', elevation: 20 }) };
    const structures = { '2,0': inst('tower') };
    expect(structureSurfaceAt({ q: 2, r: 0 }, structures, templates)).toBe(20);
    expect(structureSurfaceAt({ q: 5, r: 0 }, structures, templates)).toBe(0);
  });

  it('climbing onto a higher hex structure costs height/2.5', () => {
    const templates = { tower: tmpl({ anchor: 'hex', elevation: 10 }) };
    const structures = { '1,0': inst('tower') };
    expect(structureClimbCostBetween({ q: 0, r: 0 }, { q: 1, r: 0 }, structures, templates)).toBe(4);
  });

  it('same-surface movement has no climb', () => {
    const templates = { tower: tmpl({ anchor: 'hex', elevation: 10 }) };
    const structures = { '0,0': inst('tower'), '1,0': inst('tower') };
    expect(structureClimbCostBetween({ q: 0, r: 0 }, { q: 1, r: 0 }, structures, templates)).toBe(0);
  });

  it('an ignore_climb edge modifier waives the climb', () => {
    const templates = {
      stair: tmpl({ anchor: 'edge', elevation: 10, modifiers: [{ kind: 'ignore_climb' }] }),
      tower: tmpl({ anchor: 'hex', elevation: 10 }),
    };
    const dir = directionBetween({ q: 0, r: 0 }, { q: 1, r: 0 });
    const key = edgeRef(0, 0, dir).key;
    const structures = { [key]: inst('stair'), '1,0': inst('tower') };
    expect(structureClimbCostBetween({ q: 0, r: 0 }, { q: 1, r: 0 }, structures, templates)).toBe(0);
  });

  it('a waiveClimb mover ignores any climb', () => {
    const templates = { tower: tmpl({ anchor: 'hex', elevation: 10 }) };
    const structures = { '1,0': inst('tower') };
    expect(structureClimbCostBetween({ q: 0, r: 0 }, { q: 1, r: 0 }, structures, templates)).toBe(4);
    expect(structureClimbCostBetween({ q: 0, r: 0 }, { q: 1, r: 0 }, structures, templates, true)).toBe(0);
  });

  it('flightBlockedHexes: structure tops above the flyer block it', () => {
    const templates = { low: tmpl({ anchor: 'hex', elevation: 10 }), high: tmpl({ anchor: 'hex', elevation: 30 }) };
    const structures = { '1,0': inst('low'), '2,0': inst('high') };
    const blocked = flightBlockedHexes(structures, templates, 20);
    expect(blocked.has('2,0')).toBe(true);
    expect(blocked.has('1,0')).toBe(false);
    // The drop destination may be excluded so the elevation modal can clear it.
    expect(Array.from(flightBlockedHexes(structures, templates, 20, '2,0')).length).toBe(0);
  });

  it('an edge wall derives its height (authored value ignored), min 10 ft', () => {
    // Authored edge elevation 20 but BOTH adjacent hexes are open ground → derived 10.
    const templates = { wall: tmpl({ anchor: 'edge', elevation: 20, doorHp: null, maxHp: 30 }) };
    const dir = directionBetween({ q: 0, r: 0 }, { q: 1, r: 0 });
    const key = edgeRef(0, 0, dir).key;
    const structures = { [key]: inst('wall') };
    expect(structureClimbCostBetween({ q: 0, r: 0 }, { q: 1, r: 0 }, structures, templates)).toBe(4);
  });

  it('an edge wall matches a taller adjacent hex surface', () => {
    const templates = { wall: tmpl({ anchor: 'edge', doorHp: null, maxHp: 30 }), tower: tmpl({ anchor: 'hex', elevation: 20 }) };
    const dir = directionBetween({ q: 0, r: 0 }, { q: 1, r: 0 });
    const key = edgeRef(0, 0, dir).key;
    // A 20-ft tower on (0,0) raises the wall beside it to 20 ft.
    const structures = { [key]: inst('wall'), '0,0': inst('tower') };
    expect(structureClimbCostBetween({ q: 0, r: 0 }, { q: 1, r: 0 }, structures, templates)).toBe(8);
  });

  it('edgeStructureElevation: max(10, the two adjacent hex surfaces)', () => {
    const templates = { tower: tmpl({ anchor: 'hex', elevation: 30 }) };
    const structures = { '1,0': inst('tower') };
    expect(edgeStructureElevation({ q: 0, r: 0 }, { q: 1, r: 0 }, structures, templates)).toBe(30);
    expect(edgeStructureElevation({ q: 5, r: 5 }, { q: 6, r: 5 }, structures, templates)).toBe(10);
  });
});
