-- 056: Stamp every units write with the command_log seq and guard realtime on it.
--
-- The charge bug: a full charge attack runs two sequential server commands
-- (ATTACK then CHARGE_END which drops org Open Order -> Scattered). Both write
-- the same units row and fire realtime UPDATE events. The client's optimistic
-- apply sets Scattered, but useSupabaseSync.handleRealtime wholesale-replaces
-- the unit with every event's row; if the stale ATTACK event (whose row snapshot
-- still says Open Order) is delivered last, it clobbers the local formation back
-- to Open Order and it stays wrong until a refresh.
--
-- Fix: apply_substeps stamps every units write with the executing command's
-- monotonic seq (command_log.seq, migration 051). Realtime payloads carry the
-- row including command_seq; the client ignores any event whose command_seq is
-- not strictly newer than the one already applied. A stale event can never win,
-- regardless of delivery order. Undo/redo stamp with a fresh nextval so a
-- reverted/re-applied state always supersedes earlier events.

ALTER TABLE units ADD COLUMN IF NOT EXISTS command_seq BIGINT NOT NULL DEFAULT 0;

-- apply_substeps gains p_command_seq and stamps every unit write with it.
-- Internal (never granted to clients) — called by execute/undo/redo.
CREATE OR REPLACE FUNCTION apply_substeps(
  p_scenario_id uuid,
  p_steps jsonb,
  p_use_to boolean,
  p_command_seq bigint
)
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

    -- Unit step. Every write also stamps command_seq so the realtime handler can
    -- order events monotonically and drop stale ones.
    FOR chg_rec IN
      SELECT value, ord
      FROM jsonb_array_elements(COALESCE(step_rec.value->'changes', '[]'::jsonb)) WITH ORDINALITY AS u(value, ord)
      ORDER BY CASE WHEN p_use_to THEN ord ELSE -ord END
    LOOP
      fld := chg_rec.value->>'field';
      val := chg_rec.value -> (CASE WHEN p_use_to THEN 'to' ELSE 'from' END);

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

-- execute_command: insert the log row first (returning its monotonic seq), then
-- apply the deltas stamped with that seq — same transaction, atomic as before.
-- Preserves the 052 alliance-wide END_TURN gate.
CREATE OR REPLACE FUNCTION execute_command(
  p_scenario_id uuid,
  p_player_id uuid,
  p_player_name text,
  p_action_type text,
  p_description text,
  p_sub_steps jsonb,
  p_chained boolean DEFAULT false
)
RETURNS SETOF command_log
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_id uuid := gen_random_uuid();
  cmd_seq bigint;
  step_rec record;
  step_type text;
  is_gm boolean;
BEGIN
  IF auth.uid() IS NULL OR auth.uid() <> p_player_id THEN
    RETURN; -- must act as yourself
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM scenario_participants
    WHERE scenario_id = p_scenario_id AND user_id = auth.uid() AND role = 'GM'
  ) INTO is_gm;

  -- Any command requires participation in the scenario.
  IF NOT is_gm AND NOT EXISTS (
    SELECT 1 FROM scenario_participants
    WHERE scenario_id = p_scenario_id AND user_id = auth.uid()
  ) THEN
    RETURN;
  END IF;

  -- ALLIANCE steps are GM-only. SCENARIO steps are GM-only EXCEPT the END_TURN
  -- transition, which any player whose alliance currently holds the turn may
  -- advance. Free play (current_turn_alliance IS NULL) stays GM-only.
  IF NOT is_gm THEN
    FOR step_rec IN SELECT value FROM jsonb_array_elements(p_sub_steps)
    LOOP
      step_type := step_rec.value->>'type';
      IF step_type = 'ALLIANCE' THEN
        RETURN;
      END IF;
      IF step_type = 'SCENARIO' THEN
        IF p_action_type <> 'END_TURN' THEN
          RETURN;
        END IF;
        IF NOT EXISTS (
          SELECT 1
          FROM scenario_participants sp
          JOIN team_alliances ta
            ON ta.scenario_id = sp.scenario_id AND ta.team = sp.team
          WHERE sp.scenario_id = p_scenario_id
            AND sp.user_id = auth.uid()
            AND sp.team IS NOT NULL
            AND ta.alliance_group = (
              SELECT current_turn_alliance FROM scenarios WHERE id = p_scenario_id
            )
        ) THEN
          RETURN;
        END IF;
      END IF;
    END LOOP;
  END IF;

  -- Atomic: insert the log row (obtaining its monotonic seq), then apply the
  -- deltas stamped with that seq — all in one transaction.
  INSERT INTO command_log (id, scenario_id, player_id, player_name, action_type, description, sub_steps, chained)
  VALUES (new_id, p_scenario_id, p_player_id, p_player_name, p_action_type, p_description, p_sub_steps, COALESCE(p_chained, false))
  RETURNING seq INTO cmd_seq;

  PERFORM apply_substeps(p_scenario_id, p_sub_steps, true, cmd_seq);

  RETURN QUERY SELECT * FROM command_log WHERE id = new_id;
END;
$$;

REVOKE ALL ON FUNCTION execute_command(uuid, uuid, text, text, text, jsonb, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION execute_command(uuid, uuid, text, text, text, jsonb, boolean) TO authenticated;

-- undo_commands / redo_commands: stamp reverted / re-applied writes with a fresh
-- monotonic value (nextval on the command_log sequence) so the undo/redo state
-- always supersedes any earlier event, even one still in flight.
CREATE OR REPLACE FUNCTION undo_commands(p_scenario_id uuid, p_target_ids uuid[])
RETURNS SETOF command_log
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  top_ids uuid[];
  is_gm boolean;
  c record;
  stamp bigint;
BEGIN
  top_ids := live_top_chain(p_scenario_id);
  IF top_ids IS NULL THEN
    RETURN; -- empty log
  END IF;

  -- Reject unless the requested ids are exactly the live top chain.
  IF array_length(top_ids, 1) IS DISTINCT FROM array_length(p_target_ids, 1) THEN
    RETURN;
  END IF;
  IF NOT (top_ids @> p_target_ids AND p_target_ids @> top_ids) THEN
    RETURN;
  END IF;

  -- Permission: GM of the scenario, or owner of every row in the chain.
  SELECT EXISTS (
    SELECT 1 FROM scenario_participants
    WHERE scenario_id = p_scenario_id AND user_id = auth.uid() AND role = 'GM'
  ) INTO is_gm;

  IF NOT is_gm AND EXISTS (
    SELECT 1 FROM command_log WHERE id = ANY(top_ids) AND player_id <> auth.uid()
  ) THEN
    RETURN;
  END IF;

  -- Revert state (reverse chronological) then soft-delete, atomically.
  FOR c IN SELECT * FROM command_log WHERE id = ANY(top_ids) ORDER BY seq DESC
  LOOP
    SELECT nextval(pg_get_serial_sequence('command_log', 'seq')) INTO stamp;
    PERFORM apply_substeps(p_scenario_id, c.sub_steps, false, stamp);
  END LOOP;

  UPDATE command_log SET deleted_at = now()
  WHERE id = ANY(top_ids) AND deleted_at IS NULL;

  RETURN QUERY SELECT * FROM command_log WHERE id = ANY(top_ids) ORDER BY seq;
END;
$$;

REVOKE ALL ON FUNCTION undo_commands(uuid, uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION undo_commands(uuid, uuid[]) TO authenticated;

CREATE OR REPLACE FUNCTION redo_commands(p_scenario_id uuid, p_target_ids uuid[])
RETURNS SETOF command_log
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  batch_ids uuid[];
  is_gm boolean;
  top_seq bigint;
  c record;
  stamp bigint;
BEGIN
  batch_ids := newest_deleted_batch(p_scenario_id);
  IF batch_ids IS NULL THEN
    RETURN;
  END IF;

  IF array_length(batch_ids, 1) IS DISTINCT FROM array_length(p_target_ids, 1) THEN
    RETURN;
  END IF;
  IF NOT (batch_ids @> p_target_ids AND p_target_ids @> batch_ids) THEN
    RETURN;
  END IF;

  -- Permission: GM of the scenario, or owner of every row in the batch.
  SELECT EXISTS (
    SELECT 1 FROM scenario_participants
    WHERE scenario_id = p_scenario_id AND user_id = auth.uid() AND role = 'GM'
  ) INTO is_gm;

  IF NOT is_gm AND EXISTS (
    SELECT 1 FROM command_log WHERE id = ANY(batch_ids) AND player_id <> auth.uid()
  ) THEN
    RETURN;
  END IF;

  -- Invalidated if any live command was added after the batch (a new action
  -- clears redo). The batch's MAX seq is the top of the undone chain — any live
  -- row above it means the world has moved on since the undo.
  SELECT MAX(seq) INTO top_seq FROM command_log WHERE id = ANY(batch_ids);
  IF EXISTS (
    SELECT 1 FROM command_log
    WHERE scenario_id = p_scenario_id AND deleted_at IS NULL AND seq > top_seq
  ) THEN
    RETURN;
  END IF;

  -- Re-apply state (chronological) then undelete, atomically.
  FOR c IN SELECT * FROM command_log WHERE id = ANY(batch_ids) ORDER BY seq
  LOOP
    SELECT nextval(pg_get_serial_sequence('command_log', 'seq')) INTO stamp;
    PERFORM apply_substeps(p_scenario_id, c.sub_steps, true, stamp);
  END LOOP;

  UPDATE command_log SET deleted_at = NULL
  WHERE id = ANY(batch_ids) AND deleted_at IS NOT NULL;

  RETURN QUERY SELECT * FROM command_log WHERE id = ANY(batch_ids) ORDER BY seq;
END;
$$;

REVOKE ALL ON FUNCTION redo_commands(uuid, uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION redo_commands(uuid, uuid[]) TO authenticated;
