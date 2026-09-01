// src/lib/shipMappers.test.ts
// Locks the snake_case -> camelCase catalog mapping + numeric coercion (PostgREST
// returns `numeric` columns as strings). A raw row fed straight into the editor was
// the NaN bug — camelCase reads of snake_case keys are undefined.

import { describe, expect, it } from 'vitest';
import {
  mapShipAccessoryRow,
  mapShipArmorRow,
  mapShipComponentRow,
  mapShipFrameRow,
  mapShipTemplateRow,
  mapShipTemplateToRow,
  mapShipWeaponRow,
} from '@/lib/shipMappers';

describe('mapShipFrameRow', () => {
  it('converts snake_case to camelCase and coerces numerics (numeric -> string)', () => {
    const f = mapShipFrameRow({
      id: 'tiny', mass_cap: '35', base_hp: 200, deck_space: 10, top_speed: 12,
      max_rudders: 2, base_cost: 5000, hull_spaces: 8,
    });
    expect(f).toEqual({
      id: 'tiny', massCap: 35, baseHp: 200, deckSpace: 10, topSpeed: 12,
      maxRudders: 2, baseCost: 5000, hullSpaces: 8,
    });
    expect(typeof f.massCap).toBe('number');
  });
});

describe('mapShipArmorRow', () => {
  it('coerces fractional mass_factor (numeric -> string) to a number', () => {
    const a = mapShipArmorRow({ id: 'plated', mass_factor: '0.2', ac: 17, box_hp: 6, cost_mult: '2' });
    expect(a).toEqual({ id: 'plated', massFactor: 0.2, ac: 17, boxHp: 6, costMult: 2 });
    expect(typeof a.massFactor).toBe('number');
  });

  it('zero-cost/zero-factor armors stay 0, not NaN', () => {
    const a = mapShipArmorRow({ id: 'wood', mass_factor: '0', ac: 15, box_hp: 5, cost_mult: '1' });
    expect(a.massFactor).toBe(0);
    expect(a.costMult).toBe(1);
  });
});

describe('mapShipComponentRow', () => {
  it('keeps null reinforce_order null and converts hittable', () => {
    const c = mapShipComponentRow({ id: 'sail', mass: '2', deck: '0', crew: '0.5', cost: 2000, reinforce_order: null, hittable: true });
    expect(c).toEqual({ id: 'sail', mass: 2, deck: 0, crew: 0.5, cost: 2000, reinforceOrder: null, hittable: true });
  });

  it('coerces a numeric reinforce_order', () => {
    const c = mapShipComponentRow({ id: 'helm_bridge', mass: '2', deck: '6', crew: '1', cost: 0, reinforce_order: 1, hittable: true });
    expect(c.reinforceOrder).toBe(1);
  });
});

describe('mapShipAccessoryRow', () => {
  it('maps pool_type and keeps string fields', () => {
    const a = mapShipAccessoryRow({
      id: 'ram', mass: '5', deck: '2', crew: '0', cost: 5000,
      pool_type: 'mass_x_boxhp', hittable: true, effect: '16d10 ram',
    });
    expect(a).toEqual({
      id: 'ram', mass: 5, deck: 2, crew: 0, cost: 5000,
      poolType: 'mass_x_boxhp', hittable: true, effect: '16d10 ram',
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
  it('maps join rows to accessory/weapon arrays', () => {
    const t = mapShipTemplateRow({
      id: 'wasp', name: 'Wasp Ship', role: 'Shuttle', frame_id: 'tiny', armor_id: 'wood',
      atmosphere_speed: 5, rudders: 2, sails: 6, l_weap: 0, s_weap: 1, hull_r: 0,
      bridge: 0, aux_helm: 0, extra_crew: '0', cargo_area: 8,
      ship_template_accessories: [{ accessory_id: 'ram', count: 1 }],
      ship_template_weapons: [{ weapon_id: 'ballista_light', mount_slot: 'Fore', count: 2 }],
    });
    expect(t.frameId).toBe('tiny');
    expect(t.sails).toBe(6);
    expect(t.extraCrew).toBe(0);
    expect(t.accessories).toEqual([{ accessoryId: 'ram', count: 1 }]);
    expect(t.weapons).toEqual([{ weaponId: 'ballista_light', mountSlot: 'Fore', count: 2 }]);
  });
});

describe('mapShipTemplateToRow', () => {
  it('round-trips to snake_case for the DB', () => {
    const row = mapShipTemplateToRow({
      id: 'wasp', name: 'Wasp Ship', role: null, frameId: 'tiny', armorId: 'wood',
      atmosphereSpeed: 5, rudders: 2, sails: 6, lWeap: 0, sWeap: 1, hullR: 0,
      bridge: 0, auxHelm: 0, extraCrew: 0, cargoArea: 8, accessories: [], weapons: [], crews: [],
      createdAt: '', updatedAt: '',
    });
    expect(row.l_weap).toBe(0);
    expect(row.s_weap).toBe(1);
    expect(row.hull_r).toBe(0);
    expect(row.cargo_area).toBe(8);
  });
});
