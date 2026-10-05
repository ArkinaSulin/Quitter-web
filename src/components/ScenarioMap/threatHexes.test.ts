import { describe, it, expect } from 'vitest';
import { Unit, Hex, AllianceGroup, Formation } from '@/types/gameProtocol';
import { MapStructures } from '@/lib/mapStructures';
import { StructureTemplate } from '@/types/structure';
import { computeThreatHexes } from './mapGeometry';

// The universal ZoC rule: front-2 same-elevation for formed units; an
// actually-airborne formed flyer dominates its own hex ≤10 ft below (only when
// a hostile is under it); a flyer ALSO projects the front-2 on its own elevation
// (air layer); a grounded garrison on a structure is NOT airborne.

const h = (q: number, r: number): Hex => ({ q, r, s: -q - r });

const unit = (id: string, team: string, hex: Hex, over: Partial<Unit> = {}): Unit => ({
  id, team, hex, isDeleted: false, hidden: false, isHero: false, attachedToUnitId: null,
  currentFormation: 'Open Order', facing: 0, currentUnitHp: 10, maxUnitHp: 10,
  isShielded: false, canCharge: false, isCharging: false, chargeDistance: 0,
  ignoreMoraleChecks: false, currentTroopCount: 1, maxTroopCount: 1,
  elevation: 0, flySpeed: 0, ...over,
} as unknown as Unit);

const form = (name: string, stop: string[] = ['front']): Formation => ({
  name, movement_multiplier: 1, morale_modifier: 0, stop_enemy_movement_arcs: stop,
} as unknown as Formation);

const groups: Record<string, AllianceGroup> = { blue: 'friendly', red: 'enemy' };
const forms: Record<string, Formation> = { 'Open Order': form('Open Order') };

const structures: MapStructures = { '2,0': { templateId: 'tower' } as never };
const templates: Record<string, StructureTemplate> = { tower: { elevation: 10 } as StructureTemplate };

describe('computeThreatHexes — destination-space ZoC', () => {
  it('marks the front-2 of a formed hostile at the same (ground) elevation', () => {
    const f = unit('f', 'blue', h(0, 0));
    const e = unit('e', 'red', h(3, 0), { facing: 0 }); // front (3,-1) & (4,-1)
    const t = computeThreatHexes([f, e], 'f', groups, forms);
    expect(t.has('3,-1')).toBe(true);
    expect(t.has('4,-1')).toBe(true);
  });

  it('does not cross elevation (a ground mover ignores a flyer’s ground-level front)', () => {
    const f = unit('f', 'blue', h(0, 0));
    const e = unit('e', 'red', h(3, 0), { facing: 0, elevation: 10, flySpeed: 60 });
    const t = computeThreatHexes([f, e], 'f', groups, forms);
    expect(t.has('3,-1')).toBe(false);
    expect(t.has('4,-1')).toBe(false);
  });

  it('an airborne flyer’s own hex is threatened only when a hostile is under it', () => {
    const f = unit('f', 'blue', h(0, 0));
    const fly = unit('fly', 'red', h(3, 0), { elevation: 10, flySpeed: 60 });
    // No hostile under the flyer → no vertical threat.
    expect(computeThreatHexes([f, fly], 'f', groups, forms).has('3,0')).toBe(false);
    // A friendly unit 10 ft under the flyer → the flyer's hex is threatened.
    const under = unit('u', 'blue', h(3, 0), { elevation: 0 });
    expect(computeThreatHexes([f, under, fly], 'f', groups, forms).has('3,0')).toBe(true);
  });

  it('a grounded garrison on a structure does not dominate the hex below', () => {
    const f = unit('f', 'blue', h(0, 0));
    const under = unit('u', 'blue', h(2, 0), { elevation: 0 });
    const garrison = unit('g', 'red', h(2, 0), { elevation: 10, flySpeed: 60 }); // grounded at surface 10
    const t = computeThreatHexes([f, under, garrison], 'f', groups, forms, structures, templates);
    expect(t.has('2,0')).toBe(false);
  });

  it('evaluates a grounded mover at the DESTINATION surface (structure edge)', () => {
    const f = unit('f', 'blue', h(0, 0)); // grounded, elevation 0
    // Enemy at elevation 10, facing so (2,0) — the structure top — is in front.
    const e = unit('e', 'red', h(1, 0), { elevation: 10, facing: 2 });
    // Without structures, the destination surface is unknown (falls back to 0) → no threat.
    expect(computeThreatHexes([f, e], 'f', groups, forms).has('2,0')).toBe(false);
    // With structures, the destination hex surface (10) matches the enemy → threatened.
    expect(computeThreatHexes([f, e], 'f', groups, forms, structures, templates).has('2,0')).toBe(true);
  });

  it('an airborne mover uses the air layer (same-elevation front-2)', () => {
    const f = unit('f', 'blue', h(0, 0), { elevation: 10, flySpeed: 60 });
    const e = unit('e', 'red', h(1, 0), { elevation: 10, facing: 2 }); // front includes (2,0)
    expect(computeThreatHexes([f, e], 'f', groups, forms).has('2,0')).toBe(true);
    // A ground enemy (elevation 0) does not project onto the air layer.
    const ground = unit('g', 'red', h(1, 0), { elevation: 0, facing: 2 });
    expect(computeThreatHexes([f, ground], 'f', groups, forms).has('2,0')).toBe(false);
  });
});
