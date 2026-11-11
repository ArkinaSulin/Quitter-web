-- 151: Split ability scores from saving-throw bonuses.
--
-- Migration 044 added `str..cha` to `unit_templates` / `units` as saving-throw
-- BONUSES (stored directly, default 0). Ship station skill checks need actual
-- ability scores, so:
--   1. rename the old save-bonus columns to `str_sav..cha_sav`, then
--   2. add real ability-score columns `str..cha` (default 10).
--
-- New ability scores are used by the (stat-based) skill checks; save bonuses
-- keep feeding area-effect saving throws.

DO $$
BEGIN
  -- unit_templates: saves
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'unit_templates' AND column_name = 'str')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'unit_templates' AND column_name = 'str_sav') THEN
    ALTER TABLE unit_templates RENAME COLUMN str TO str_sav;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'unit_templates' AND column_name = 'dex')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'unit_templates' AND column_name = 'dex_sav') THEN
    ALTER TABLE unit_templates RENAME COLUMN dex TO dex_sav;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'unit_templates' AND column_name = 'con')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'unit_templates' AND column_name = 'con_sav') THEN
    ALTER TABLE unit_templates RENAME COLUMN con TO con_sav;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'unit_templates' AND column_name = 'int')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'unit_templates' AND column_name = 'int_sav') THEN
    ALTER TABLE unit_templates RENAME COLUMN "int" TO int_sav;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'unit_templates' AND column_name = 'wis')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'unit_templates' AND column_name = 'wis_sav') THEN
    ALTER TABLE unit_templates RENAME COLUMN wis TO wis_sav;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'unit_templates' AND column_name = 'cha')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'unit_templates' AND column_name = 'cha_sav') THEN
    ALTER TABLE unit_templates RENAME COLUMN cha TO cha_sav;
  END IF;

  -- units: saves
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'units' AND column_name = 'str')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'units' AND column_name = 'str_sav') THEN
    ALTER TABLE units RENAME COLUMN str TO str_sav;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'units' AND column_name = 'dex')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'units' AND column_name = 'dex_sav') THEN
    ALTER TABLE units RENAME COLUMN dex TO dex_sav;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'units' AND column_name = 'con')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'units' AND column_name = 'con_sav') THEN
    ALTER TABLE units RENAME COLUMN con TO con_sav;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'units' AND column_name = 'int')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'units' AND column_name = 'int_sav') THEN
    ALTER TABLE units RENAME COLUMN "int" TO int_sav;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'units' AND column_name = 'wis')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'units' AND column_name = 'wis_sav') THEN
    ALTER TABLE units RENAME COLUMN wis TO wis_sav;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'units' AND column_name = 'cha')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'units' AND column_name = 'cha_sav') THEN
    ALTER TABLE units RENAME COLUMN cha TO cha_sav;
  END IF;
END $$;

-- Ability scores (actual values; 10 = baseline).
ALTER TABLE unit_templates ADD COLUMN IF NOT EXISTS str INT NOT NULL DEFAULT 10;
ALTER TABLE unit_templates ADD COLUMN IF NOT EXISTS dex INT NOT NULL DEFAULT 10;
ALTER TABLE unit_templates ADD COLUMN IF NOT EXISTS con INT NOT NULL DEFAULT 10;
ALTER TABLE unit_templates ADD COLUMN IF NOT EXISTS "int" INT NOT NULL DEFAULT 10;
ALTER TABLE unit_templates ADD COLUMN IF NOT EXISTS wis INT NOT NULL DEFAULT 10;
ALTER TABLE unit_templates ADD COLUMN IF NOT EXISTS cha INT NOT NULL DEFAULT 10;

ALTER TABLE units ADD COLUMN IF NOT EXISTS str INT NOT NULL DEFAULT 10;
ALTER TABLE units ADD COLUMN IF NOT EXISTS dex INT NOT NULL DEFAULT 10;
ALTER TABLE units ADD COLUMN IF NOT EXISTS con INT NOT NULL DEFAULT 10;
ALTER TABLE units ADD COLUMN IF NOT EXISTS "int" INT NOT NULL DEFAULT 10;
ALTER TABLE units ADD COLUMN IF NOT EXISTS wis INT NOT NULL DEFAULT 10;
ALTER TABLE units ADD COLUMN IF NOT EXISTS cha INT NOT NULL DEFAULT 10;

-- Command-log field -> column mapping: saves renamed, ability scores added.
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
    WHEN 'baseAc' THEN 'base_ac'
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
    WHEN 'strSav' THEN 'str_sav'
    WHEN 'dexSav' THEN 'dex_sav'
    WHEN 'conSav' THEN 'con_sav'
    WHEN 'intSav' THEN 'int_sav'
    WHEN 'wisSav' THEN 'wis_sav'
    WHEN 'chaSav' THEN 'cha_sav'
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
    WHEN 'mountSplit' THEN 'mount_split'
    WHEN 'elevation' THEN 'elevation'
    WHEN 'flySpeed' THEN 'fly_speed'
    WHEN 'flySpeedAvailable' THEN 'fly_speed_available'
    WHEN 'climbTo' THEN 'climb_to'
  END;
$$;
