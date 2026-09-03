-- 073: Temporary effects — units.effects jsonb + command-engine support.
--
-- Active temporary effects (buffs / debuffs / DoT) live on each unit as a jsonb
-- array of UnitEffect objects (see src/types/gameProtocol.ts). Command sub-steps
-- carry full-array from/to values, so apply_substeps needs an explicit jsonb
-- write branch (the generic path scalarizes with #>> '{}' and would mangle the
-- column type). Ground (hex) zones live in scenarios.map_data.groundEffects and
-- need no schema here.

ALTER TABLE units ADD COLUMN IF NOT EXISTS effects jsonb NOT NULL DEFAULT '[]'::jsonb;

-- 1. Allowlist the new field.
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

-- 2. apply_substeps: per-change writes (064 behavior) + jsonb effects branch.
CREATE OR REPLACE FUNCTION apply_substeps(p_scenario_id uuid, p_steps jsonb, p_use_to boolean, p_command_seq bigint)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  step_rec record;
  chg_rec record;
  fld text;
  val jsonb;
  col text;
  org_level text;
BEGIN
  FOR step_rec IN
    SELECT value, ord
    FROM jsonb_array_elements(p_steps) WITH ORDINALITY AS t(value, ord)
    ORDER BY CASE WHEN p_use_to THEN ord ELSE -ord END
  LOOP
    IF step_rec.value->>'type' = 'ALLIANCE' THEN
      FOR chg_rec IN
        SELECT value, ord
        FROM jsonb_array_elements(COALESCE(step_rec.value->'changes', '[]'::jsonb)) WITH ORDINALITY AS u(value, ord)
        ORDER BY CASE WHEN p_use_to THEN ord ELSE -ord END
      LOOP
        val := chg_rec.value -> (CASE WHEN p_use_to THEN 'to' ELSE 'from' END);
        IF val IS NULL THEN CONTINUE; END IF;
        INSERT INTO team_alliances (scenario_id, team, alliance_group, updated_at)
        VALUES (p_scenario_id, step_rec.value->>'unitId', val #>> '{}', now())
        ON CONFLICT (scenario_id, team)
        DO UPDATE SET alliance_group = EXCLUDED.alliance_group, updated_at = now();
      END LOOP;
      CONTINUE;
    END IF;

    IF step_rec.value->>'type' = 'SCENARIO' THEN
      FOR chg_rec IN
        SELECT value, ord
        FROM jsonb_array_elements(COALESCE(step_rec.value->'changes', '[]'::jsonb)) WITH ORDINALITY AS u(value, ord)
        ORDER BY CASE WHEN p_use_to THEN ord ELSE -ord END
      LOOP
        fld := chg_rec.value->>'field';
        val := chg_rec.value -> (CASE WHEN p_use_to THEN 'to' ELSE 'from' END);
        IF val IS NULL THEN CONTINUE; END IF;
        IF fld = 'current_turn_alliance' THEN
          UPDATE scenarios SET current_turn_alliance = NULLIF(val #>> '{}', ''), updated_at = now() WHERE id = p_scenario_id;
        ELSIF fld = 'turn_number' THEN
          UPDATE scenarios SET turn_number = (val #>> '{}')::int, updated_at = now() WHERE id = p_scenario_id;
        ELSIF fld = 'free_move' THEN
          UPDATE scenarios SET free_move = (val #>> '{}')::boolean, updated_at = now() WHERE id = p_scenario_id;
        ELSE
          RAISE EXCEPTION 'Unknown SCENARIO field in command: %', fld;
        END IF;
      END LOOP;
      CONTINUE;
    END IF;

    -- Unit step: per-change UPDATE, every write stamped with command_seq.
    FOR chg_rec IN
      SELECT value, ord
      FROM jsonb_array_elements(COALESCE(step_rec.value->'changes', '[]'::jsonb)) WITH ORDINALITY AS u(value, ord)
      ORDER BY CASE WHEN p_use_to THEN ord ELSE -ord END
    LOOP
      fld := chg_rec.value->>'field';
      val := chg_rec.value -> (CASE WHEN p_use_to THEN 'to' ELSE 'from' END);
      IF val IS NULL THEN CONTINUE; END IF;

      IF fld = 'isRouting' THEN
        CONTINUE;
      END IF;

      IF fld = 'hex' THEN
        IF val IS NOT NULL THEN
          EXECUTE format(
            'UPDATE units SET hex_q = %L, hex_r = %L, hex_s = %L, command_seq = %L, updated_at = now() WHERE id = %L AND scenario_id = %L',
            val->>'q', val->>'r', val->>'s', p_command_seq, step_rec.value->>'unitId', p_scenario_id
          );
        END IF;
        CONTINUE;
      END IF;

      IF fld = 'effects' THEN
        EXECUTE format(
          'UPDATE units SET effects = %L::jsonb, command_seq = %L, updated_at = now() WHERE id = %L AND scenario_id = %L',
          val #>> '{}', p_command_seq, step_rec.value->>'unitId', p_scenario_id
        );
        CONTINUE;
      END IF;

      col := unit_field_to_column(fld);
      IF col IS NULL THEN
        RAISE EXCEPTION 'Unknown unit field in command: %', fld;
      END IF;

      IF fld = 'currentFormation' AND val IS NOT NULL THEN
        org_level := CASE val #>> '{}'
          WHEN 'Routed' THEN '0' WHEN 'Scattered' THEN '0' WHEN 'Hero' THEN '0'
          WHEN 'Open Order' THEN '1' WHEN 'Close Order' THEN '2'
          WHEN 'Phalanx' THEN '3' WHEN 'Shield Wall' THEN '3' ELSE '0'
        END;
        EXECUTE format(
          'UPDATE units SET %I = %L, organization_level = %L, command_seq = %L, updated_at = now() WHERE id = %L AND scenario_id = %L',
          col, val #>> '{}', org_level, p_command_seq, step_rec.value->>'unitId', p_scenario_id
        );
      ELSE
        EXECUTE format(
          'UPDATE units SET %I = %L, command_seq = %L, updated_at = now() WHERE id = %L AND scenario_id = %L',
          col, val #>> '{}', p_command_seq, step_rec.value->>'unitId', p_scenario_id
        );
      END IF;
    END LOOP;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION apply_substeps(uuid, jsonb, boolean, bigint) FROM PUBLIC;
