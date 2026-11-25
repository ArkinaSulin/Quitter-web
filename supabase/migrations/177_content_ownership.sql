-- 177: Content ownership for the authoring editors.
--
-- Every top-level editable row records `owner_id`. Only the creator (or an
-- admin) may update or delete it; everyone with the matching view capability may
-- still read it. Rows with `owner_id IS NULL` are legacy or seeded/system
-- content and are admin-only. Scenario tokens (units, ships) are NOT covered:
-- ownership limits editor content, not in-game editing.
--
-- Enforcement lives in a row trigger rather than in new policies, so the
-- existing capability policies stay untouched: the trigger forces the creator on
-- insert, refuses ownership transfer, and refuses update/delete by non-owners.
-- Child rows (ship_crews, ship_template_weapons/components) inherit the parent
-- template's ownership.

-- ---------------------------------------------------------------------------
-- 1. Helpers
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION is_admin_user()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM user_profile WHERE id = auth.uid() AND role = 'admin'
  );
$$;
REVOKE ALL ON FUNCTION is_admin_user() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION is_admin_user() TO authenticated;

CREATE OR REPLACE FUNCTION owns_content(p_owner uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT is_admin_user() OR p_owner = auth.uid();
$$;
REVOKE ALL ON FUNCTION owns_content(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION owns_content(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION enforce_content_owner()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- Never trust a client-supplied owner.
    NEW.owner_id := auth.uid();
    RETURN NEW;
  END IF;

  IF NOT owns_content(OLD.owner_id) THEN
    RAISE EXCEPTION 'Only the creator or an admin can change this content'
      USING ERRCODE = '42501';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    -- Ownership never transfers through an edit.
    NEW.owner_id := OLD.owner_id;
    RETURN NEW;
  END IF;

  RETURN OLD;
END $$;
REVOKE ALL ON FUNCTION enforce_content_owner() FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- 2. owner_id on every authoring table
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'unit_templates', 'unit_races', 'unit_mounts', 'unit_weapons', 'unit_armors', 'unit_types',
    'ship_templates', 'ship_components', 'ship_weapons', 'ship_armors', 'ship_cargo',
    'maps', 'map_effect_templates', 'map_structure_templates', 'halloween_siege_presets'
  ] LOOP
    IF to_regclass('public.' || tbl) IS NOT NULL THEN
      EXECUTE format(
        'ALTER TABLE %I ADD COLUMN IF NOT EXISTS owner_id uuid '
        'REFERENCES auth.users(id) ON DELETE SET NULL', tbl);
    END IF;
  END LOOP;
END $$;

-- The tables that already carried an unused `created_by` keep its values.
DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['maps', 'map_effect_templates', 'map_structure_templates', 'halloween_siege_presets'] LOOP
    IF to_regclass('public.' || tbl) IS NULL THEN CONTINUE; END IF;
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = tbl AND column_name = 'created_by'
    ) THEN
      EXECUTE format('UPDATE %I SET owner_id = created_by WHERE owner_id IS NULL AND created_by IS NOT NULL', tbl);
      EXECUTE format('ALTER TABLE %I DROP COLUMN created_by', tbl);
    END IF;
  END LOOP;
END $$;

CREATE INDEX IF NOT EXISTS idx_unit_templates_owner ON unit_templates(owner_id);
CREATE INDEX IF NOT EXISTS idx_ship_templates_owner ON ship_templates(owner_id);
CREATE INDEX IF NOT EXISTS idx_maps_owner ON maps(owner_id);
CREATE INDEX IF NOT EXISTS idx_map_effect_templates_owner ON map_effect_templates(owner_id);
CREATE INDEX IF NOT EXISTS idx_map_structure_templates_owner ON map_structure_templates(owner_id);

-- ---------------------------------------------------------------------------
-- 3. Attach the ownership trigger
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'unit_templates', 'unit_races', 'unit_mounts', 'unit_weapons', 'unit_armors', 'unit_types',
    'ship_templates', 'ship_components', 'ship_weapons', 'ship_armors', 'ship_cargo',
    'maps', 'map_effect_templates', 'map_structure_templates', 'halloween_siege_presets'
  ] LOOP
    IF to_regclass('public.' || tbl) IS NULL THEN CONTINUE; END IF;
    EXECUTE format('DROP TRIGGER IF EXISTS trg_content_owner ON %I', tbl);
    EXECUTE format(
      'CREATE TRIGGER trg_content_owner BEFORE INSERT OR UPDATE OR DELETE ON %I '
      'FOR EACH ROW EXECUTE FUNCTION enforce_content_owner()', tbl);
  END LOOP;
END $$;

-- Seeded/system catalogs stay admin-only: no owner.
DO $$
BEGIN
  IF to_regclass('public.ship_components') IS NOT NULL THEN
    UPDATE ship_components SET owner_id = NULL WHERE built_in = true;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
