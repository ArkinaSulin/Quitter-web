// src/lib/shipMappers.ts
// Supabase row <-> ship model mapping (mirrors templateMappers). The editor and any
// later consumer (ship spawner, ship engine) share these so the camelCase model stays
// consistent with the snake_case ship_* tables.
//
// Catalog mappers (mapShipFrameRow / mapShipArmorRow / ...) convert snake_case columns
// AND coerce numerics via Number(...): PostgREST returns `numeric` columns as JSON
// strings (e.g. "0.2") and integer columns as numbers, so reading either raw would
// break arithmetic (undefined -> NaN from camelCase access, or string concatenation).

import {
  ShipAccessory,
  ShipArmor,
  ShipCrew,
  ShipComponent,
  ShipFrame,
  ShipMount,
  ShipPoolType,
  ShipTemplate,
  ShipWeapon,
} from '@/types/ship';

/** Map a ship_frames row. */
export function mapShipFrameRow(row: any): ShipFrame {
  return {
    id: row.id,
    massCap: Number(row.mass_cap) || 0,
    baseHp: Number(row.base_hp) || 0,
    deckSpace: Number(row.deck_space) || 0,
    topSpeed: Number(row.top_speed) || 0,
    maxRudders: Number(row.max_rudders) || 0,
    baseCost: Number(row.base_cost) || 0,
    hullSpaces: Number(row.hull_spaces) || 0,
  };
}

/** Map a ship_armors row. */
export function mapShipArmorRow(row: any): ShipArmor {
  return {
    id: row.id,
    massFactor: Number(row.mass_factor) || 0,
    ac: Number(row.ac) || 0,
    boxHp: Number(row.box_hp) || 0,
    costMult: Number(row.cost_mult) || 0,
  };
}

/** Map a ship_components row. */
export function mapShipComponentRow(row: any): ShipComponent {
  return {
    id: row.id,
    mass: Number(row.mass) || 0,
    deck: Number(row.deck) || 0,
    crew: Number(row.crew) || 0,
    cost: Number(row.cost) || 0,
    reinforceOrder: row.reinforce_order != null ? Number(row.reinforce_order) : null,
    hittable: !!row.hittable,
  };
}

/** Map a ship_accessories row. */
export function mapShipAccessoryRow(row: any): ShipAccessory {
  return {
    id: row.id,
    mass: Number(row.mass) || 0,
    deck: Number(row.deck) || 0,
    crew: Number(row.crew) || 0,
    cost: Number(row.cost) || 0,
    poolType: (row.pool_type as ShipPoolType) || 'mass_x_boxhp',
    hittable: !!row.hittable,
    effect: row.effect || null,
  };
}

/** Map a ship_weapons row. */
export function mapShipWeaponRow(row: any): ShipWeapon {
  return {
    id: row.id,
    mount: (row.mount as ShipMount) || 'small',
    damage: row.damage || '',
    rangeStd: Number(row.range_std) || 0,
    rangeDis: row.range_dis != null ? Number(row.range_dis) : null,
    fireCycleRd: Number(row.fire_cycle_rd) || 0,
    crew: Number(row.crew) || 0,
    cost: Number(row.cost) || 0,
    ammoCost: row.ammo_cost != null ? Number(row.ammo_cost) : null,
    special: row.special || null,
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
    frameId: row.frame_id || '',
    armorId: row.armor_id || '',
    atmosphereSpeed: Number(row.atmosphere_speed) || 0,
    rudders: Number(row.rudders) || 0,
    sails: Number(row.sails) || 0,
    lWeap: Number(row.l_weap) || 0,
    sWeap: Number(row.s_weap) || 0,
    hullR: Number(row.hull_r) || 0,
    bridge: Number(row.bridge) || 0,
    auxHelm: Number(row.aux_helm) || 0,
    crewCount: Number(row.crew_count) || 0,
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
    frame_id: t.frameId,
    armor_id: t.armorId,
    atmosphere_speed: t.atmosphereSpeed,
    rudders: t.rudders,
    sails: t.sails,
    l_weap: t.lWeap,
    s_weap: t.sWeap,
    hull_r: t.hullR,
    bridge: t.bridge,
    aux_helm: t.auxHelm,
    crew_count: t.crewCount,
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
