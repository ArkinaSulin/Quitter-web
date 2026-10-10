import { describe, it, expect } from 'vitest';
import { climbStepsFromFeet, structureSurfaceAt, structureClimbCostBetween, structureClimbPerStep10, flightBlockedHexes, climbPlan, CLIMB_MP_PER_STEP } from '@/packages/movement';
import { blankStructureTemplate } from '@/packages/movement';
import { directionBetween, edgeRef } from '@/packages/movement';
import { StructureTemplate, StructureInstance } from '@/types/structure';

const tmpl = (over: Partial<StructureTemplate>): StructureTemplate => ({ ...blankStructureTemplate(), id: 't', createdAt: '', updatedAt: '', ...over });
const inst = (templateId: string, over: Partial<StructureInstance> = {}): StructureInstance => ({ templateId, ...over });

describe('structure elevation (2b)', () => {
  it('climbStepsFromFeet: height → 10-ft steps (rounded)', () => {
    expect(climbStepsFromFeet(10)).toBe(1);
    expect(climbStepsFromFeet(20)).toBe(2);
    expect(climbStepsFromFeet(0)).toBe(0);
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

  it('climbing onto a higher hex structure costs steps × its per-10-ft mp_*', () => {
    const templates = { tower: tmpl({ anchor: 'hex', elevation: 10 }) };
    const structures = { '1,0': inst('tower') };
    // Height 10 = 1 step; mp_climb_up null = default 4.
    expect(structureClimbCostBetween({ q: 0, r: 0 }, { q: 1, r: 0 }, structures, templates)).toBe(4);
    // An authored per-10-ft (mp_climb_up 2) → 1 step × 2.
    const t2 = { tower: tmpl({ anchor: 'hex', elevation: 10, mpClimbUp: 2 }) };
    expect(structureClimbCostBetween({ q: 0, r: 0 }, { q: 1, r: 0 }, structures, t2)).toBe(2);
    // A 20-ft hex tower = 2 steps.
    const t20 = { tower: tmpl({ anchor: 'hex', elevation: 20, mpClimbUp: 3 }) };
    expect(structureClimbCostBetween({ q: 0, r: 0 }, { q: 1, r: 0 }, structures, t20)).toBe(6);
    // `structureClimbPerStep10` reads the DB value (default 4, 0 = free).
    expect(structureClimbPerStep10(t2.tower, inst('tower'))).toBe(2);
    expect(structureClimbPerStep10(tmpl({ anchor: 'hex', mpClimbUp: 0 }), inst('tower'))).toBe(0);
  });

  it('same-surface movement has no climb', () => {
    const templates = { tower: tmpl({ anchor: 'hex', elevation: 10 }) };
    const structures = { '0,0': inst('tower'), '1,0': inst('tower') };
    expect(structureClimbCostBetween({ q: 0, r: 0 }, { q: 1, r: 0 }, structures, templates)).toBe(0);
  });

  it('an edge mp_* of 0 is a free climb (the ignore_climb replacement)', () => {
    const templates = {
      stair: tmpl({ anchor: 'edge', elevation: 10, doorHp: null, maxHp: 30, mpClimbUp: 0, mpClimbDown: 0 }),
      tower: tmpl({ anchor: 'hex', elevation: 10 }),
    };
    const dir = directionBetween({ q: 0, r: 0 }, { q: 1, r: 0 });
    const key = edgeRef(0, 0, dir).key;
    const structures = { [key]: inst('stair', { outside: 'a' }), '1,0': inst('tower') };
    expect(structureClimbCostBetween({ q: 0, r: 0 }, { q: 1, r: 0 }, structures, templates)).toBe(0);
  });

  it('an edge structure overrides the adjacent hex-surface climb', () => {
    const templates = {
      wall: tmpl({ anchor: 'edge', elevation: 10, doorHp: null, maxHp: 30, mpClimbUp: 2 }),
      tower: tmpl({ anchor: 'hex', elevation: 20 }),
    };
    const dir = directionBetween({ q: 0, r: 0 }, { q: 1, r: 0 });
    const key = edgeRef(0, 0, dir).key;
    const structures = { [key]: inst('wall', { outside: 'a' }), '1,0': inst('tower') };
    // The wall's 1 step × 2 MP wins over the tower's 2 steps × 4 = 8 — not max'd.
    expect(structureClimbCostBetween({ q: 0, r: 0 }, { q: 1, r: 0 }, structures, templates)).toBe(2);
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

  it('an edge wall is climbed by its AUTHORED height in 10-ft steps', () => {
    const templates = { wall: tmpl({ anchor: 'edge', elevation: 20, doorHp: null, maxHp: 30 }) };
    const dir = directionBetween({ q: 0, r: 0 }, { q: 1, r: 0 });
    const key = edgeRef(0, 0, dir).key;
    const structures = { [key]: inst('wall') };
    // 20 ft = 2 steps × the default 4 MP/step.
    expect(structureClimbCostBetween({ q: 0, r: 0 }, { q: 1, r: 0 }, structures, templates)).toBe(8);
  });

  it('the authored mp_* is the per-10-ft climb cost, direction-dependent', () => {
    const templates = { wall: tmpl({ anchor: 'edge', elevation: 10, doorHp: null, maxHp: 30, mpClimbUp: 2, mpClimbDown: 5 }) };
    const dir = directionBetween({ q: 0, r: 0 }, { q: 1, r: 0 });
    const key = edgeRef(0, 0, dir).key;
    // outside = canonical face A = (0,0): (0,0)->(1,0) is outside->inside → `_in` = 2.
    const outAB = { [key]: inst('wall', { outside: 'a' }) };
    expect(structureClimbCostBetween({ q: 0, r: 0 }, { q: 1, r: 0 }, outAB, templates)).toBe(2);
    // outside = face B = (1,0): the same crossing is inside->outside → `_out` = 5.
    const outBA = { [key]: inst('wall', { outside: 'b' }) };
    expect(structureClimbCostBetween({ q: 0, r: 0 }, { q: 1, r: 0 }, outBA, templates)).toBe(5);
  });

  it('a mounted mover uses the mounted mp_*', () => {
    const templates = { wall: tmpl({ anchor: 'edge', elevation: 10, doorHp: null, maxHp: 30, mpClimbUp: 2, mpMountedUp: 6 }) };
    const dir = directionBetween({ q: 0, r: 0 }, { q: 1, r: 0 });
    const key = edgeRef(0, 0, dir).key;
    const structures = { [key]: inst('wall', { outside: 'a' }) };
    expect(structureClimbCostBetween({ q: 0, r: 0 }, { q: 1, r: 0 }, structures, templates, false, true)).toBe(6);
  });

  it('a low edge (height < 10 ft, e.g. a barricade) needs no climb', () => {
    const templates = { barricade: tmpl({ anchor: 'edge', elevation: 0, doorHp: 0, maxHp: 0 }) };
    const dir = directionBetween({ q: 0, r: 0 }, { q: 1, r: 0 });
    const key = edgeRef(0, 0, dir).key;
    const structures = { [key]: inst('barricade') };
    expect(structureClimbCostBetween({ q: 0, r: 0 }, { q: 1, r: 0 }, structures, templates)).toBe(0);
  });
});
