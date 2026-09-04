-- 075: Restore the archerReactionUsed allowlist entry dropped by 073.
--
-- 073 recreated unit_field_to_column from the 061-era list + effects, which
-- accidentally REMOVED the archerReactionUsed -> archer_reaction_used mapping
-- added by 062. That broke END_TURN refresh ("Unknown unit field in command:
-- archerReactionUsed"). This rebuilds the allowlist with both entries.

CREATE OR REPLACE FUNCTION unit_field_to_column(fld text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE fld
    WHEN 'facing' THEN 'facing'
    WHEN 'team' THEN 'team'
    WHEN 'currentUnitHp' THEN 'current_unit_hp'
    WHEN 'maxUnitHp' THEN 'max_unit_hp'
    WHEN 'troopHp' THEN 'troop_hp'
    WHEN 'level' THEN 'level'
    WHEN 'movementPoints' THEN 'movement_points'
    WHEN 'isHero' THEN 'is_hero'
    WHEN 'attachedToUnitId' THEN 'attached_to_unit_id'
    WHEN 'attachedPosition' THEN 'attached_position'
    WHEN 'currentFormation' THEN 'current_formation'
    WHEN 'organizationLevel' THEN 'organization_level'
    WHEN 'formationAvailability' THEN 'formation_availability'
    WHEN 'sizeCategory' THEN 'size_category'
    WHEN 'visualScale' THEN 'visual_scale'
    WHEN 'isShielded' THEN 'is_shielded'
    WHEN 'aggressiveness' THEN 'aggressiveness'
    WHEN 'baseMorale' THEN 'base_morale'
    WHEN 'currentMoraleModifier' THEN 'current_morale_modifier'
    WHEN 'currentAc' THEN 'current_ac'
    WHEN 'baselineAc' THEN 'baseline_ac'
    WHEN 'ignoreMoraleChecks' THEN 'ignore_morale_checks'
    WHEN 'weaponString' THEN 'weapon_string'
    WHEN 'hidden' THEN 'hidden'
    WHEN 'isDeleted' THEN 'is_deleted'
    WHEN 'unitTypeIconUrl' THEN 'unit_type_icon_url'
    WHEN 'currentTroopCount' THEN 'current_troop_count'
    WHEN 'maxTroopCount' THEN 'max_troop_count'
    WHEN 'movementPointsAvailable' THEN 'movement_points_available'
    WHEN 'actionsAvailable' THEN 'actions_available'
    WHEN 'attacksUsed' THEN 'attacks_used'
    WHEN 'archerReactionUsed' THEN 'archer_reaction_used'
    WHEN 'str' THEN 'str'
    WHEN 'dex' THEN 'dex'
    WHEN 'con' THEN 'con'
    WHEN 'int' THEN 'int'
    WHEN 'wis' THEN 'wis'
    WHEN 'cha' THEN 'cha'
    WHEN 'unitName' THEN 'unit_name'
    WHEN 'raceName' THEN 'race_name'
    WHEN 'armorName' THEN 'armor_name'
    WHEN 'mountId' THEN 'mount_id'
    WHEN 'mountName' THEN 'mount_name'
    WHEN 'customImageUrl' THEN 'custom_image_url'
    WHEN 'canCharge' THEN 'can_charge'
    WHEN 'isCharging' THEN 'is_charging'
    WHEN 'chargeDistance' THEN 'charge_distance'
    WHEN 'activeWeaponIndex' THEN 'active_weapon_index'
    WHEN 'effects' THEN 'effects'
  END;
$$;
