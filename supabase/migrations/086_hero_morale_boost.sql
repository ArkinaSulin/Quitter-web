-- 086: Hero morale boost (Commanding Presence / Heroic Inspiration) + heroic capacity.
--
-- A HERO carries a `morale_boost` attribute (n). Same-alliance units within the
-- hero's hex + 6 neighbours (7 hexes) gain Commanding Presence +n; when the hero
-- lands a melee attack the aura upgrades to Heroic Inspiration n+1 until the
-- start of his next alliance turn (`heroic_inspiration_active`). A leading or
-- inspired hero also adds `heroic_capacity_multiplier` to the attack capacity
-- of same-alliance units in range. The aura is HERO-ONLY (a non-hero morale_boost
-- is inert). Feature toggle is per-scenario.

-- Unit / template attributes.
ALTER TABLE unit_templates ADD COLUMN IF NOT EXISTS morale_boost INTEGER NOT NULL DEFAULT 0;
ALTER TABLE units          ADD COLUMN IF NOT EXISTS morale_boost INTEGER NOT NULL DEFAULT 0;
ALTER TABLE units          ADD COLUMN IF NOT EXISTS heroic_inspiration_active BOOLEAN NOT NULL DEFAULT false;

-- Heroes default to Commanding Presence 1.
UPDATE unit_templates SET morale_boost = 1 WHERE is_hero AND morale_boost = 0;
UPDATE units          SET morale_boost = 1 WHERE is_hero AND morale_boost = 0;

-- Per-scenario feature toggle (default on).
ALTER TABLE scenarios ADD COLUMN IF NOT EXISTS hero_morale_boost_enabled BOOLEAN NOT NULL DEFAULT true;

-- Global heroic capacity multiplier (decimal; +N to attack capacity while a hero leads/inspires).
INSERT INTO settings (key, value, description) VALUES
  ('heroic_capacity_multiplier', '1'::jsonb, 'Attack-capacity bonus added when a leading/inspired hero is within range')
ON CONFLICT (key) DO NOTHING;

-- Rebuild the unit-field allowlist with the two new fields (same list as 084 + additions).
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
    WHEN 'partingShotUsed' THEN 'parting_shot_used'
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
