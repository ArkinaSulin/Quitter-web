-- 098: Consistent table naming across subsystems.
--
-- Purely a rename + rebind migration: no data, columns, or behaviour change.
-- Names are grouped by subsystem prefix:
--   user_*     identity (profile)
--   admin_*    global-role access matrix, audit, game settings
--   scenario_* per-scenario runtime (roster, alliances, history, replay, rights)
--   unit_*     land-unit system + lookup libraries
--   map_*      reusable maps
--   ship_*     Spelljammer (already consistent; only the instance table moved here)
--
-- ⚠️ APPLY ORDER: pending migrations 081, 093 and 095 reference the OLD names
-- (`weapons`, `access_roles`, `command_log`, `team_alliances`). Apply every
-- migration numbered below 098 BEFORE this one, or those will fail against the
-- renamed schema. This file itself is idempotent for re-runs (IF EXISTS guards),
-- but a re-run of 081/093/095 after 098 will not be.
--
-- PostgreSQL stores VIEWs by object identity, so `profile_access` is simply
-- renamed. FUNCTION bodies are stored as text and resolve table names at
-- execution, so every function bound to a renamed table is recreated here with
-- the new names (verbatim bodies, only the table identifiers changed).

-- ---------------------------------------------------------------------------
-- 1. Renames
-- ---------------------------------------------------------------------------
ALTER TABLE IF EXISTS profiles                   RENAME TO user_profile;
ALTER TABLE IF EXISTS settings                   RENAME TO admin_game_settings;
ALTER TABLE IF EXISTS access_roles               RENAME TO admin_role_access_rights;
ALTER TABLE IF EXISTS role_changes               RENAME TO admin_role_changes;
ALTER TABLE IF EXISTS scenario_role_capabilities RENAME TO scenario_role_access_rights;
ALTER TABLE IF EXISTS team_alliances             RENAME TO scenario_team_alliance;
ALTER TABLE IF EXISTS replay_state               RENAME TO scenario_replay_state;
ALTER TABLE IF EXISTS command_log                RENAME TO scenario_command_log;
ALTER TABLE IF EXISTS races                      RENAME TO unit_races;
ALTER TABLE IF EXISTS mounts                     RENAME TO unit_mounts;
ALTER TABLE IF EXISTS weapons                    RENAME TO unit_weapons;
ALTER TABLE IF EXISTS armors                     RENAME TO unit_armors;
ALTER TABLE IF EXISTS formations                 RENAME TO unit_formations;
ALTER TABLE IF EXISTS size_categories            RENAME TO unit_size_categories;
ALTER TABLE IF EXISTS effect_templates           RENAME TO map_effect_templates;
ALTER TABLE IF EXISTS spelljammer_ships          RENAME TO ship_spelljammer;
ALTER VIEW  IF EXISTS profile_access             RENAME TO user_profile_last_change;

-- ---------------------------------------------------------------------------
-- 2. Recreate functions bound to renamed tables (latest definitions)
-- ---------------------------------------------------------------------------

-- handle_new_user (from 026) — user_profile.
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO user_profile (id, display_name)
  VALUES (
    NEW.id,
    COALESCE(
      NEW.raw_user_meta_data->>'full_name',
      NEW.raw_user_meta_data->>'name',
      NEW.email
    )
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

-- set_player_role (from 017) — user_profile, admin_role_changes.
CREATE OR REPLACE FUNCTION set_player_role(target_user_id uuid, new_role text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller_role text;
  old_role text;
  admin_count integer;
  target_is_admin boolean;
BEGIN
  SELECT role INTO caller_role FROM user_profile WHERE id = auth.uid();
  IF caller_role IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'Only admins can change roles';
  END IF;

  IF target_user_id = auth.uid() THEN
    RAISE EXCEPTION 'You cannot change your own role';
  END IF;

  IF new_role IS NOT NULL AND new_role NOT IN ('admin', 'dm', 'player') THEN
    RAISE EXCEPTION 'Invalid role: %', new_role;
  END IF;

  SELECT role INTO old_role FROM user_profile WHERE id = target_user_id;

  IF NOT EXISTS (SELECT 1 FROM user_profile WHERE id = target_user_id) THEN
    RAISE EXCEPTION 'Target user has no profile';
  END IF;

  SELECT (role = 'admin') INTO target_is_admin FROM user_profile WHERE id = target_user_id;

  IF target_is_admin AND new_role IS DISTINCT FROM 'admin' THEN
    SELECT count(*) INTO admin_count FROM user_profile WHERE role = 'admin';
    IF admin_count <= 1 THEN
      RAISE EXCEPTION 'Cannot change the last remaining admin';
    END IF;
  END IF;

  UPDATE user_profile SET role = new_role, updated_at = now() WHERE id = target_user_id;

  INSERT INTO admin_role_changes (target_user_id, changed_by, old_role, new_role)
  VALUES (target_user_id, auth.uid(), old_role, new_role);

  RETURN FOUND;
END;
$$;

REVOKE EXECUTE ON FUNCTION set_player_role(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION set_player_role(uuid, text) TO authenticated;

-- user_has_access (from 093) — admin_role_access_rights, user_profile.
CREATE OR REPLACE FUNCTION user_has_access(permission text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM admin_role_access_rights ar
    WHERE ar.role = COALESCE((SELECT role FROM user_profile WHERE id = auth.uid()), 'pending')
      AND CASE permission
        WHEN 'unit_editor'       THEN ar.can_use_unit_editor
        WHEN 'view_unit_editor'  THEN ar.can_view_unit_editor
        WHEN 'ship_editor'       THEN ar.can_use_ship_editor
        WHEN 'view_ship_editor'  THEN ar.can_view_ship_editor
        WHEN 'map_editor'        THEN ar.can_use_map_editor
        WHEN 'view_map_editor'   THEN ar.can_view_map_editor
        WHEN 'effect_editor'     THEN ar.can_use_effect_editor
        WHEN 'view_effect_editor' THEN ar.can_view_effect_editor
        WHEN 'weapon_editor'     THEN ar.can_use_weapon_editor
        WHEN 'view_weapon_editor' THEN ar.can_view_weapon_editor
        WHEN 'structure_editor'  THEN ar.can_use_structure_editor
        WHEN 'view_structure_editor' THEN ar.can_view_structure_editor
        WHEN 'create_scenario'   THEN ar.can_create_scenario
        WHEN 'join_game'         THEN ar.can_join_game
        WHEN 'view_replay'       THEN ar.can_view_replay
        ELSE false
      END
  );
$$;

REVOKE ALL ON FUNCTION user_has_access(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION user_has_access(text) TO authenticated;

-- scenario_role_has_access (from 030) — scenario_role_access_rights.
CREATE OR REPLACE FUNCTION scenario_role_has_access(participant_role text, capability text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM scenario_role_access_rights src
    WHERE src.role = participant_role
      AND CASE capability
        WHEN 'move_own_team'        THEN src.move_own_team
        WHEN 'move_own_alliance'    THEN src.move_own_alliance
        WHEN 'move_any_team'        THEN src.move_any_team
        WHEN 'adjust_team_stats'    THEN src.adjust_team_stats
        WHEN 'adjust_alliance_stats' THEN src.adjust_alliance_stats
        WHEN 'adjust_all_stats'     THEN src.adjust_all_stats
        WHEN 'view_own_team'        THEN src.view_own_team
        WHEN 'view_own_alliance'    THEN src.view_own_alliance
        WHEN 'view_any_team'        THEN src.view_any_team
        WHEN 'assign_unit_team'     THEN src.assign_unit_team
        WHEN 'change_unit_visibility' THEN src.change_unit_visibility
        WHEN 'add_unit'             THEN src.add_unit
        WHEN 'choose_map'           THEN src.choose_map
        WHEN 'change_user_role'     THEN src.change_user_role
        WHEN 'kick_player'          THEN src.kick_player
        WHEN 'close_room'           THEN src.close_room
        ELSE false
      END
  );
$$;

REVOKE ALL ON FUNCTION scenario_role_has_access(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION scenario_role_has_access(text, text) TO authenticated;

-- apply_substeps (from 095) — scenario_team_alliance.
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

-- live_top_chain / newest_deleted_batch (from 051) — scenario_command_log.
CREATE OR REPLACE FUNCTION live_top_chain(p_scenario_id uuid)
RETURNS uuid[]
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH RECURSIVE chain AS (
    SELECT c.id, c.chained, c.seq
    FROM scenario_command_log c
    WHERE c.scenario_id = p_scenario_id AND c.deleted_at IS NULL
      AND c.seq = (
        SELECT MAX(seq) FROM scenario_command_log
        WHERE scenario_id = p_scenario_id AND deleted_at IS NULL
      )
    UNION ALL
    SELECT c.id, c.chained, c.seq
    FROM scenario_command_log c
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
  FROM scenario_command_log
  WHERE scenario_id = p_scenario_id
    AND deleted_at IS NOT NULL
    AND deleted_at = (
      SELECT MAX(deleted_at) FROM scenario_command_log
      WHERE scenario_id = p_scenario_id AND deleted_at IS NOT NULL
    );
$$;

-- execute_command (from 056) — scenario_command_log, scenario_team_alliance.
CREATE OR REPLACE FUNCTION execute_command(
  p_scenario_id uuid,
  p_player_id uuid,
  p_player_name text,
  p_action_type text,
  p_description text,
  p_sub_steps jsonb,
  p_chained boolean DEFAULT false
)
RETURNS SETOF scenario_command_log
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

  IF NOT is_gm AND NOT EXISTS (
    SELECT 1 FROM scenario_participants
    WHERE scenario_id = p_scenario_id AND user_id = auth.uid()
  ) THEN
    RETURN;
  END IF;

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
          JOIN scenario_team_alliance ta
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

  INSERT INTO scenario_command_log (id, scenario_id, player_id, player_name, action_type, description, sub_steps, chained)
  VALUES (new_id, p_scenario_id, p_player_id, p_player_name, p_action_type, p_description, p_sub_steps, COALESCE(p_chained, false))
  RETURNING seq INTO cmd_seq;

  PERFORM apply_substeps(p_scenario_id, p_sub_steps, true, cmd_seq);

  RETURN QUERY SELECT * FROM scenario_command_log WHERE id = new_id;
END;
$$;

REVOKE ALL ON FUNCTION execute_command(uuid, uuid, text, text, text, jsonb, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION execute_command(uuid, uuid, text, text, text, jsonb, boolean) TO authenticated;

-- undo_commands / redo_commands (from 056) — scenario_command_log.
CREATE OR REPLACE FUNCTION undo_commands(p_scenario_id uuid, p_target_ids uuid[])
RETURNS SETOF scenario_command_log
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

  IF array_length(top_ids, 1) IS DISTINCT FROM array_length(p_target_ids, 1) THEN
    RETURN;
  END IF;
  IF NOT (top_ids @> p_target_ids AND p_target_ids @> top_ids) THEN
    RETURN;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM scenario_participants
    WHERE scenario_id = p_scenario_id AND user_id = auth.uid() AND role = 'GM'
  ) INTO is_gm;

  IF NOT is_gm AND EXISTS (
    SELECT 1 FROM scenario_command_log WHERE id = ANY(top_ids) AND player_id <> auth.uid()
  ) THEN
    RETURN;
  END IF;

  FOR c IN SELECT * FROM scenario_command_log WHERE id = ANY(top_ids) ORDER BY seq DESC
  LOOP
    SELECT nextval(pg_get_serial_sequence('scenario_command_log', 'seq')) INTO stamp;
    PERFORM apply_substeps(p_scenario_id, c.sub_steps, false, stamp);
  END LOOP;

  UPDATE scenario_command_log SET deleted_at = now()
  WHERE id = ANY(top_ids) AND deleted_at IS NULL;

  RETURN QUERY SELECT * FROM scenario_command_log WHERE id = ANY(top_ids) ORDER BY seq;
END;
$$;

REVOKE ALL ON FUNCTION undo_commands(uuid, uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION undo_commands(uuid, uuid[]) TO authenticated;

CREATE OR REPLACE FUNCTION redo_commands(p_scenario_id uuid, p_target_ids uuid[])
RETURNS SETOF scenario_command_log
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

  SELECT EXISTS (
    SELECT 1 FROM scenario_participants
    WHERE scenario_id = p_scenario_id AND user_id = auth.uid() AND role = 'GM'
  ) INTO is_gm;

  IF NOT is_gm AND EXISTS (
    SELECT 1 FROM scenario_command_log WHERE id = ANY(batch_ids) AND player_id <> auth.uid()
  ) THEN
    RETURN;
  END IF;

  SELECT MAX(seq) INTO top_seq FROM scenario_command_log WHERE id = ANY(batch_ids);
  IF EXISTS (
    SELECT 1 FROM scenario_command_log
    WHERE scenario_id = p_scenario_id AND deleted_at IS NULL AND seq > top_seq
  ) THEN
    RETURN;
  END IF;

  FOR c IN SELECT * FROM scenario_command_log WHERE id = ANY(batch_ids) ORDER BY seq
  LOOP
    SELECT nextval(pg_get_serial_sequence('scenario_command_log', 'seq')) INTO stamp;
    PERFORM apply_substeps(p_scenario_id, c.sub_steps, true, stamp);
  END LOOP;

  UPDATE scenario_command_log SET deleted_at = NULL
  WHERE id = ANY(batch_ids) AND deleted_at IS NOT NULL;

  RETURN QUERY SELECT * FROM scenario_command_log WHERE id = ANY(batch_ids) ORDER BY seq;
END;
$$;

REVOKE ALL ON FUNCTION redo_commands(uuid, uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION redo_commands(uuid, uuid[]) TO authenticated;

-- undo_state (from 051) — scenario_command_log.
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
  undo_anchor scenario_command_log%ROWTYPE;
  undo_count int;
  redo_ids uuid[];
  redo_anchor scenario_command_log%ROWTYPE;
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

  undo_ids := live_top_chain(p_scenario_id);
  IF undo_ids IS NOT NULL THEN
    SELECT * INTO undo_anchor FROM scenario_command_log WHERE id = undo_ids[1] LIMIT 1;
    undo_count := array_length(undo_ids, 1);
    undo_ok := is_gm OR NOT EXISTS (
      SELECT 1 FROM scenario_command_log WHERE id = ANY(undo_ids) AND player_id <> auth.uid()
    );
  END IF;

  redo_ids := newest_deleted_batch(p_scenario_id);
  IF redo_ids IS NOT NULL THEN
    SELECT * INTO redo_anchor FROM scenario_command_log WHERE id = redo_ids[1] LIMIT 1;
    redo_count := array_length(redo_ids, 1);
    SELECT MAX(seq) INTO top_seq FROM scenario_command_log WHERE id = ANY(redo_ids);
    redo_ok := (
      is_gm OR NOT EXISTS (
        SELECT 1 FROM scenario_command_log WHERE id = ANY(redo_ids) AND player_id <> auth.uid()
      )
    ) AND NOT EXISTS (
      SELECT 1 FROM scenario_command_log
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

-- seed_friendly_team_alliances (from 054) — scenario_team_alliance.
CREATE OR REPLACE FUNCTION seed_friendly_team_alliances()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO scenario_team_alliance (scenario_id, team, alliance_group)
  SELECT NEW.id, t.team, 'friendly'
  FROM (
    VALUES ('blue'), ('yellow'), ('violet'), ('black'), ('orange'), ('green')
  ) AS t(team)
  ON CONFLICT (scenario_id, team) DO NOTHING;
  RETURN NEW;
END;
$$;

-- request_scenario_deletion / clear_scenario_deletion_request (from 055) — user_profile.
CREATE OR REPLACE FUNCTION request_scenario_deletion(p_scenario_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller_role text;
  caller_name text;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN false;
  END IF;

  SELECT role, display_name INTO caller_role, caller_name
  FROM user_profile WHERE id = auth.uid();

  IF caller_role IS DISTINCT FROM 'admin' THEN
    RETURN false;
  END IF;

  IF EXISTS (
    SELECT 1 FROM scenarios WHERE id = p_scenario_id AND deletion_locked
  ) THEN
    RETURN false;
  END IF;

  UPDATE scenarios
  SET delete_requested_by = auth.uid(),
      delete_requested_by_name = caller_name,
      delete_requested_at = now()
  WHERE id = p_scenario_id;

  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION request_scenario_deletion(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION request_scenario_deletion(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION clear_scenario_deletion_request(p_scenario_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  is_admin boolean;
  is_creator boolean;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN false;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM user_profile WHERE id = auth.uid() AND role = 'admin'
  ) INTO is_admin;

  SELECT EXISTS (
    SELECT 1 FROM scenarios WHERE id = p_scenario_id AND creator_id = auth.uid()
  ) INTO is_creator;

  IF NOT is_admin AND NOT is_creator THEN
    RETURN false;
  END IF;

  UPDATE scenarios
  SET delete_requested_by = NULL,
      delete_requested_by_name = NULL,
      delete_requested_at = NULL
  WHERE id = p_scenario_id;

  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION clear_scenario_deletion_request(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION clear_scenario_deletion_request(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 3. Refresh PostgREST's schema cache so the new names are routable.
-- ---------------------------------------------------------------------------
NOTIFY pgrst, 'reload schema';
