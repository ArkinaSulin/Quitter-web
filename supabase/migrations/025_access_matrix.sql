-- 025: Role → capability access matrix.
-- Privileges are data, not code: editing a row in access_roles changes what a role
-- can do (server-side RLS AND client button visibility), with no code change.
-- Roles: admin, dm, player, pending (profiles.role NULL = pending).
-- Capabilities: use_unit_editor, create_scenario, join_game, view_replay.
-- (Admin panel is hard-coded to admin only and is NOT a matrix capability.)

CREATE TABLE IF NOT EXISTS access_roles (
  role TEXT PRIMARY KEY,
  can_use_unit_editor BOOLEAN NOT NULL DEFAULT false,
  can_create_scenario  BOOLEAN NOT NULL DEFAULT false,
  can_join_game        BOOLEAN NOT NULL DEFAULT false,
  can_view_replay      BOOLEAN NOT NULL DEFAULT false
);

ALTER TABLE access_roles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS access_roles_select ON access_roles;
CREATE POLICY access_roles_select ON access_roles
  FOR SELECT USING (true);

-- Seed (matches current behavior). Adjust rows here later to change privileges.
INSERT INTO access_roles (role, can_use_unit_editor, can_create_scenario, can_join_game, can_view_replay) VALUES
  ('admin',   true,  true,  true,  true),
  ('dm',      true,  true,  true,  true),
  ('player',  false, false, true,  true),
  ('pending', false, false, false, true)
ON CONFLICT (role) DO NOTHING;

-- Server-side helper: does the current user's role grant `permission`?
-- profiles.role NULL is treated as 'pending'. Returns false for unknown roles.
CREATE OR REPLACE FUNCTION user_has_access(permission text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM access_roles ar
    WHERE ar.role = COALESCE((SELECT role FROM profiles WHERE id = auth.uid()), 'pending')
      AND CASE permission
        WHEN 'unit_editor'     THEN ar.can_use_unit_editor
        WHEN 'create_scenario' THEN ar.can_create_scenario
        WHEN 'join_game'       THEN ar.can_join_game
        WHEN 'view_replay'     THEN ar.can_view_replay
        ELSE false
      END
  );
$$;

REVOKE ALL ON FUNCTION user_has_access(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION user_has_access(text) TO authenticated;

-- RLS policies now read the matrix instead of hard-coded roles.
-- scenarios INSERT: replaces 016's `role IN ('admin','dm')`.
DROP POLICY IF EXISTS insert_approved_role ON scenarios;
CREATE POLICY "insert_approved_role" ON scenarios FOR INSERT TO authenticated
  WITH CHECK (user_has_access('create_scenario'));

-- scenario_participants INSERT: replaces 016's `role IS NOT NULL`.
DROP POLICY IF EXISTS insert_approved_role ON scenario_participants;
CREATE POLICY "insert_approved_role" ON scenario_participants FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id AND user_has_access('join_game'));
