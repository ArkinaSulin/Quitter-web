// src/lib/templateMappers.ts
import { UnitTemplate } from '@/types/gameProtocol';

/**
 * Map a database row from unit_templates to a UnitTemplate object (camelCase).
 * Used by both UnitEditor and UnitSelector to ensure consistent mapping.
 */
export function mapTemplate(row: any): UnitTemplate {
  return {
    id: row.id,
    unitName: row.unit_name || '',
    raceId: row.race_id || '',
    raceName: row.races?.name || '',
    raceBaseHd: row.races?.base_hd || null,
    raceIconUrl: row.races?.icon_url || '',
    raceCanCharge: row.races?.can_charge || false,
    modelTypeId: row.model_type_id || '',
    modelTypeName: row.unit_types?.name || '',
    modelTypeIconUrl: row.unit_types?.icon_url || null,
    unitTypeIconUrl: row.unit_types?.icon_url || row.unit_type_icon_url || null,
    isHero: row.is_hero || false,
    troopCount: row.troop_count || 1,
    level: row.level || 1,
    troopHp: row.troop_hp || 10,
    maxUnitHp: row.max_unit_hp || 1,
    numberOfAttacks: row.number_of_attacks || 10,
    armorId: row.armor_id || '',
    armorName: row.armors?.name || '',
    isShielded: row.is_shielded || false,
    baseAc: row.base_ac || 10,
    baselineAc: row.baseline_ac || 10,
    weaponString: row.weapon_string || '',
    mountId: row.mount_id || '',
    mountName: row.mounts?.name || '',
    movementPoints: row.movement_points || 3,
    aggressiveness: row.aggressiveness || 3,
    baseMorale: row.base_morale || 3,
    sizeCategory: row.size_category || 100,
    visualScale: row.visual_scale || 100,
    formationAvailability: row.formation_availability || ['Scattered', 'Routed'],
    equipCostGp: row.equip_cost_gp || 0,
    weeklyCostGp: row.weekly_cost_gp || 0,
    canCharge: row.can_charge || false,
    customImageUrl: row.custom_image_url || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Map a UnitTemplate object to a database row format (snake_case).
 * Used by UnitEditor for save operations.
 */
export function mapTemplateToRow(template: UnitTemplate) {
  const maxUnitHp = (template.troopHp || 1) * (template.troopCount || 1);
  const weeklyCost = 4*(template.level *template.level || 1);
  return {
    id: template.id,
    unit_name: template.unitName,
    race_id: template.raceId || null,
    model_type_id: template.modelTypeId || null,
    is_hero: template.isHero || false,
    troop_count: template.troopCount || 20,
    level: template.level || 2,
    troop_hp: template.troopHp || 10,
    max_unit_hp: maxUnitHp,
    number_of_attacks: template.numberOfAttacks || 1,
    armor_id: template.armorId || null,
    is_shielded: template.isShielded || false,
    base_ac: template.baseAc || 10,
    baseline_ac: template.baselineAc || 10,
    weapon_string: template.weaponString || '',
    mount_id: template.mountId || null,
    movement_points: template.movementPoints || 3,
    aggressiveness: template.aggressiveness || 3,
    base_morale: template.baseMorale || 3,
    size_category: template.sizeCategory || 100,
    visual_scale: template.visualScale || 100,
    formation_availability: template.formationAvailability || ['Scattered', 'Routed'],
    equip_cost_gp: template.equipCostGp || 0,
    weekly_cost_gp: weeklyCost,
    can_charge: template.canCharge || false,
    custom_image_url: template.customImageUrl || null,
    unit_type_icon_url: template.unitTypeIconUrl || null,
    updated_at: new Date().toISOString(),
  };
}
