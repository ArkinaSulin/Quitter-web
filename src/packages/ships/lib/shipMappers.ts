// src/packages/ships/lib/shipMappers.ts
// Supabase row <-> ship model mapping (mirrors templateMappers). The editor and any
// later consumer (ship spawner, ship engine) share these so the camelCase model stays
// consistent with the snake_case ship_* tables.
//
// PostgREST returns `numeric` columns as JSON strings (e.g. "0.2") and integer columns
// as numbers, so every numeric field is coerced via Number(...).

import {
  ShipAccessory,
  ShipArmor,
  ShipComponent,
  ShipCrew,
  ShipTemplate,
  ShipWeapon,
} from '@/types/ship';
import { DEFAULT_TOTAL_MASS } from './shipStats';

/** Map a ship_armors row. */
export function mapShipArmorRow(row: any): ShipArmor {
  return {
    id: row.id,
    name: row.name || '',
    massPct: Number(row.mass_pct ?? row.mass_factor) || 0,
    ac: Number(row.ac) || 0,
    hpMult: Number(row.hp_mult ?? (Number(row.box_hp) > 5 ? 2 : 1)) || 1,
    imageUrl: row.image_url || '',
  };
}

/** Map a ship_components row. */
export function mapShipComponentRow(row: any): ShipComponent {
  return {
    id: row.id,
    name: row.name || '',
    mass: Number(row.mass) || 0,
    crew: Number(row.crew) || 0,
    cost: Number(row.cost) || 0,
    hittable: !!row.hittable,
    effect: row.effect || null,
    ac: row.ac != null ? Number(row.ac) : 10,
    imageUrl: row.image_url || '',
  };
}

/** Map a ship_accessories row. */
export function mapShipAccessoryRow(row: any): ShipAccessory {
  return {
    id: row.id,
    name: row.name || '',
    mass: Number(row.mass) || 0,
    crew: Number(row.crew) || 0,
    cost: Number(row.cost) || 0,
    hittable: !!row.hittable,
    effect: row.effect || null,
    ac: row.ac != null ? Number(row.ac) : 10,
    imageUrl: row.image_url || '',
  };
}

/** Map a ship_weapons row. */
export function mapShipWeaponRow(row: any): ShipWeapon {
  return {
    id: row.id,
    name: row.name || '',
    mass: Number(row.mass) || 0,
    damage: row.damage || '',
    minRange: Number(row.min_range) || 0,
    range: Number(row.range) || 0,
    maxRange: Number(row.max_range) || 0,
    fireCycleStep: Number(row.fire_cycle_step) || 1,
    crew: Number(row.crew) || 0,
    cost: Number(row.cost) || 0,
    ammoCost: row.ammo_cost != null ? Number(row.ammo_cost) : null,
    special: row.special || null,
    ac: row.ac != null ? Number(row.ac) : 10,
    imageUrl: row.image_url || '',
  };
}

/** Map a ship_crews row. */
export function mapShipCrewRow(row: any): ShipCrew {
  return {
    id: row.id,
    name: row.name || null,
    level: Number(row.level) || 1,
    str: Number(row.str) || 10,
    dex: Number(row.dex) || 10,
    con: Number(row.con) || 10,
    int: Number(row.int) || 10,
    wis: Number(row.wis) || 10,
    cha: Number(row.cha) || 10,
    cost: row.cost != null ? Number(row.cost) : null,
  };
}

/** Map a ship_templates row (with its join tables embedded) to a ShipTemplate. */
export function mapShipTemplateRow(row: any): ShipTemplate {
  return {
    id: row.id,
    name: row.name || '',
    role: row.role || null,
    armorId: row.armor_id || '',
    totalMass: Number(row.total_mass ?? row.frame?.mass_cap) || DEFAULT_TOTAL_MASS,
    helm: Number(row.helm) || 1,
    commandBridge: Number(row.command_bridge ?? row.bridge) || 0,
    sails: Number(row.sails) || 0,
    rudders: Number(row.rudders) || 0,
    reinforcement: Number(row.reinforcement ?? row.hull_r) || 0,
    crewCount: Number(row.crew_count ?? row.extra_crew) || 0,
    crewQuarters: Number(row.crew_quarters) || 0,
    passengers: Number(row.passengers) || 0,
    weaponCapacity: Number(row.weapon_capacity) || 0,
    atmosphericSpeed: Number(row.atmospheric_speed) || 0,
    damageThreshold: row.damage_threshold != null ? Number(row.damage_threshold) : 15,
    imageUrl: row.image_url || '',
    cargoArea: Number(row.cargo_area) || 0,
    accessories: (row.ship_template_accessories || []).map((a: any) => ({
      accessoryId: a.accessory_id,
      count: Number(a.count) || 1,
    })),
    weapons: (row.ship_template_weapons || []).map((w: any) => ({
      weaponId: w.weapon_id,
      mountSlot: w.mount_slot || '',
      count: Number(w.count) || 1,
    })),
    crews: (row.ship_crews || []).map(mapShipCrewRow),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Map a ShipTemplate to its ship_templates row (joins excluded). */
export function mapShipTemplateToRow(t: ShipTemplate) {
  return {
    id: t.id,
    name: t.name,
    role: t.role || null,
    armor_id: t.armorId,
    total_mass: t.totalMass,
    helm: t.helm,
    command_bridge: t.commandBridge,
    sails: t.sails,
    rudders: t.rudders,
    reinforcement: t.reinforcement,
    crew_count: t.crewCount,
    crew_quarters: t.crewQuarters,
    passengers: t.passengers,
    weapon_capacity: t.weaponCapacity,
    atmospheric_speed: t.atmosphericSpeed,
    damage_threshold: t.damageThreshold,
    image_url: t.imageUrl,
    cargo_area: t.cargoArea,
    updated_at: new Date().toISOString(),
  };
}

/** ship_template_accessories rows for a template (used to rewrite the join table). */
export function mapAccessoryRows(t: ShipTemplate) {
  return t.accessories
    .filter(a => a.count > 0)
    .map(a => ({ template_id: t.id, accessory_id: a.accessoryId, count: a.count }));
}

/** ship_template_weapons rows for a template (used to rewrite the join table). */
export function mapWeaponRows(t: ShipTemplate) {
  return t.weapons
    .filter(w => w.count > 0)
    .map(w => ({ template_id: t.id, weapon_id: w.weaponId, mount_slot: w.mountSlot || null, count: w.count }));
}

/** ship_crews rows for a template (used to rewrite the roster). */
export function mapCrewRows(t: ShipTemplate) {
  return t.crews.map(c => ({
    id: c.id,
    template_id: t.id,
    name: c.name || null,
    level: c.level,
    str: c.str,
    dex: c.dex,
    con: c.con,
    int: c.int,
    wis: c.wis,
    cha: c.cha,
    cost: c.cost != null ? c.cost : null,
  }));
}
