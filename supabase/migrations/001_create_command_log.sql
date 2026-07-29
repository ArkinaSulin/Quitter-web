CREATE TABLE command_log (
  id UUID PRIMARY KEY,
  scenario_id UUID NOT NULL REFERENCES scenarios(id),
  player_id UUID NOT NULL,
  player_name TEXT NOT NULL DEFAULT '',
  action_type TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  sub_steps JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX idx_command_log_scenario ON command_log(scenario_id, created_at);

ALTER TABLE command_log ENABLE ROW LEVEL SECURITY;

-- Any authenticated user can insert their own action
CREATE POLICY "insert_own_action"
  ON command_log FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = player_id);

-- Any participant in the scenario can read the log
CREATE POLICY "select_scenario_log"
  ON command_log FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM scenario_participants
      WHERE scenario_id = command_log.scenario_id
        AND user_id = auth.uid()
    )
  );

-- The player who owns the action can undo it (soft-delete)
-- GMs can undo any action in their scenario
CREATE POLICY "update_own_or_gm"
  ON command_log FOR UPDATE
  TO authenticated
  USING (
    auth.uid() = player_id
    OR
    EXISTS (
      SELECT 1 FROM scenario_participants
      WHERE scenario_id = command_log.scenario_id
        AND user_id = auth.uid()
        AND role = 'GM'
    )
  )
  WITH CHECK (
    auth.uid() = player_id
    OR
    EXISTS (
      SELECT 1 FROM scenario_participants
      WHERE scenario_id = command_log.scenario_id
        AND user_id = auth.uid()
        AND role = 'GM'
    )
  );
