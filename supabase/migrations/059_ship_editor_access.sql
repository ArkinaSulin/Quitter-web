-- 059: Shipyard access — view + use capabilities for the ship builder.
-- Archfar's Shipyard (future ship builder) is admin-only: can_view_ship_editor
-- gates button visibility, can_use_ship_editor will gate the builder itself.
-- Mirrors the 050 can_view_unit_editor pattern.

ALTER TABLE access_roles ADD COLUMN IF NOT EXISTS can_view_ship_editor BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE access_roles ADD COLUMN IF NOT EXISTS can_use_ship_editor BOOLEAN NOT NULL DEFAULT false;

UPDATE access_roles SET can_view_ship_editor = true, can_use_ship_editor = true WHERE role = 'admin';
UPDATE access_roles SET can_view_ship_editor = false, can_use_ship_editor = false WHERE role IS DISTINCT FROM 'admin';

-- Server-side helper: extend the capability matrix with the shipyard capabilities.
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
        WHEN 'unit_editor'       THEN ar.can_use_unit_editor
        WHEN 'view_unit_editor'  THEN ar.can_view_unit_editor
        WHEN 'ship_editor'       THEN ar.can_use_ship_editor
        WHEN 'view_ship_editor'  THEN ar.can_view_ship_editor
        WHEN 'create_scenario'   THEN ar.can_create_scenario
        WHEN 'join_game'         THEN ar.can_join_game
        WHEN 'view_replay'       THEN ar.can_view_replay
        ELSE false
      END
  );
$$;

REVOKE ALL ON FUNCTION user_has_access(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION user_has_access(text) TO authenticated;
