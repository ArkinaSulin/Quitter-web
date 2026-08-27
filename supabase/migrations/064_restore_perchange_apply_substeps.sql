-- 064: Restore the proven per-change apply_substeps (056 behavior) + legacy
-- isRouting skip.
--
-- Migration 063's coalesced (one-UPDATE-per-unit) apply_substeps fails to write
-- ANY unit on the live DB — commands report success (the SCENARIO / command_log
-- side of the atomic transaction commits) but every unit UPDATE lands on zero
-- rows, so END_TURN never refreshes actions/MP/reaction-used. The 056 per-change
-- version is proven (it wrote the reaction formation, moves, etc. before 063).
--
-- This recreates the 4-parameter apply_substeps (the one execute_command /
-- undo / redo call) with per-change UPDATEs + command_seq stamping, plus the
-- pre-061 `isRouting` legacy skip so old log entries still undo cleanly.

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

      -- Legacy pre-061 field: routing is derived from currentFormation now.
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
