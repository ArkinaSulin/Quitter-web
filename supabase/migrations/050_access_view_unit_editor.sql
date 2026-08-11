-- 050: read-only unit library access (view, not edit).
-- can_view_unit_editor lets a role browse the unit editor / unit library without
-- modifying anything. Default: everyone except pending. Full editing stays behind
-- can_use_unit_editor (admin/dm).

ALTER TABLE access_roles ADD COLUMN IF NOT EXISTS can_view_unit_editor BOOLEAN NOT NULL DEFAULT false;

UPDATE access_roles SET can_view_unit_editor = true WHERE role IN ('admin', 'dm', 'player');
UPDATE access_roles SET can_view_unit_editor = false WHERE role = 'pending';

-- Server-side helper: extend the capability matrix with view_unit_editor.
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
        WHEN 'create_scenario'   THEN ar.can_create_scenario
        WHEN 'join_game'         THEN ar.can_join_game
        WHEN 'view_replay'       THEN ar.can_view_replay
        ELSE false
      END
  );
$$;

REVOKE ALL ON FUNCTION user_has_access(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION user_has_access(text) TO authenticated;

-- unit_templates: everyone may read; only full editors may insert/update/delete.
-- (The base table predates migrations, so enable RLS + policies idempotently.)
ALTER TABLE unit_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS unit_templates_select ON unit_templates;
CREATE POLICY unit_templates_select ON unit_templates
  FOR SELECT TO authenticated
  USING (user_has_access('view_unit_editor'));

DROP POLICY IF EXISTS unit_templates_insert ON unit_templates;
CREATE POLICY unit_templates_insert ON unit_templates
  FOR INSERT TO authenticated
  WITH CHECK (user_has_access('unit_editor'));

DROP POLICY IF EXISTS unit_templates_update ON unit_templates;
CREATE POLICY unit_templates_update ON unit_templates
  FOR UPDATE TO authenticated
  USING (user_has_access('unit_editor'));

DROP POLICY IF EXISTS unit_templates_delete ON unit_templates;
CREATE POLICY unit_templates_delete ON unit_templates
  FOR DELETE TO authenticated
  USING (user_has_access('unit_editor'));
