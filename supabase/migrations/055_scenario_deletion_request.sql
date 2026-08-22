-- 055: Admin-marked scenario deletion with DM confirmation + 90-day auto-delete.
--
-- Flow:
--   1. An admin flags a scenario for deletion (request_scenario_deletion) —
--      recorded as delete_requested_by (+ name snapshot, + timestamp).
--   2. The scenario's creator (DM) sees it flagged in the lobby and either
--      confirms the delete (existing creator-only deleteScenario) or keeps it
--      (clear_scenario_deletion_request).
--   3. Unconfirmed flags auto-delete after 90 days (delete_expired_scenarios,
--      called lazily by the lobby). command_log / team_alliances / replay_state
--      cascade with the scenario (migrations 005/003/052); units and
--      scenario_participants are deleted explicitly, matching the client flow.

ALTER TABLE scenarios
  ADD COLUMN IF NOT EXISTS delete_requested_by uuid,
  ADD COLUMN IF NOT EXISTS delete_requested_by_name text,
  ADD COLUMN IF NOT EXISTS delete_requested_at timestamptz;

-- Admin flags a scenario for deletion. SECURITY DEFINER so the check runs as the
-- owner and bypasses RLS (the scenarios table is dashboard-managed).
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
  FROM profiles WHERE id = auth.uid();

  IF caller_role IS DISTINCT FROM 'admin' THEN
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

-- Clear a deletion request: the requesting admin or the scenario creator may.
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
    SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'
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

-- Delete every scenario whose deletion request is older than the 90-day grace
-- period, cleaning up units, participants, the screenshot object, and the
-- scenario row. Lobby calls this on load / refresh (lazy cleanup).
CREATE OR REPLACE FUNCTION delete_expired_scenarios()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  expired_ids uuid[];
  deleted_count integer := 0;
  s_id uuid;
BEGIN
  SELECT array_agg(id) INTO expired_ids
  FROM scenarios
  WHERE delete_requested_at IS NOT NULL
    AND delete_requested_at < now() - interval '90 days';

  IF expired_ids IS NULL THEN
    RETURN 0;
  END IF;

  FOREACH s_id IN ARRAY expired_ids
  LOOP
    DELETE FROM units WHERE scenario_id = s_id;
    DELETE FROM scenario_participants WHERE scenario_id = s_id;
    DELETE FROM storage.objects
    WHERE bucket_id = 'scenario_screenshots' AND name = format('scenario_%s.png', s_id);
    DELETE FROM scenarios WHERE id = s_id;
    deleted_count := deleted_count + 1;
  END LOOP;

  RETURN deleted_count;
END;
$$;

REVOKE ALL ON FUNCTION delete_expired_scenarios() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION delete_expired_scenarios() TO authenticated;
