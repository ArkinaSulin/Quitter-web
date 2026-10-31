// src/packages/ships/tests/shipMappers.test.ts
// Locks the snake_case -> camelCase catalog mapping + numeric coercion (PostgREST
// returns `numeric` columns as strings). A raw row fed straight into the editor was
// the NaN bug — camelCase reads of snake_case keys are undefined.

import { describe, expect, it } from 'vitest';
import {
  mapShipArmorRow,
  mapShipComponentRow,
  mapShipTemplateRow,
  mapShipTemplateToRow,
  mapShipWeaponRow,
} from '@/packages/ships/lib/shipMappers';

describe('mapShipArmorRow', () => {
  it('maps id/name/mass_pct/hp_mult and coerces numerics', () => {
    const a = mapShipArmorRow({ id: 'armor-1', name: 'stone', mass_pct: '0.3', ac: 17, hp_mult: '2' });
    expect(a).toEqual({ id: 'armor-1', name: 'stone', massPct: 0.3, ac: 17, hpMult: 2, imageUrl: '' });
    expect(typeof a.massPct).toBe('number');
  });

  it('falls back to the pre-overhaul columns while the migration is pending', () => {
    const a = mapShipArmorRow({ id: 'armor-2', name: 'ceramic', mass_factor: '0.05', ac: 13, box_hp: 6 });
    expect(a.massPct).toBe(0.05);
    expect(a.hpMult).toBe(2);
  });
});

describe('mapShipComponentRow', () => {
  it('maps id/name/mass/crew/cost/hittable/effect', () => {
    const c = mapShipComponentRow({
      id: 'comp-1', name: 'sail', mass: '1', crew: '0.5', cost: 0, hittable: true, effect: 'wind', built_in: true,
    });
    expect(c).toEqual({
      id: 'comp-1', name: 'sail', mass: 1, crew: 0.5, cost: 0,
      hittable: true, effect: 'wind', builtIn: true, ac: 10, imageUrl: '',
    });
  });

  it('keeps fractional rudder crew', () => {
    const c = mapShipComponentRow({
      id: 'comp-2', name: 'rudder', mass: '1.5', crew: '0.5', cost: 0, hittable: true,
    });
    expect(c.mass).toBe(1.5);
    expect(c.crew).toBe(0.5);
  });
});

describe('mapShipWeaponRow', () => {
  it('coerces mass/range/fire cycle and keeps nulls null', () => {
    const w = mapShipWeaponRow({
      id: 'wpn-1', name: 'ballista_light', mass: '1', damage: '2d10', min_range: 0,
      range: 3, max_range: 10, fire_cycle_step: '2', crew: '2', cost: 500,
      ammo_cost: 1, special: 'ammo 1gp',
    });
    expect(w).toEqual({
      id: 'wpn-1', name: 'ballista_light', mass: 1, damage: '2d10', minRange: 0,
      range: 3, maxRange: 10, fireCycleStep: 2, crew: 2, cost: 500,
      ammoCost: 1, special: 'ammo 1gp', ac: 10, imageUrl: '',
    });
  });

  it('null ammo_cost stays null', () => {
    const w = mapShipWeaponRow({
      id: 'wpn-2', name: 'cannon', mass: '3', damage: '6d10', min_range: 1,
      range: 5, max_range: 12, fire_cycle_step: 10, crew: 4, cost: 7500,
      ammo_cost: null, special: null,
    });
    expect(w.ammoCost).toBeNull();
    expect(w.maxRange).toBe(12);
  });
});

describe('mapShipTemplateRow', () => {
  it('maps the mass-first columns + UUID join rows', () => {
    const t = mapShipTemplateRow({
      id: 'wasp', name: 'Wasp Ship', role: 'Shuttle', armor_id: 'armor-wood',
      total_mass: '20', helm: 1, command_bridge: 0, rudders: 2, sails: 6,
      reinforcement: 0, crew_count: '3', crew_quarters: 2, passengers: 1, cargo_area: 8,
      ship_template_components: [{ component_id: 'acc-ram', count: 1 }],
      ship_template_weapons: [{ weapon_id: 'wpn-ballista', mount_slot: 'Fore', count: 2 }],
    });
    expect(t.totalMass).toBe(20);
    expect(t.helm).toBe(1);
    expect(t.commandBridge).toBe(0);
    expect(t.sails).toBe(6);
    expect(t.reinforcement).toBe(0);
    expect(t.crewCount).toBe(3);
    expect(t.crewQuarters).toBe(2);
    expect(t.passengers).toBe(1);
    expect(t.weaponCapacity).toBe(0);
    expect(t.atmosphericSpeed).toBe(0);
    expect(t.damageThreshold).toBe(15);
    expect(t.imageUrl).toBe('');
    expect(t.optionalComponents).toEqual([{ componentId: 'acc-ram', count: 1 }]);
    expect(t.weapons).toEqual([{ weaponId: 'wpn-ballista', mountSlot: 'Fore', count: 2 }]);
  });
});

describe('mapShipTemplateToRow', () => {
  it('round-trips to snake_case for the DB', () => {
    const row = mapShipTemplateToRow({
      id: 'wasp', name: 'Wasp Ship', role: null, armorId: 'armor-wood',
      totalMass: 20, helm: 1, commandBridge: 0, sails: 6, rudders: 2,
      reinforcement: 0, crewCount: 3, crewQuarters: 2, passengers: 1,
      weaponCapacity: 2, atmosphericSpeed: 5, damageThreshold: 15, imageUrl: 'https://x/ship.png',
      cargoArea: 8, optionalComponents: [], weapons: [], crews: [],
      createdAt: '', updatedAt: '',
    });
    expect(row.total_mass).toBe(20);
    expect(row.helm).toBe(1);
    expect(row.command_bridge).toBe(0);
    expect(row.reinforcement).toBe(0);
    expect(row.crew_quarters).toBe(2);
    expect(row.passengers).toBe(1);
    expect(row.weapon_capacity).toBe(2);
    expect(row.atmospheric_speed).toBe(5);
    expect(row.damage_threshold).toBe(15);
    expect(row.image_url).toBe('https://x/ship.png');
    expect(row.cargo_area).toBe(8);
  });
});
