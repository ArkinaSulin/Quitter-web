-- 157: `SHIP` command sub-steps + `ship_step` scenario field.
--
-- Ship runtime lives in `ship_spelljammer` (one row per placed ship). A SHIP
-- sub-step targets that row: `unitId` = ship id, and `changes` carry either
-- single fields (`{field, from, to}`) or a whole `row` snapshot
-- (`{field:'row', from, to}`) for placement/removal. Field names are camelCase
-- and mapped to snake_case columns below.

CREATE OR REPLACE FUNCTION ship_field_to_column(fld text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE fld
    WHEN 'templateId' THEN 'template_id'
    WHEN 'name' THEN 'name'
    WHEN 'team' THEN 'team'
    WHEN 'hex' THEN 'hex'
    WHEN 'facing' THEN 'facing'
    WHEN 'speedStat' THEN 'speed_stat'
    WHEN 'shipHp' THEN 'ship_hp'
    WHEN 'shipHpMax' THEN 'ship_hp_max'
    WHEN 'loadedCargo' THEN 'loaded_cargo'
    WHEN 'crewAssigned' THEN 'crew_assigned'
    WHEN 'boxState' THEN 'box_state'
    WHEN 'attachedToShip' THEN 'attached_to_ship'
    WHEN 'snapshot' THEN 'snapshot'
    WHEN 'elevation' THEN 'elevation'
    WHEN 'lastSpeed' THEN 'last_speed'
    WHEN 'declaredSpeed' THEN 'declared_speed'
    WHEN 'speedSpent' THEN 'speed_spent'
    WHEN 'turnsSinceFacing' THEN 'turns_since_facing'
    WHEN 'stepBudget' THEN 'step_budget'
    WHEN 'stations' THEN 'stations'
    WHEN 'crewState' THEN 'crew_state'
    WHEN 'reload' THEN 'reload'
    WHEN 'weaponState' THEN 'weapon_state'
    WHEN 'imageUrl' THEN 'image_url'
    WHEN 'keelLength' THEN 'keel_length'
    WHEN 'imageOffsetY' THEN 'image_offset_y'
    WHEN 'isDeleted' THEN 'is_deleted'
  END;
$$;

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
  skey text;
  ship_id text;
  k text;
  v jsonb;
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
        INSERT INTO scenario_team_alliance (scenario_id, team, alliance_group, updated_at)
        VALUES (p_scenario_id, step_rec.value->>'unitId', val #>> '{}', now())
        ON CONFLICT (scenario_id, team)
        DO UPDATE SET alliance_group = EXCLUDED.alliance_group, updated_at = now();
      END LOOP;
      CONTINUE;
    END IF;

    IF step_rec.value->>'type' = 'ZONE' THEN
      FOR chg_rec IN
        SELECT value, ord
        FROM jsonb_array_elements(COALESCE(step_rec.value->'changes', '[]'::jsonb)) WITH ORDINALITY AS u(value, ord)
        ORDER BY CASE WHEN p_use_to THEN ord ELSE -ord END
      LOOP
        fld := chg_rec.value->>'field';
        val := chg_rec.value -> (CASE WHEN p_use_to THEN 'to' ELSE 'from' END);
        IF val IS NULL THEN CONTINUE; END IF;
        IF fld = 'ground_effects' THEN
          UPDATE scenarios
          SET map_data = jsonb_set(COALESCE(map_data, '{}'::jsonb), '{groundEffects}', val, true),
              updated_at = now()
          WHERE id = p_scenario_id;
        ELSE
          RAISE EXCEPTION 'Unknown ZONE field in command: %', fld;
        END IF;
      END LOOP;
      CONTINUE;
    END IF;

    IF step_rec.value->>'type' = 'WALL' THEN
      FOR chg_rec IN
        SELECT value, ord
        FROM jsonb_array_elements(COALESCE(step_rec.value->'changes', '[]'::jsonb)) WITH ORDINALITY AS u(value, ord)
        ORDER BY CASE WHEN p_use_to THEN ord ELSE -ord END
      LOOP
        fld := chg_rec.value->>'field';
        val := chg_rec.value -> (CASE WHEN p_use_to THEN 'to' ELSE 'from' END);
        IF val IS NULL THEN CONTINUE; END IF;
        IF fld = 'walls' THEN
          UPDATE scenarios
          SET map_data = jsonb_set(COALESCE(map_data, '{}'::jsonb), '{walls}', val, true),
              updated_at = now()
          WHERE id = p_scenario_id;
        ELSE
          RAISE EXCEPTION 'Unknown WALL field in command: %', fld;
        END IF;
      END LOOP;
      CONTINUE;
    END IF;

    IF step_rec.value->>'type' = 'STRUCTURE' THEN
      FOR chg_rec IN
        SELECT value, ord
        FROM jsonb_array_elements(COALESCE(step_rec.value->'changes', '[]'::jsonb)) WITH ORDINALITY AS u(value, ord)
        ORDER BY CASE WHEN p_use_to THEN ord ELSE -ord END
      LOOP
        fld := chg_rec.value->>'field';
        IF fld <> 'structures' THEN
          RAISE EXCEPTION 'Unknown STRUCTURE field in command: %', fld;
        END IF;
        skey := chg_rec.value->>'key';
        IF skey IS NULL OR skey = '' THEN CONTINUE; END IF;
        val := chg_rec.value -> (CASE WHEN p_use_to THEN 'to' ELSE 'from' END);
        IF val IS NULL OR val = 'null'::jsonb THEN
          UPDATE scenarios
          SET map_data = jsonb_set(
                COALESCE(map_data, '{}'::jsonb),
                '{structures}',
                COALESCE(map_data->'structures', '{}'::jsonb) - skey,
                true),
              updated_at = now()
          WHERE id = p_scenario_id;
        ELSE
          UPDATE scenarios
          SET map_data = jsonb_set(
                COALESCE(map_data, '{}'::jsonb),
                '{structures}',
                jsonb_set(COALESCE(map_data->'structures', '{}'::jsonb), ARRAY[skey], val, true),
                true),
              updated_at = now()
          WHERE id = p_scenario_id;
        END IF;
      END LOOP;
      CONTINUE;
    END IF;

    IF step_rec.value->>'type' = 'SHIP' THEN
      ship_id := step_rec.value->>'unitId';
      IF ship_id IS NULL OR ship_id = '' THEN CONTINUE; END IF;
      FOR chg_rec IN
        SELECT value, ord
        FROM jsonb_array_elements(COALESCE(step_rec.value->'changes', '[]'::jsonb)) WITH ORDINALITY AS u(value, ord)
        ORDER BY CASE WHEN p_use_to THEN ord ELSE -ord END
      LOOP
        fld := chg_rec.value->>'field';
        val := chg_rec.value -> (CASE WHEN p_use_to THEN 'to' ELSE 'from' END);
        IF fld = 'row' THEN
          IF val IS NULL OR val = 'null'::jsonb THEN
            DELETE FROM ship_spelljammer
            WHERE id = ship_id AND scenario_id = p_scenario_id;
          ELSE
            INSERT INTO ship_spelljammer (id, scenario_id)
            VALUES (ship_id, p_scenario_id)
            ON CONFLICT (id) DO NOTHING;
            FOR k, v IN SELECT key, value FROM jsonb_each(val)
            LOOP
              col := ship_field_to_column(k);
              IF col IS NULL OR col IN ('id', 'scenario_id') THEN CONTINUE; END IF;
              IF k = 'hex' AND jsonb_typeof(v) = 'object' THEN
                EXECUTE format(
                  'UPDATE ship_spelljammer SET hex = %L, updated_at = now(), command_seq = %L WHERE id = %L AND scenario_id = %L',
                  COALESCE(v->>'q', '0') || ',' || COALESCE(v->>'r', '0'), p_command_seq, ship_id, p_scenario_id
                );
              ELSIF jsonb_typeof(v) IN ('object', 'array') THEN
                EXECUTE format(
                  'UPDATE ship_spelljammer SET %I = %L::jsonb, updated_at = now(), command_seq = %L WHERE id = %L AND scenario_id = %L',
                  col, v #>> '{}', p_command_seq, ship_id, p_scenario_id
                );
              ELSE
                EXECUTE format(
                  'UPDATE ship_spelljammer SET %I = %L, updated_at = now(), command_seq = %L WHERE id = %L AND scenario_id = %L',
                  col, v #>> '{}', p_command_seq, ship_id, p_scenario_id
                );
              END IF;
            END LOOP;
          END IF;
          CONTINUE;
        END IF;

        col := ship_field_to_column(fld);
        IF col IS NULL THEN
          RAISE EXCEPTION 'Unknown SHIP field in command: %', fld;
        END IF;
        IF fld = 'hex' AND val IS NOT NULL THEN
          EXECUTE format(
            'UPDATE ship_spelljammer SET hex = %L, updated_at = now(), command_seq = %L WHERE id = %L AND scenario_id = %L',
            COALESCE(val->>'q', '0') || ',' || COALESCE(val->>'r', '0'), p_command_seq, ship_id, p_scenario_id
          );
        ELSIF val IS NULL OR val = 'null'::jsonb THEN
          EXECUTE format(
            'UPDATE ship_spelljammer SET %I = NULL, updated_at = now(), command_seq = %L WHERE id = %L AND scenario_id = %L',
            col, p_command_seq, ship_id, p_scenario_id
          );
        ELSIF jsonb_typeof(val) IN ('object', 'array') THEN
          EXECUTE format(
            'UPDATE ship_spelljammer SET %I = %L::jsonb, updated_at = now(), command_seq = %L WHERE id = %L AND scenario_id = %L',
            col, val #>> '{}', p_command_seq, ship_id, p_scenario_id
          );
        ELSE
          EXECUTE format(
            'UPDATE ship_spelljammer SET %I = %L, updated_at = now(), command_seq = %L WHERE id = %L AND scenario_id = %L',
            col, val #>> '{}', p_command_seq, ship_id, p_scenario_id
          );
        END IF;
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
        ELSIF fld = 'ship_step' THEN
          UPDATE scenarios SET ship_step = (val #>> '{}')::int, updated_at = now() WHERE id = p_scenario_id;
        ELSE
          RAISE EXCEPTION 'Unknown SCENARIO field in command: %', fld;
        END IF;
      END LOOP;
      CONTINUE;
    END IF;

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
        SELECT organization_level::text INTO org_level
        FROM unit_formations WHERE name = val #>> '{}';
        IF org_level IS NULL THEN
          org_level := CASE val #>> '{}'
            WHEN 'Routed' THEN '0' WHEN 'Scattered' THEN '0' WHEN 'Hero' THEN '0'
            WHEN 'Open Order' THEN '1' WHEN 'Close Order' THEN '2'
            WHEN 'Phalanx' THEN '3' WHEN 'Shield Wall' THEN '3' ELSE '0'
          END;
        END IF;
        EXECUTE format(
          'UPDATE units SET %I = %L, organization_level = %L, command_seq = %L, updated_at = now() WHERE id = %L AND scenario_id = %L',
          col, val #>> '{}', org_level, p_command_seq, step_rec.value->>'unitId', p_scenario_id
        );
      ELSIF jsonb_typeof(val) = 'array' THEN
        EXECUTE format(
          'UPDATE units SET %I = ARRAY(SELECT jsonb_array_elements_text(%L::jsonb)), command_seq = %L, updated_at = now() WHERE id = %L AND scenario_id = %L',
          col, val #>> '{}', p_command_seq, step_rec.value->>'unitId', p_scenario_id
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
