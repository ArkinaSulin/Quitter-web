-- 090: Zone-of-control pursuit, hero command leash, and the Withdraw action.
--
--  * scenarios.zoc_pursuit_enabled: master switch for the ZoC danger layer
--    (scatter-on-leave + aggression-gated pursuit). Default ON. When OFF there
--    is no scatter/pursuit/opportunity attack; entering a ZoC still spends MP.
--  * Renames units.opportunity_attack_used -> units.pursuit_used (the reaction is
--    now a "pursue", not an opportunity attack).
--  * units.command_pursuit_permit: per-hero Commanding-Presence leash. DEFAULT
--    FALSE (a hero's presence INHIBITS pursuit unless the owner permits it).
--  * unit_templates.command_pursuit_permit: authorable default for new units.

-- 1. Scenario switch.
ALTER TABLE scenarios ADD COLUMN IF NOT EXISTS zoc_pursuit_enabled BOOLEAN NOT NULL DEFAULT true;

-- 2. Rename the per-turn flag (guarded through the legacy name too).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'units' AND column_name = 'opportunity_attack_used'
  ) THEN
    ALTER TABLE units RENAME COLUMN opportunity_attack_used TO pursuit_used;
  ELSIF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'units' AND column_name = 'parting_shot_used'
  ) THEN
    ALTER TABLE units RENAME COLUMN parting_shot_used TO pursuit_used;
  END IF;
END $$;
ALTER TABLE units ADD COLUMN IF NOT EXISTS pursuit_used BOOLEAN NOT NULL DEFAULT false;

-- 3. Hero command leash (default INHIBIT).
ALTER TABLE units ADD COLUMN IF NOT EXISTS command_pursuit_permit BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE unit_templates ADD COLUMN IF NOT EXISTS command_pursuit_permit BOOLEAN NOT NULL DEFAULT false;

-- 4. Rebuild the unit-field allowlist: pursuitUsed replaces opportunityAttackUsed,
--    plus commandPursuitPermit.
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
    WHEN 'pursuitUsed' THEN 'pursuit_used'
    WHEN 'commandPursuitPermit' THEN 'command_pursuit_permit'
    WHEN 'moraleBoost' THEN 'morale_boost'
    WHEN 'heroicInspirationActive' THEN 'heroic_inspiration_active'
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
