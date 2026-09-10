-- 081: Weapon Editor — access caps + RLS for the `weapons` library table.
--
-- The `weapons` table pre-existed (created manually; later migrations added
-- columns). Until now it had no repo-side schema/RLS and the library was edited
-- by hand in the dashboard. This adds view/use caps (mirroring the effect editor:
-- everyone views, admin/dm author) and enables RLS so the client can CRUD it
-- through the Weapon Editor page.

-- 1. Access matrix extensions.
ALTER TABLE access_roles ADD COLUMN IF NOT EXISTS can_view_weapon_editor BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE access_roles ADD COLUMN IF NOT EXISTS can_use_weapon_editor BOOLEAN NOT NULL DEFAULT false;

UPDATE access_roles SET can_view_weapon_editor = true, can_use_weapon_editor = true WHERE role IN ('admin', 'dm');
UPDATE access_roles SET can_view_weapon_editor = true, can_use_weapon_editor = false WHERE role NOT IN ('admin', 'dm');

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
        WHEN 'map_editor'        THEN ar.can_use_map_editor
        WHEN 'view_map_editor'   THEN ar.can_view_map_editor
        WHEN 'effect_editor'     THEN ar.can_use_effect_editor
        WHEN 'view_effect_editor' THEN ar.can_view_effect_editor
        WHEN 'weapon_editor'     THEN ar.can_use_weapon_editor
        WHEN 'view_weapon_editor' THEN ar.can_view_weapon_editor
        WHEN 'create_scenario'   THEN ar.can_create_scenario
        WHEN 'join_game'         THEN ar.can_join_game
        WHEN 'view_replay'       THEN ar.can_view_replay
        ELSE false
      END
  );
$$;

REVOKE ALL ON FUNCTION user_has_access(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION user_has_access(text) TO authenticated;

-- 2. Defensive: make sure every column the editor writes exists (idempotent).
ALTER TABLE weapons ADD COLUMN IF NOT EXISTS notes text;
ALTER TABLE weapons ADD COLUMN IF NOT EXISTS cost_gp numeric NOT NULL DEFAULT 0;
ALTER TABLE weapons ADD COLUMN IF NOT EXISTS attack_bonus integer NOT NULL DEFAULT 0;
ALTER TABLE weapons ADD COLUMN IF NOT EXISTS damage_dice text NOT NULL DEFAULT '1d6';
ALTER TABLE weapons ADD COLUMN IF NOT EXISTS is_reach boolean NOT NULL DEFAULT false;
ALTER TABLE weapons ADD COLUMN IF NOT EXISTS is_two_handed boolean NOT NULL DEFAULT false;
ALTER TABLE weapons ADD COLUMN IF NOT EXISTS number_of_attacks integer NOT NULL DEFAULT 1;
ALTER TABLE weapons ADD COLUMN IF NOT EXISTS range integer NOT NULL DEFAULT 1;
ALTER TABLE weapons ADD COLUMN IF NOT EXISTS max_range integer NOT NULL DEFAULT 0;
ALTER TABLE weapons ADD COLUMN IF NOT EXISTS magic_dimension integer NOT NULL DEFAULT 0;
ALTER TABLE weapons ADD COLUMN IF NOT EXISTS shape text NOT NULL DEFAULT 'circle';
ALTER TABLE weapons ADD COLUMN IF NOT EXISTS no_retaliation boolean NOT NULL DEFAULT false;
ALTER TABLE weapons ADD COLUMN IF NOT EXISTS free_action boolean NOT NULL DEFAULT false;
ALTER TABLE weapons ADD COLUMN IF NOT EXISTS on_save_half_or_neg boolean NOT NULL DEFAULT true;
ALTER TABLE weapons ADD COLUMN IF NOT EXISTS saving_throw text NOT NULL DEFAULT 'Dex';
ALTER TABLE weapons ADD COLUMN IF NOT EXISTS is_healing boolean NOT NULL DEFAULT false;

-- 3. RLS: read = view cap (everyone), write = use cap (admin/dm).
ALTER TABLE weapons ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "weapons_select" ON weapons;
CREATE POLICY "weapons_select"
  ON weapons FOR SELECT TO authenticated
  USING (user_has_access('view_weapon_editor'));

DROP POLICY IF EXISTS "weapons_insert" ON weapons;
CREATE POLICY "weapons_insert"
  ON weapons FOR INSERT TO authenticated
  WITH CHECK (user_has_access('weapon_editor'));

DROP POLICY IF EXISTS "weapons_update" ON weapons;
CREATE POLICY "weapons_update"
  ON weapons FOR UPDATE TO authenticated
  USING (user_has_access('weapon_editor'))
  WITH CHECK (user_has_access('weapon_editor'));

DROP POLICY IF EXISTS "weapons_delete" ON weapons;
CREATE POLICY "weapons_delete"
  ON weapons FOR DELETE TO authenticated
  USING (user_has_access('weapon_editor'));
