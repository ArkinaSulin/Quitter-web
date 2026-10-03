import { describe, it, expect } from 'vitest';
import { climbCostMp, structureSurfaceAt, structureClimbCostBetween, flightBlockedHexes } from './mapStructures';
import { blankStructureTemplate } from './structureTemplates';
import { directionBetween, edgeRef } from './walls';
import { StructureTemplate, StructureInstance } from '@/types/structure';

const tmpl = (over: Partial<StructureTemplate>): StructureTemplate => ({ ...blankStructureTemplate(), id: 't', createdAt: '', updatedAt: '', ...over });
const inst = (templateId: string, over: Partial<StructureInstance> = {}): StructureInstance => ({ templateId, ...over });

describe('structure elevation (2b)', () => {
  it('climbCostMp: 10 ft = 4 MP, 20 ft = 8 MP, 0 = free', () => {
    expect(climbCostMp(10)).toBe(4);
    expect(climbCostMp(20)).toBe(8);
    expect(climbCostMp(0)).toBe(0);
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

  it('stairs on the shared edge waive the climb', () => {
    const templates = {
      stair: tmpl({ anchor: 'edge', stairs: true, elevation: 10 }),
      tower: tmpl({ anchor: 'hex', elevation: 10 }),
    };
    const dir = directionBetween({ q: 0, r: 0 }, { q: 1, r: 0 });
    const key = edgeRef(0, 0, dir).key;
    const structures = { [key]: inst('stair'), '1,0': inst('tower') };
    expect(structureClimbCostBetween({ q: 0, r: 0 }, { q: 1, r: 0 }, structures, templates)).toBe(0);
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

  it('a solid (door-less) edge wall is climbed by its height', () => {
    const templates = { wall: tmpl({ anchor: 'edge', elevation: 20, doorHp: null, maxHp: 30 }) };
    const dir = directionBetween({ q: 0, r: 0 }, { q: 1, r: 0 });
    const key = edgeRef(0, 0, dir).key;
    const structures = { [key]: inst('wall') };
    expect(structureClimbCostBetween({ q: 0, r: 0 }, { q: 1, r: 0 }, structures, templates)).toBe(8);
  });
});
