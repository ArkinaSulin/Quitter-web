-- 052: Alliance-wide End Turn + replay co-watching + live command_log.
--
-- 1. Publish command_log to realtime so undo/redo state and the UndoDebugPanel
--    update live on every client (they subscribe to postgres_changes on the
--    table, which never fired because it wasn't in the publication).
-- 2. Relax execute_command so a NON-GM player may run END_TURN's SCENARIO step —
--    but only while their own alliance holds the turn (free play / null turn
--    stays GM-only, ALLIANCE steps stay GM-only).
-- 3. Add a tiny replay_state table (participant-writable, realtime-published)
--    so a player joining mid-replay enters replay and follows the driver.

-- 1. Publish command_log to realtime.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'command_log'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.command_log;
    END IF;
  END IF;
END $$;

-- 2. Relax execute_command for alliance-wide End Turn.
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

  -- Atomic: apply the deltas and insert the log row in one transaction.
  PERFORM apply_substeps(p_scenario_id, p_sub_steps, true);

  INSERT INTO command_log (id, scenario_id, player_id, player_name, action_type, description, sub_steps, chained)
  VALUES (new_id, p_scenario_id, p_player_id, p_player_name, p_action_type, p_description, p_sub_steps, COALESCE(p_chained, false));

  RETURN QUERY SELECT * FROM command_log WHERE id = new_id;
END;
$$;

REVOKE ALL ON FUNCTION execute_command(uuid, uuid, text, text, text, jsonb, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION execute_command(uuid, uuid, text, text, text, jsonb, boolean) TO authenticated;

-- 3. replay_state: per-scenario replay mode/cursor/playing, co-writable by any
-- participant so everyone can drive and late joiners catch up.
CREATE TABLE IF NOT EXISTS replay_state (
  scenario_id uuid PRIMARY KEY REFERENCES scenarios(id) ON DELETE CASCADE,
  mode text NOT NULL DEFAULT 'play' CHECK (mode IN ('play', 'replay')),
  cursor integer NOT NULL DEFAULT 0 CHECK (cursor >= 0),
  playing boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE replay_state ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS replay_state_select ON replay_state;
CREATE POLICY replay_state_select ON replay_state FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM scenario_participants
    WHERE scenario_id = replay_state.scenario_id AND user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS replay_state_insert ON replay_state;
CREATE POLICY replay_state_insert ON replay_state FOR INSERT TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM scenario_participants
    WHERE scenario_id = replay_state.scenario_id AND user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS replay_state_update ON replay_state;
CREATE POLICY replay_state_update ON replay_state FOR UPDATE TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM scenario_participants
    WHERE scenario_id = replay_state.scenario_id AND user_id = auth.uid()
  )
);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'replay_state'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.replay_state;
    END IF;
  END IF;
END $$;
