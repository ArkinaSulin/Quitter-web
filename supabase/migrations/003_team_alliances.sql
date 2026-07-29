CREATE TABLE team_alliances (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  scenario_id uuid NOT NULL REFERENCES scenarios(id) ON DELETE CASCADE,
  team text NOT NULL,
  alliance_group text NOT NULL CHECK (alliance_group IN ('friendly', 'enemy', 'neutral')),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE (scenario_id, team)
);

ALTER TABLE team_alliances ENABLE ROW LEVEL SECURITY;

CREATE POLICY select_all ON team_alliances FOR SELECT USING (true);
CREATE POLICY insert_gm ON team_alliances FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM scenario_participants WHERE scenario_id = team_alliances.scenario_id AND user_id = auth.uid() AND role = 'GM')
);
CREATE POLICY update_gm ON team_alliances FOR UPDATE USING (
  EXISTS (SELECT 1 FROM scenario_participants WHERE scenario_id = team_alliances.scenario_id AND user_id = auth.uid() AND role = 'GM')
);
