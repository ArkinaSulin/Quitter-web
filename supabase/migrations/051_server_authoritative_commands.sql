-- 051: Server-authoritative command execution, undo, and redo.
--
-- command_log gains a monotonic `seq` so the live "top chain" is totally
-- ordered (created_at ties by uuid were arbitrary). All game-state mutations
-- now flow through execute_command / undo_commands / redo_commands, which apply
-- sub-step deltas to units/team_alliances/scenarios atomically with the log
-- mutation. The units table and the command log can no longer diverge, and no
-- client-side stack can go stale: undo/redo state is derived from the log by
-- undo_state.

-- 1. Monotonic ordering: command_log.seq
ALTER TABLE command_log ADD COLUMN seq BIGSERIAL;

-- Backfill so existing rows are ordered by their visible history.
WITH ordered AS (
  SELECT id, row_number() OVER (ORDER BY created_at, id) AS n
  FROM command_log
)
UPDATE command_log c SET seq = o.n FROM ordered o WHERE c.id = o.id;

-- Advance the sequence past the backfilled values.
SELECT setval(pg_get_serial_sequence('command_log', 'seq'), COALESCE((SELECT MAX(seq) FROM command_log), 0));

CREATE UNIQUE INDEX idx_command_log_seq ON command_log(seq);
CREATE INDEX idx_command_log_scenario_seq ON command_log(scenario_id, seq);

-- 2. Live top chain + newest deleted batch helpers (totally ordered by seq).
CREATE OR REPLACE FUNCTION live_top_chain(p_scenario_id uuid)
RETURNS uuid[]
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH RECURSIVE chain AS (
    SELECT c.id, c.chained, c.seq
    FROM command_log c
    WHERE c.scenario_id = p_scenario_id AND c.deleted_at IS NULL
      AND c.seq = (
        SELECT MAX(seq) FROM command_log
        WHERE scenario_id = p_scenario_id AND deleted_at IS NULL
      )
    UNION ALL
    SELECT c.id, c.chained, c.seq
    FROM command_log c
    JOIN chain ch ON c.seq = ch.seq - 1 AND ch.chained
    WHERE c.scenario_id = p_scenario_id AND c.deleted_at IS NULL
  )
  SELECT array_agg(id ORDER BY seq) FROM chain;
$$;

CREATE OR REPLACE FUNCTION newest_deleted_batch(p_scenario_id uuid)
RETURNS uuid[]
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT array_agg(id ORDER BY seq)
  FROM command_log
  WHERE scenario_id = p_scenario_id
    AND deleted_at IS NOT NULL
    AND deleted_at = (
      SELECT MAX(deleted_at) FROM command_log
      WHERE scenario_id = p_scenario_id AND deleted_at IS NOT NULL
    );
$$;

-- 3. Unit-field allowlist: camelCase sub-step field -> units column.
-- Mirrors updateUnit() in useSupabaseSync.ts. Returns NULL for unknown fields so
-- callers can raise loudly rather than silently skipping.
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

-- 4. apply_substeps: apply a command's sub-step deltas to the game tables.
-- p_use_to=true applies `to` values (execute/redo); false applies `from`
-- values in reverse order (undo). Runs as the function owner so the units/
-- team_alliances/scenarios writes are part of the same transaction as the
-- caller's log mutation. Internal — never granted to clients directly.
CREATE OR REPLACE FUNCTION apply_substeps(p_scenario_id uuid, p_steps jsonb, p_use_to boolean)
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

    -- Unit step.
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
            'UPDATE units SET hex_q = %L, hex_r = %L, hex_s = %L, updated_at = now() WHERE id = %L AND scenario_id = %L',
            val->>'q', val->>'r', val->>'s', step_rec.value->>'unitId', p_scenario_id
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
          'UPDATE units SET %I = %L, organization_level = %L, updated_at = now() WHERE id = %L AND scenario_id = %L',
          col, val #>> '{}', org_level, step_rec.value->>'unitId', p_scenario_id
        );
      ELSE
        EXECUTE format(
          'UPDATE units SET %I = %L, updated_at = now() WHERE id = %L AND scenario_id = %L',
          col, val #>> '{}', step_rec.value->>'unitId', p_scenario_id
        );
      END IF;
    END LOOP;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION apply_substeps(uuid, jsonb, boolean) FROM PUBLIC;

-- 5. execute_command: atomic apply + log insert.
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

  -- ALLIANCE / SCENARIO steps are GM-only (they write team_alliances / scenarios).
  IF NOT is_gm THEN
    FOR step_rec IN SELECT value FROM jsonb_array_elements(p_sub_steps)
    LOOP
      step_type := step_rec.value->>'type';
      IF step_type = 'ALLIANCE' OR step_type = 'SCENARIO' THEN
        RETURN;
      END IF;
    END LOOP;
  END IF;

  -- Atomic: apply the deltas and insert the log row in one transaction.
  PERFORM apply_substeps(p_scenario_id, p_sub_steps, true);

  INSERT INTO command_log (id, scenario_id, player_id, player_name, action_type, description, sub_steps, chained)
  VALUES (new_id, p_scenario_id, p_player_id, p_player_name, p_action_type, p_description, p_sub_steps, COALESCE(p_chained, false));

  RETURN QUERY SELECT * FROM command_log WHERE id = new_id;
END;
$$;

REVOKE ALL ON FUNCTION execute_command(uuid, uuid, text, text, text, jsonb, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION execute_command(uuid, uuid, text, text, text, jsonb, boolean) TO authenticated;

-- 6. undo_commands: revert the live top chain atomically.
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
    PERFORM apply_substeps(p_scenario_id, c.sub_steps, false);
  END LOOP;

  UPDATE command_log SET deleted_at = now()
  WHERE id = ANY(top_ids) AND deleted_at IS NULL;

  RETURN QUERY SELECT * FROM command_log WHERE id = ANY(top_ids) ORDER BY seq;
END;
$$;

REVOKE ALL ON FUNCTION undo_commands(uuid, uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION undo_commands(uuid, uuid[]) TO authenticated;

-- 7. redo_commands: undelete the newest deleted batch, re-applying its state.
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
    PERFORM apply_substeps(p_scenario_id, c.sub_steps, true);
  END LOOP;

  UPDATE command_log SET deleted_at = NULL
  WHERE id = ANY(batch_ids) AND deleted_at IS NOT NULL;

  RETURN QUERY SELECT * FROM command_log WHERE id = ANY(batch_ids) ORDER BY seq;
END;
$$;

REVOKE ALL ON FUNCTION redo_commands(uuid, uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION redo_commands(uuid, uuid[]) TO authenticated;

-- 8. undo_state: what can be undone/redone right now, from the log alone.
CREATE OR REPLACE FUNCTION undo_state(p_scenario_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  result jsonb;
  undo_ids uuid[];
  undo_anchor command_log%ROWTYPE;
  undo_count int;
  redo_ids uuid[];
  redo_anchor command_log%ROWTYPE;
  redo_count int;
  is_gm boolean;
  undo_ok boolean;
  redo_ok boolean;
  top_seq bigint;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM scenario_participants
    WHERE scenario_id = p_scenario_id AND user_id = auth.uid()
  ) THEN
    RETURN NULL;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM scenario_participants
    WHERE scenario_id = p_scenario_id AND user_id = auth.uid() AND role = 'GM'
  ) INTO is_gm;

  -- Undo: live top chain (anchor = oldest row = array index 1).
  undo_ids := live_top_chain(p_scenario_id);
  IF undo_ids IS NOT NULL THEN
    SELECT * INTO undo_anchor FROM command_log WHERE id = undo_ids[1] LIMIT 1;
    undo_count := array_length(undo_ids, 1);
    undo_ok := is_gm OR NOT EXISTS (
      SELECT 1 FROM command_log WHERE id = ANY(undo_ids) AND player_id <> auth.uid()
    );
  END IF;

  -- Redo: newest deleted batch.
  redo_ids := newest_deleted_batch(p_scenario_id);
  IF redo_ids IS NOT NULL THEN
    SELECT * INTO redo_anchor FROM command_log WHERE id = redo_ids[1] LIMIT 1;
    redo_count := array_length(redo_ids, 1);
    SELECT MAX(seq) INTO top_seq FROM command_log WHERE id = ANY(redo_ids);
    redo_ok := (
      is_gm OR NOT EXISTS (
        SELECT 1 FROM command_log WHERE id = ANY(redo_ids) AND player_id <> auth.uid()
      )
    ) AND NOT EXISTS (
      SELECT 1 FROM command_log
      WHERE scenario_id = p_scenario_id AND deleted_at IS NULL AND seq > top_seq
    );
  END IF;

  result := jsonb_build_object(
    'undo', CASE WHEN undo_ids IS NULL THEN NULL ELSE jsonb_build_object(
      'ids', to_jsonb(undo_ids),
      'count', undo_count,
      'description', undo_anchor.description,
      'playerName', undo_anchor.player_name,
      'canUndo', undo_ok
    ) END,
    'redo', CASE WHEN redo_ids IS NULL THEN NULL ELSE jsonb_build_object(
      'ids', to_jsonb(redo_ids),
      'count', redo_count,
      'description', redo_anchor.description,
      'playerName', redo_anchor.player_name,
      'canRedo', redo_ok
    ) END
  );
  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION undo_state(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION undo_state(uuid) TO authenticated;
