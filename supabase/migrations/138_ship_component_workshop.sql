-- 138: Component Workshop fields, weapon mass/range/fire-cycle changes, access.
--
-- Depends on 135/136/137.
--   * ship_components: + effect; weapon_large removed; weapon_small -> weapon_capacity.
--   * ship_weapons: + mass/min_range; range_std -> range; range_dis -> max_range;
--     fire_cycle_rd -> fire_cycle_step; mount dropped.
--   * ship_accessories: no field changes (mounts only).
--   * component editor access: admin/dm edit, others view.

-- ---------------------------------------------------------------------------
-- ship_components: effect + weapon capacity row
-- ---------------------------------------------------------------------------
ALTER TABLE ship_components ADD COLUMN IF NOT EXISTS effect text;

DELETE FROM ship_components WHERE name = 'weapon_large';
UPDATE ship_components SET name = 'weapon_capacity' WHERE name = 'weapon_small';

INSERT INTO ship_components (id, name, mass, crew, cost, hittable, ac, image_url, effect)
SELECT gen_random_uuid(), 'weapon_capacity', 1, 0, 0, true, 10, '', 'Weapon capacity'
WHERE NOT EXISTS (SELECT 1 FROM ship_components WHERE name = 'weapon_capacity');

UPDATE ship_components
SET mass = 1,
    crew = 0,
    hittable = true,
    cost = 0,
    effect = COALESCE(effect, 'Weapon capacity')
WHERE name = 'weapon_capacity';

-- ---------------------------------------------------------------------------
-- ship_weapons: mass / min_range / range / max_range / fire_cycle_step
-- ---------------------------------------------------------------------------
ALTER TABLE ship_weapons ADD COLUMN IF NOT EXISTS mass numeric NOT NULL DEFAULT 0;
ALTER TABLE ship_weapons ADD COLUMN IF NOT EXISTS min_range integer NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'ship_weapons' AND column_name = 'mount'
  ) THEN
    UPDATE ship_weapons
    SET mass = CASE
      WHEN mount = 'large' THEN 2
      WHEN mount = 'small' THEN 1
      ELSE 0
    END
    WHERE mass = 0;
    ALTER TABLE ship_weapons DROP COLUMN mount;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'ship_weapons' AND column_name = 'range_std'
  ) THEN
    ALTER TABLE ship_weapons RENAME COLUMN range_std TO range;
  END IF;
END $$;
ALTER TABLE ship_weapons ADD COLUMN IF NOT EXISTS range integer NOT NULL DEFAULT 0;
ALTER TABLE ship_weapons ALTER COLUMN range SET DEFAULT 0;
ALTER TABLE ship_weapons ALTER COLUMN range SET NOT NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'ship_weapons' AND column_name = 'range_dis'
  ) THEN
    ALTER TABLE ship_weapons RENAME COLUMN range_dis TO max_range;
  END IF;
END $$;
ALTER TABLE ship_weapons ADD COLUMN IF NOT EXISTS max_range integer NOT NULL DEFAULT 0;
UPDATE ship_weapons SET max_range = 0 WHERE max_range IS NULL;
ALTER TABLE ship_weapons ALTER COLUMN max_range SET DEFAULT 0;
ALTER TABLE ship_weapons ALTER COLUMN max_range SET NOT NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'ship_weapons' AND column_name = 'fire_cycle_rd'
  ) THEN
    ALTER TABLE ship_weapons RENAME COLUMN fire_cycle_rd TO fire_cycle_step;
    UPDATE ship_weapons
    SET fire_cycle_step = GREATEST(1, fire_cycle_step * 5);
  END IF;
END $$;
ALTER TABLE ship_weapons ADD COLUMN IF NOT EXISTS fire_cycle_step integer NOT NULL DEFAULT 1;
ALTER TABLE ship_weapons ALTER COLUMN fire_cycle_step SET DEFAULT 1;
ALTER TABLE ship_weapons ALTER COLUMN fire_cycle_step SET NOT NULL;

-- ---------------------------------------------------------------------------
-- Access matrix
-- ---------------------------------------------------------------------------
ALTER TABLE admin_role_access_rights ADD COLUMN IF NOT EXISTS can_view_component_editor boolean NOT NULL DEFAULT false;
ALTER TABLE admin_role_access_rights ADD COLUMN IF NOT EXISTS can_use_component_editor boolean NOT NULL DEFAULT false;

UPDATE admin_role_access_rights
SET can_view_component_editor = true, can_use_component_editor = true
WHERE role IN ('admin', 'dm');
UPDATE admin_role_access_rights
SET can_view_component_editor = true, can_use_component_editor = false
WHERE role NOT IN ('admin', 'dm');

CREATE OR REPLACE FUNCTION user_has_access(permission text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM admin_role_access_rights ar
    WHERE ar.role = COALESCE((SELECT role FROM user_profile WHERE id = auth.uid()), 'pending')
      AND CASE permission
        WHEN 'unit_editor'       THEN ar.can_use_unit_editor
        WHEN 'view_unit_editor'  THEN ar.can_view_unit_editor
        WHEN 'ship_editor'       THEN ar.can_use_ship_editor
        WHEN 'view_ship_editor'  THEN ar.can_view_ship_editor
        WHEN 'component_editor'      THEN ar.can_use_component_editor
        WHEN 'view_component_editor' THEN ar.can_view_component_editor
        WHEN 'map_editor'        THEN ar.can_use_map_editor
        WHEN 'view_map_editor'   THEN ar.can_view_map_editor
        WHEN 'effect_editor'     THEN ar.can_use_effect_editor
        WHEN 'view_effect_editor' THEN ar.can_view_effect_editor
        WHEN 'weapon_editor'     THEN ar.can_use_weapon_editor
        WHEN 'view_weapon_editor' THEN ar.can_view_weapon_editor
        WHEN 'structure_editor'  THEN ar.can_use_structure_editor
        WHEN 'view_structure_editor' THEN ar.can_view_structure_editor
        WHEN 'create_scenario'   THEN ar.can_create_scenario
        WHEN 'join_game'         THEN ar.can_join_game
        WHEN 'view_replay'       THEN ar.can_view_replay
        ELSE false
      END
  );
$$;

REVOKE ALL ON FUNCTION user_has_access(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION user_has_access(text) TO authenticated;

-- ---------------------------------------------------------------------------
-- Catalog RLS for the workshop
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION ship_component_read() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT user_has_access('view_component_editor') OR user_has_access('view_ship_editor');
$$;

CREATE OR REPLACE FUNCTION ship_component_write() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT user_has_access('component_editor') OR user_has_access('ship_editor');
$$;

DROP POLICY IF EXISTS ship_catalog_select ON ship_components;
CREATE POLICY ship_catalog_select ON ship_components FOR SELECT TO authenticated USING (ship_component_read());
DROP POLICY IF EXISTS ship_catalog_insert ON ship_components;
CREATE POLICY ship_catalog_insert ON ship_components FOR INSERT TO authenticated WITH CHECK (ship_component_write());
DROP POLICY IF EXISTS ship_catalog_update ON ship_components;
CREATE POLICY ship_catalog_update ON ship_components FOR UPDATE TO authenticated USING (ship_component_write()) WITH CHECK (ship_component_write());
DROP POLICY IF EXISTS ship_catalog_delete ON ship_components;
CREATE POLICY ship_catalog_delete ON ship_components FOR DELETE TO authenticated USING (ship_component_write());

DROP POLICY IF EXISTS ship_catalog_select ON ship_accessories;
CREATE POLICY ship_catalog_select ON ship_accessories FOR SELECT TO authenticated USING (ship_component_read());
DROP POLICY IF EXISTS ship_catalog_insert ON ship_accessories;
CREATE POLICY ship_catalog_insert ON ship_accessories FOR INSERT TO authenticated WITH CHECK (ship_component_write());
DROP POLICY IF EXISTS ship_catalog_update ON ship_accessories;
CREATE POLICY ship_catalog_update ON ship_accessories FOR UPDATE TO authenticated USING (ship_component_write()) WITH CHECK (ship_component_write());
DROP POLICY IF EXISTS ship_catalog_delete ON ship_accessories;
CREATE POLICY ship_catalog_delete ON ship_accessories FOR DELETE TO authenticated USING (ship_component_write());

DROP POLICY IF EXISTS ship_catalog_select ON ship_weapons;
CREATE POLICY ship_catalog_select ON ship_weapons FOR SELECT TO authenticated USING (ship_component_read());
DROP POLICY IF EXISTS ship_catalog_insert ON ship_weapons;
CREATE POLICY ship_catalog_insert ON ship_weapons FOR INSERT TO authenticated WITH CHECK (ship_component_write());
DROP POLICY IF EXISTS ship_catalog_update ON ship_weapons;
CREATE POLICY ship_catalog_update ON ship_weapons FOR UPDATE TO authenticated USING (ship_component_write()) WITH CHECK (ship_component_write());
DROP POLICY IF EXISTS ship_catalog_delete ON ship_weapons;
CREATE POLICY ship_catalog_delete ON ship_weapons FOR DELETE TO authenticated USING (ship_component_write());
