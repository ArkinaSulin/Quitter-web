-- 074: Map entities — reusable authored maps (image + per-hex movement costs).
--
-- A "map entity" is a catalog row (like a unit template): background image from
-- the map_images bucket + placement + grid radius + per-hex MP entry costs stored
-- as JSONB `terrain_costs` ("q,r" -> 0..9; 0 = free, 1 = default/clear, 2..9 =
-- extra cost). hex_effects is RESERVED for a future map-effects pass (empty).
--
-- Scenarios SNAPSHOT a map into scenarios.map_data (image keys + terrainCosts) on
-- assignment, so a DM can tweak the copy. Map entities are authored by admin + dm.
--
-- Access (mirrors 059 shipyard): can_view_map_editor gates button/page visibility,
-- can_use_map_editor gates authoring (RLS writes).

ALTER TABLE access_roles ADD COLUMN IF NOT EXISTS can_view_map_editor BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE access_roles ADD COLUMN IF NOT EXISTS can_use_map_editor BOOLEAN NOT NULL DEFAULT false;

UPDATE access_roles SET can_view_map_editor = true, can_use_map_editor = true WHERE role IN ('admin', 'dm');
UPDATE access_roles SET can_view_map_editor = false, can_use_map_editor = false WHERE role NOT IN ('admin', 'dm');

-- Server-side helper: extend the capability matrix with the map editor.
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
        WHEN 'create_scenario'   THEN ar.can_create_scenario
        WHEN 'join_game'         THEN ar.can_join_game
        WHEN 'view_replay'       THEN ar.can_view_replay
        ELSE false
      END
  );
$$;

REVOKE ALL ON FUNCTION user_has_access(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION user_has_access(text) TO authenticated;

-- Map catalog table.
CREATE TABLE IF NOT EXISTS maps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  image_url text NOT NULL DEFAULT '',
  offset_x double precision NOT NULL DEFAULT 0,
  offset_y double precision NOT NULL DEFAULT 0,
  scale double precision NOT NULL DEFAULT 1,
  grid_radius integer NOT NULL DEFAULT 12,
  terrain_costs jsonb NOT NULL DEFAULT '{}'::jsonb,
  hex_effects jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE maps ENABLE ROW LEVEL SECURITY;

-- Read: anyone who may view the map editor (admin + dm) can browse/assign maps.
CREATE POLICY "map_catalog_select"
  ON maps FOR SELECT TO authenticated
  USING (user_has_access('view_map_editor'));

-- Write: authors only.
CREATE POLICY "map_catalog_insert"
  ON maps FOR INSERT TO authenticated
  WITH CHECK (user_has_access('map_editor'));

CREATE POLICY "map_catalog_update"
  ON maps FOR UPDATE TO authenticated
  USING (user_has_access('map_editor'));

CREATE POLICY "map_catalog_delete"
  ON maps FOR DELETE TO authenticated
  USING (user_has_access('map_editor'));
