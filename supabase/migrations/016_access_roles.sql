-- Migration 016: Access roles + request-to-join whitelist
-- profiles.role = 'admin' | 'dm' | 'player'; NULL = pending (no access).
--   admin  — full access to everything, incl. the in-app admin panel.
--   dm     — can create scenarios and use the Unit Editor.
--   player — can join/play scenarios only.
-- Role changes happen ONLY via the admin-only RPC set_player_role below, never via
-- direct UPDATE/INSERT, so a user cannot promote themselves.

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS role TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS request_note TEXT;

-- Users may create their own row, but never with a role (it defaults to NULL = pending).
REVOKE INSERT ON profiles FROM authenticated;
GRANT INSERT (id, display_name, request_note, created_at) ON profiles TO authenticated;

-- Users may update only their display name + request note, never role.
REVOKE UPDATE ON profiles FROM authenticated;
GRANT UPDATE (display_name, request_note, updated_at) ON profiles TO authenticated;

-- Admin-only role management RPC (SECURITY DEFINER runs as owner, bypassing RLS).
CREATE OR REPLACE FUNCTION set_player_role(target_user_id uuid, new_role text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller_role text;
BEGIN
  SELECT role INTO caller_role FROM profiles WHERE id = auth.uid();
  IF caller_role IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'Only admins can change roles';
  END IF;
  IF new_role IS NOT NULL AND new_role NOT IN ('admin', 'dm', 'player') THEN
    RAISE EXCEPTION 'Invalid role: %', new_role;
  END IF;
  UPDATE profiles SET role = new_role, updated_at = now() WHERE id = target_user_id;
  RETURN FOUND;
END;
$$;

REVOKE EXECUTE ON FUNCTION set_player_role(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION set_player_role(uuid, text) TO authenticated;

-- Server-side hardening: creating a scenario requires an approved DM/Admin profile.
-- NOTE: policies are OR-combined — if a broader INSERT policy already exists on
-- `scenarios`, drop it first: SELECT policyname FROM pg_policies WHERE tablename='scenarios';
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'scenarios' AND policyname = 'insert_approved_role'
  ) THEN
    EXECUTE format(
      'CREATE POLICY "insert_approved_role" ON scenarios FOR INSERT TO authenticated WITH CHECK (
        EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN (''admin'', ''dm''))
      )'
    );
  END IF;
END $$;

-- Joining a scenario as a participant requires an approved profile (any role).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'scenario_participants' AND policyname = 'insert_approved_role'
  ) THEN
    EXECUTE format(
      'CREATE POLICY "insert_approved_role" ON scenario_participants FOR INSERT TO authenticated WITH CHECK (
        auth.uid() = user_id
        AND EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IS NOT NULL)
      )'
    );
  END IF;
END $$;
