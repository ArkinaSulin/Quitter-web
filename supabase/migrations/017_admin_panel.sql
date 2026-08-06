-- Migration 017: Admin panel support — last access, role audit log, guarded role changes.

-- Track last access (fire-and-forget heartbeat from the client).
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS last_active_at TIMESTAMPTZ;

-- Allow users to write only their own last_active_at (extends the 016 column grant).
REVOKE UPDATE ON profiles FROM authenticated;
GRANT UPDATE (display_name, request_note, updated_at, last_active_at) ON profiles TO authenticated;

-- Audit log for role changes.
CREATE TABLE IF NOT EXISTS role_changes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  target_user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  changed_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  old_role text,
  new_role text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE role_changes ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'role_changes' AND policyname = 'select_all'
  ) THEN
    CREATE POLICY "select_all" ON role_changes FOR SELECT TO authenticated USING (true);
  END IF;
END $$;

-- Guarded role management RPC:
--   - admins only
--   - no self-changes (prevents accidental self-lockout)
--   - cannot change the last remaining admin (prevents total lockout)
--   - every change is audited in role_changes
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
  SELECT role INTO caller_role FROM profiles WHERE id = auth.uid();
  IF caller_role IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'Only admins can change roles';
  END IF;

  IF target_user_id = auth.uid() THEN
    RAISE EXCEPTION 'You cannot change your own role';
  END IF;

  IF new_role IS NOT NULL AND new_role NOT IN ('admin', 'dm', 'player') THEN
    RAISE EXCEPTION 'Invalid role: %', new_role;
  END IF;

  SELECT role INTO old_role FROM profiles WHERE id = target_user_id;

  -- The profile row must exist, but a NULL role (pending) is allowed — that is
  -- exactly who an admin approves. This was the bug: the guard rejected pending
  -- users ("Target user has no profile or is pending") so they could never be
  -- approved.
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = target_user_id) THEN
    RAISE EXCEPTION 'Target user has no profile';
  END IF;

  SELECT (role = 'admin') INTO target_is_admin FROM profiles WHERE id = target_user_id;

  -- Refuse to leave zero admins.
  IF target_is_admin AND new_role IS DISTINCT FROM 'admin' THEN
    SELECT count(*) INTO admin_count FROM profiles WHERE role = 'admin';
    IF admin_count <= 1 THEN
      RAISE EXCEPTION 'Cannot change the last remaining admin';
    END IF;
  END IF;

  UPDATE profiles SET role = new_role, updated_at = now() WHERE id = target_user_id;

  INSERT INTO role_changes (target_user_id, changed_by, old_role, new_role)
  VALUES (target_user_id, auth.uid(), old_role, new_role);

  RETURN FOUND;
END;
$$;

REVOKE EXECUTE ON FUNCTION set_player_role(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION set_player_role(uuid, text) TO authenticated;

-- Admin-panel view: every profile + its latest role change + who made it.
CREATE OR REPLACE VIEW profile_access AS
SELECT
  p.id,
  p.display_name,
  p.role,
  p.request_note,
  p.last_active_at,
  rc.changed_by AS last_changed_by,
  cp.display_name AS last_changed_by_name,
  rc.created_at AS last_role_change_at
FROM profiles p
LEFT JOIN LATERAL (
  SELECT * FROM role_changes rc
  WHERE rc.target_user_id = p.id
  ORDER BY rc.created_at DESC
  LIMIT 1
) rc ON true
LEFT JOIN profiles cp ON cp.id = rc.changed_by;
