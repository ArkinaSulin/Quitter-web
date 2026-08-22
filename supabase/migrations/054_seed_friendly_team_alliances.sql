-- 054: Seed every new scenario's teams into the friendly alliance.
--
-- The client treats a missing team_alliances row as 'friendly' (useTeamAlliances
-- buildMap + scenarioPermissions fallbacks), but the execute_command END_TURN
-- gate (052) requires an explicit row matching the current turn alliance. So a
-- scenario whose friendly/blue team has no row fails when a non-GM player ends
-- the turn ("Action failed — End Turn — …").
--
-- Fix: on scenario insert, write a friendly row for all six teams. The data now
-- matches the client default, and the strict server gate stays fail-closed.
--
-- SECURITY DEFINER is required: the trigger fires on the scenarios INSERT, which
-- happens BEFORE the creator's scenario_participants row is inserted, so RLS
-- (insert_gm) would otherwise block the seed.

CREATE OR REPLACE FUNCTION seed_friendly_team_alliances()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO team_alliances (scenario_id, team, alliance_group)
  SELECT NEW.id, t.team, 'friendly'
  FROM (
    VALUES ('blue'), ('yellow'), ('violet'), ('black'), ('orange'), ('green')
  ) AS t(team)
  ON CONFLICT (scenario_id, team) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS seed_friendly_team_alliances_on_scenario ON scenarios;
CREATE TRIGGER seed_friendly_team_alliances_on_scenario
AFTER INSERT ON scenarios
FOR EACH ROW
EXECUTE FUNCTION seed_friendly_team_alliances();
