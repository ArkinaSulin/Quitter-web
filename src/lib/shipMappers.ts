// src/lib/shipMappers.ts
// Supabase row <-> ShipTemplate mapping (mirrors templateMappers). The editor and any
// later consumer (ship spawner, ship engine) share these so the camelCase model stays
// consistent with the snake_case ship_* tables.

import { ShipTemplate } from '@/types/ship';

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
    extraCrew: Number(row.extra_crew) || 0,
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
    extra_crew: t.extraCrew,
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
