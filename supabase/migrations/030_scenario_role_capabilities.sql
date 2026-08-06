-- 030: Per-scenario participant role → capability matrix.
-- Privileges are data, not code: editing a row in scenario_role_capabilities changes
-- what a scenario role can do (client-side gating), with no code change.
-- The GM (scenario creator) bypasses the table entirely and is not seeded here.
-- Scopes: own_team < own_alliance (via team_alliances) < any_team.
-- "move" implies "attack" — there is no separate attack capability.

CREATE TABLE IF NOT EXISTS scenario_role_capabilities (
  role TEXT PRIMARY KEY,
  move_own_team        BOOLEAN NOT NULL DEFAULT false,
  move_own_alliance    BOOLEAN NOT NULL DEFAULT false,
  move_any_team        BOOLEAN NOT NULL DEFAULT false,
  adjust_team_stats    BOOLEAN NOT NULL DEFAULT false,
  adjust_alliance_stats BOOLEAN NOT NULL DEFAULT false,
  adjust_all_stats     BOOLEAN NOT NULL DEFAULT false,
  view_own_team        BOOLEAN NOT NULL DEFAULT false,
  view_own_alliance    BOOLEAN NOT NULL DEFAULT false,
  view_any_team        BOOLEAN NOT NULL DEFAULT false,
  assign_unit_team     BOOLEAN NOT NULL DEFAULT false,
  change_unit_visibility BOOLEAN NOT NULL DEFAULT false,
  add_unit             BOOLEAN NOT NULL DEFAULT false,
  choose_map           BOOLEAN NOT NULL DEFAULT false,
  change_user_role     BOOLEAN NOT NULL DEFAULT false,
  kick_player          BOOLEAN NOT NULL DEFAULT false,
  close_room           BOOLEAN NOT NULL DEFAULT false
);

ALTER TABLE scenario_role_capabilities ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS scenario_role_capabilities_select ON scenario_role_capabilities;
CREATE POLICY scenario_role_capabilities_select ON scenario_role_capabilities
  FOR SELECT USING (true);

-- Seed (learning phase: all non-GM roles view everything; view_own_* tiers unused
-- until the matrix is tightened). Adjust rows later to change privileges.
INSERT INTO scenario_role_capabilities
  (role, move_own_team, move_own_alliance, move_any_team, adjust_team_stats, adjust_alliance_stats, adjust_all_stats, view_any_team)
VALUES
  ('Player',      true, false, false, true,  false, false, true),
  ('SuperPlayer', true, true,  false, true,  true,  false, true),
  ('AssistGM',    true, true,  true,  true,  true,  true,  true)
ON CONFLICT (role) DO NOTHING;

-- Server-side helper: does a scenario role grant `capability`?
CREATE OR REPLACE FUNCTION scenario_role_has_access(participant_role text, capability text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM scenario_role_capabilities src
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
