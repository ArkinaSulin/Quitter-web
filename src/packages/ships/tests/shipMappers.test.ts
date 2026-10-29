// src/packages/ships/tests/shipMappers.test.ts
// Locks the snake_case -> camelCase catalog mapping + numeric coercion (PostgREST
// returns `numeric` columns as strings). A raw row fed straight into the editor was
// the NaN bug — camelCase reads of snake_case keys are undefined.

import { describe, expect, it } from 'vitest';
import {
  mapShipAccessoryRow,
  mapShipArmorRow,
  mapShipComponentRow,
  mapShipTemplateRow,
  mapShipTemplateToRow,
  mapShipWeaponRow,
} from '@/packages/ships/lib/shipMappers';

describe('mapShipArmorRow', () => {
  it('maps mass_pct / hp_mult and coerces numerics', () => {
    const a = mapShipArmorRow({ id: 'stone', mass_pct: '0.3', ac: 17, hp_mult: '2' });
    expect(a).toEqual({ id: 'stone', massPct: 0.3, ac: 17, hpMult: 2, imageUrl: '' });
    expect(typeof a.massPct).toBe('number');
  });

  it('falls back to the pre-overhaul columns while the migration is pending', () => {
    const a = mapShipArmorRow({ id: 'ceramic', mass_factor: '0.05', ac: 13, box_hp: 6 });
    expect(a.massPct).toBe(0.05);
    expect(a.hpMult).toBe(2);
  });

  it('wood stays 0 mass / ×1 HP', () => {
    const a = mapShipArmorRow({ id: 'wood', mass_pct: '0', ac: 15, hp_mult: 1 });
    expect(a.massPct).toBe(0);
    expect(a.hpMult).toBe(1);
  });
});

describe('mapShipComponentRow', () => {
  it('maps mass/crew/cost/hittable', () => {
    const c = mapShipComponentRow({ id: 'sail', mass: '1', crew: '0.5', cost: 0, hittable: true });
    expect(c).toEqual({ id: 'sail', mass: 1, crew: 0.5, cost: 0, hittable: true, ac: 10, imageUrl: '' });
  });

  it('keeps fractional rudder crew', () => {
    const c = mapShipComponentRow({ id: 'rudder', mass: '1.5', crew: '0.5', cost: 0, hittable: true });
    expect(c.mass).toBe(1.5);
    expect(c.crew).toBe(0.5);
  });
});

describe('mapShipAccessoryRow', () => {
  it('maps mass/crew/cost/hittable/effect', () => {
    const a = mapShipAccessoryRow({
      id: 'ram', mass: '5', crew: '0', cost: 5000, hittable: true, effect: '16d10 ram',
    });
    expect(a).toEqual({
      id: 'ram', mass: 5, crew: 0, cost: 5000, hittable: true, effect: '16d10 ram', ac: 10, imageUrl: '',
    });
  });
});

describe('mapShipWeaponRow', () => {
  it('coerces fire cycle/range and keeps nulls null', () => {
    const w = mapShipWeaponRow({
      id: 'ballista_light', mount: 'small', damage: '2d10', range_std: 3,
      range_dis: 10, fire_cycle_rd: '2', crew: '2', cost: 500, ammo_cost: 1, special: 'ammo 1gp',
    });
    expect(w).toEqual({
      id: 'ballista_light', mount: 'small', damage: '2d10', rangeStd: 3,
      rangeDis: 10, fireCycleRd: 2, crew: 2, cost: 500, ammoCost: 1, special: 'ammo 1gp',
      ac: 10, imageUrl: '',
    });
  });

  it('null range_dis / ammo_cost stay null', () => {
    const w = mapShipWeaponRow({
      id: 'cannon', mount: 'small', damage: '6d10', range_std: 5, range_dis: null,
      fire_cycle_rd: 10, crew: 4, cost: 7500, ammo_cost: null, special: null,
    });
    expect(w.rangeDis).toBeNull();
    expect(w.ammoCost).toBeNull();
  });
});

describe('mapShipTemplateRow', () => {
  it('maps the mass-first columns + join rows', () => {
    const t = mapShipTemplateRow({
      id: 'wasp', name: 'Wasp Ship', role: 'Shuttle', armor_id: 'wood',
      total_mass: '20', helm: 1, command_bridge: 0, rudders: 2, sails: 6,
      reinforcement: 0, crew_count: '3', crew_quarters: 2, passengers: 1, cargo_area: 8,
      ship_template_accessories: [{ accessory_id: 'ram', count: 1 }],
      ship_template_weapons: [{ weapon_id: 'ballista_light', mount_slot: 'Fore', count: 2 }],
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
    expect(t.accessories).toEqual([{ accessoryId: 'ram', count: 1 }]);
    expect(t.weapons).toEqual([{ weaponId: 'ballista_light', mountSlot: 'Fore', count: 2 }]);
  });
});

describe('mapShipTemplateToRow', () => {
  it('round-trips to snake_case for the DB', () => {
    const row = mapShipTemplateToRow({
      id: 'wasp', name: 'Wasp Ship', role: null, armorId: 'wood',
      totalMass: 20, helm: 1, commandBridge: 0, sails: 6, rudders: 2,
      reinforcement: 0, crewCount: 3, crewQuarters: 2, passengers: 1,
      weaponCapacity: 2, atmosphericSpeed: 5, damageThreshold: 15, imageUrl: 'https://x/ship.png',
      cargoArea: 8, accessories: [], weapons: [], crews: [],
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
