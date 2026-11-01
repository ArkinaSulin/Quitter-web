// src/packages/ships/lib/shipMappers.ts
// Supabase row <-> ship model mapping (mirrors templateMappers). The editor and any
// later consumer (ship spawner, ship engine) share these so the camelCase model stays
// consistent with the snake_case ship_* tables.
//
// PostgREST returns `numeric` columns as JSON strings (e.g. "0.2") and integer columns
// as numbers, so every numeric field is coerced via Number(...).

import {
  ShipArmor,
  ShipComponent,
  ShipCrew,
  ShipTemplate,
  ShipWeapon,
} from '@/types/ship';
import { DEFAULT_TOTAL_MASS, computeCrewHp, computeCrewWeeklyCost } from './shipStats';
import { normalizeDeckLayout } from './deckLayout';

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
    dt: Number(row.dt) || 15,
    builtIn: !!row.built_in,
    canCombine: row.can_combine !== false,
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
    dt: Number(row.dt) || 15,
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
  const level = Number(row.level) || 1;
  return {
    id: row.id,
    name: row.name || null,
    level,
    hp: row.hp != null ? Number(row.hp) : computeCrewHp(level),
    str: Number(row.str) || 12,
    dex: Number(row.dex) || 14,
    con: Number(row.con) || 14,
    int: Number(row.int) || 10,
    wis: Number(row.wis) || 14,
    cha: Number(row.cha) || 10,
    cost: row.cost != null ? Number(row.cost) : computeCrewWeeklyCost(level),
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
    crewQuarters: Number(row.crew_quarters) || 0,
    weaponCapacity: Number(row.weapon_capacity) || 0,
    deckLayout: normalizeDeckLayout(row.deck_layout),
    reinforcements: row.reinforcements || [],
    atmosphericSpeed: Number(row.atmospheric_speed) || 0,
    damageThreshold: row.damage_threshold != null ? Number(row.damage_threshold) : 15,
    imageUrl: row.image_url || '',
    cargoArea: Number(row.cargo_area) || 0,
    optionalComponents: (row.ship_template_components || row.ship_template_accessories || []).map((a: any) => ({
      componentId: a.component_id || a.accessory_id,
      count: Number(a.count) || 1,
    })),
    weapons: [...(row.ship_template_weapons || [])]
      .sort((a: any, b: any) =>
        (Number(a.sort_order) || 0) - (Number(b.sort_order) || 0) ||
        String(a.id).localeCompare(String(b.id)))
      .map((w: any) => ({
        id: w.id,
        weaponId: w.weapon_id,
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
    crew_quarters: t.crewQuarters,
    weapon_capacity: t.weaponCapacity,
    deck_layout: t.deckLayout,
    reinforcements: t.reinforcements,
    atmospheric_speed: t.atmosphericSpeed,
    damage_threshold: t.damageThreshold,
    image_url: t.imageUrl,
    cargo_area: t.cargoArea,
    updated_at: new Date().toISOString(),
  };
}

/** ship_template_components rows for a template (used to rewrite the join table). */
export function mapOptionalComponentRows(t: ShipTemplate) {
  return t.optionalComponents
    .filter(c => c.count > 0)
    .map(c => ({ template_id: t.id, component_id: c.componentId, count: c.count }));
}

/** ship_template_weapons rows for a template (used to rewrite the join table). */
export function mapWeaponRows(t: ShipTemplate) {
  return t.weapons
    .filter(w => w.count > 0)
    .map((w, sort_order) => ({
      id: w.id,
      template_id: t.id,
      weapon_id: w.weaponId,
      count: w.count,
      sort_order,
    }));
}

/** ship_crews rows for a template (used to rewrite the roster). */
export function mapCrewRows(t: ShipTemplate) {
  return t.crews.map(c => ({
    id: c.id,
    template_id: t.id,
    name: c.name || null,
    level: c.level,
    hp: c.hp,
    str: c.str,
    dex: c.dex,
    con: c.con,
    int: c.int,
    wis: c.wis,
    cha: c.cha,
    cost: c.cost,
  }));
}
