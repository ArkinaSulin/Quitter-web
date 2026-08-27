-- 063: Coalesce apply_substeps per unit so each command writes each unit once.
--
-- Problem: the archer-reaction FORMATION command has two sub-steps writing the
-- SAME archer (ARCHER_REACTION then FORMATION), and apply_substeps emitted one
-- UPDATE per change field — all stamped with the same command_seq. Realtime
-- delivered one event per UPDATE, and the client's monotonic guard
-- (incoming <= commandSeq) applied the FIRST (intermediate) event and dropped
-- the rest, leaving other clients (e.g. the DM) stuck on the pre-reaction
-- state until a later, higher-seq event or a refresh.
--
-- Fix: accumulate every change for a unit across all sub-steps, then emit ONE
-- UPDATE per unit per command. Each command now produces exactly one realtime
-- event per touched unit, carrying the final state and the command's seq, so
-- the guard accepts it. This also fixes the latent staleness for any command
-- that writes one unit in multiple statements (e.g. normal moves' MP/actions).
--
-- Also: drops the dead 3-parameter apply_substeps accidentally left by
-- migration 061 (the server only calls the 4-parameter version with
-- p_command_seq), and keeps the legacy isRouting skip so pre-061 log entries
-- still undo/redo cleanly.

DROP FUNCTION IF EXISTS apply_substeps(uuid, jsonb, boolean);

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
  col record;
  col_key text;
  col_val jsonb;
  org_level text;
  ukey text;
  set_parts text := '';
  sep text := '';
  -- Accumulated per-unit generic columns: unit_id -> {column: value, ...}
  unit_cols jsonb := '{}'::jsonb;
  -- Accumulated per-unit hex: unit_id -> {q,r,s}
  unit_hex jsonb := '{}'::jsonb;
  -- Accumulated per-unit formation (to derive organization_level at write time)
  unit_formation jsonb := '{}'::jsonb;
BEGIN
  -- Phase 1: accumulate changes (forward order for apply/redo, reverse for undo).
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

    -- Unit step: accumulate into per-unit maps (one UPDATE per unit later).
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
        unit_hex := jsonb_set(unit_hex, ARRAY[step_rec.value->>'unitId'], val);
        CONTINUE;
      END IF;

      IF fld = 'currentFormation' THEN
        unit_formation := jsonb_set(unit_formation, ARRAY[step_rec.value->>'unitId'], val);
        unit_cols := jsonb_set(unit_cols, ARRAY[step_rec.value->>'unitId', 'current_formation'], val);
        CONTINUE;
      END IF;

      col_key := unit_field_to_column(fld);
      IF col_key IS NULL THEN
        RAISE EXCEPTION 'Unknown unit field in command: %', fld;
      END IF;
      unit_cols := jsonb_set(unit_cols, ARRAY[step_rec.value->>'unitId', col_key], val);
    END LOOP;
  END LOOP;

  -- Phase 2: one UPDATE per unit, every accumulated column in a single SET.
  FOR ukey IN
    SELECT DISTINCT key FROM (
      SELECT key FROM jsonb_each(unit_cols)
      UNION ALL
      SELECT key FROM jsonb_each(unit_hex)
    ) keys
  LOOP
    set_parts := '';
    sep := '';

    IF unit_hex ? ukey THEN
      set_parts := set_parts
        || 'hex_q = ' || quote_literal(unit_hex->ukey->>'q')
        || ', hex_r = ' || quote_literal(unit_hex->ukey->>'r')
        || ', hex_s = ' || quote_literal(unit_hex->ukey->>'s');
      sep := ', ';
    END IF;

    -- organization_level is derived from the final formation when present.
    IF unit_formation ? ukey THEN
      org_level := CASE unit_formation->ukey #>> '{}'
        WHEN 'Routed' THEN '0' WHEN 'Scattered' THEN '0' WHEN 'Hero' THEN '0'
        WHEN 'Open Order' THEN '1' WHEN 'Close Order' THEN '2'
        WHEN 'Phalanx' THEN '3' WHEN 'Shield Wall' THEN '3' ELSE '0'
      END;
      set_parts := set_parts || sep || 'organization_level = ' || quote_literal(org_level);
      sep := ', ';
    END IF;

    IF unit_cols ? ukey THEN
      FOR col IN SELECT key, value FROM jsonb_each(unit_cols->ukey)
      LOOP
        -- Derived from the formation above; skip an explicit duplicate.
        IF col.key = 'organization_level' AND unit_formation ? ukey THEN
          CONTINUE;
        END IF;
        set_parts := set_parts || sep || quote_ident(col.key) || ' = ' || quote_literal(col.value #>> '{}');
        sep := ', ';
      END LOOP;
    END IF;

    EXECUTE format(
      'UPDATE units SET %s, command_seq = %L, updated_at = now() WHERE id = %L AND scenario_id = %L',
      set_parts, p_command_seq, ukey, p_scenario_id
    );
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION apply_substeps(uuid, jsonb, boolean, bigint) FROM PUBLIC;
