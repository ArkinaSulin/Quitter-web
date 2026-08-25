-- 060: Unit 5-attack cap (soft) + hero 5-action fractional movement economy.
--
-- attacks_used: attacks + retaliations performed this turn by a non-hero unit,
-- soft-capped at unit_attack_cap (pause + ask + red message past it; retaliation
-- past the cap is suppressed when declined).
-- movement_points_available → NUMERIC: heroes carry fractional MP (each converted
-- action grants maxMP/5 MP, 1 decimal; units stay whole). hero_actions_per_turn:
-- heroes refresh to 5 actions (units stay at actions_per_turn).

ALTER TABLE units ADD COLUMN IF NOT EXISTS attacks_used INTEGER NOT NULL DEFAULT 0;
ALTER TABLE units ALTER COLUMN movement_points_available TYPE NUMERIC;

INSERT INTO settings (key, value, description) VALUES
  ('unit_attack_cap',      '5'::jsonb, 'Max attacks + retaliations per turn for non-hero units (soft: pause + confirm + red message past it; declined retaliation is suppressed)'),
  ('hero_actions_per_turn','5'::jsonb, 'Actions per turn for heroes; each action converts maxMP/5 movement MP (fraction carries, 1 decimal, display floors)')
ON CONFLICT (key) DO UPDATE SET
  value = EXCLUDED.value,
  description = EXCLUDED.description;

-- Unit-field allowlist: sub-steps may now write attacks_used.
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
    WHEN 'isRouting' THEN 'is_routing'
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
  END;
$$;
