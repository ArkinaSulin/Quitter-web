-- 057: DM heartbeat for reliable disconnect detection / recovery.
--
-- Replaces the fragile presence-channel liveness signals:
--   - In-scenario lock (dmGone) was set only on a presence `sync` event and had
--     no recovery path (setDmGone was never reset to false).
--   - checkDMOnline guessed from a presence snapshot + a 1.5s poll, producing
--     false "DM not in room" claims.
--
-- Now the GM writes dm_heartbeat_at every ~5s (heartbeat_dm); players (and the
-- GM itself) poll it and treat `now() - dm_heartbeat_at > 20s` as "DM gone" —
-- locking all controls. A fresh beat automatically unlocks, so players can sit
-- in the scenario and wait; no refresh needed.

ALTER TABLE scenarios ADD COLUMN IF NOT EXISTS dm_heartbeat_at timestamptz;

-- GM-only heartbeat. Deliberately does NOT bump updated_at so the lobby's
-- "recently modified" sort is not polluted by a 5s heartbeat.
CREATE OR REPLACE FUNCTION heartbeat_dm(p_scenario_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN false;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM scenario_participants
    WHERE scenario_id = p_scenario_id AND user_id = auth.uid() AND role = 'GM'
  ) THEN
    RETURN false;
  END IF;

  UPDATE scenarios
  SET dm_heartbeat_at = now()
  WHERE id = p_scenario_id;

  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION heartbeat_dm(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION heartbeat_dm(uuid) TO authenticated;
