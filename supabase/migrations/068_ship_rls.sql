-- 068: RLS for the ship template tables (mirrors the 050 unit_templates pattern).
-- Shipyard: everyone with view_ship_editor may browse the ship library; only
-- ship_editor (admin) may insert/update/delete templates and their join rows.

ALTER TABLE ship_frames ENABLE ROW LEVEL SECURITY;
ALTER TABLE ship_armors ENABLE ROW LEVEL SECURITY;
ALTER TABLE ship_components ENABLE ROW LEVEL SECURITY;
ALTER TABLE ship_accessories ENABLE ROW LEVEL SECURITY;
ALTER TABLE ship_weapons ENABLE ROW LEVEL SECURITY;
ALTER TABLE ship_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE ship_template_accessories ENABLE ROW LEVEL SECURITY;
ALTER TABLE ship_template_weapons ENABLE ROW LEVEL SECURITY;

-- Read: anyone with the shipyard view capability (admin). Write: ship_editor only.

CREATE OR REPLACE FUNCTION shipyard_read() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT user_has_access('view_ship_editor');
$$;

CREATE OR REPLACE FUNCTION shipyard_write() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT user_has_access('ship_editor');
$$;

DROP POLICY IF EXISTS ship_catalog_select ON ship_frames;
CREATE POLICY ship_catalog_select ON ship_frames FOR SELECT TO authenticated USING (shipyard_read());
DROP POLICY IF EXISTS ship_catalog_select ON ship_armors;
CREATE POLICY ship_catalog_select ON ship_armors FOR SELECT TO authenticated USING (shipyard_read());
DROP POLICY IF EXISTS ship_catalog_select ON ship_components;
CREATE POLICY ship_catalog_select ON ship_components FOR SELECT TO authenticated USING (shipyard_read());
DROP POLICY IF EXISTS ship_catalog_select ON ship_accessories;
CREATE POLICY ship_catalog_select ON ship_accessories FOR SELECT TO authenticated USING (shipyard_read());
DROP POLICY IF EXISTS ship_catalog_select ON ship_weapons;
CREATE POLICY ship_catalog_select ON ship_weapons FOR SELECT TO authenticated USING (shipyard_read());

DROP POLICY IF EXISTS ship_templates_select ON ship_templates;
CREATE POLICY ship_templates_select ON ship_templates FOR SELECT TO authenticated USING (shipyard_read());
DROP POLICY IF EXISTS ship_templates_insert ON ship_templates FOR INSERT TO authenticated WITH CHECK (shipyard_write());
DROP POLICY IF EXISTS ship_templates_update ON ship_templates FOR UPDATE TO authenticated USING (shipyard_write());
DROP POLICY IF EXISTS ship_templates_delete ON ship_templates FOR DELETE TO authenticated USING (shipyard_write());

DROP POLICY IF EXISTS ship_template_accessories_select ON ship_template_accessories;
CREATE POLICY ship_template_accessories_select ON ship_template_accessories FOR SELECT TO authenticated USING (shipyard_read());
DROP POLICY IF EXISTS ship_template_accessories_insert ON ship_template_accessories FOR INSERT TO authenticated WITH CHECK (shipyard_write());
DROP POLICY IF EXISTS ship_template_accessories_update ON ship_template_accessories FOR UPDATE TO authenticated USING (shipyard_write());
DROP POLICY IF EXISTS ship_template_accessories_delete ON ship_template_accessories FOR DELETE TO authenticated USING (shipyard_write());

DROP POLICY IF EXISTS ship_template_weapons_select ON ship_template_weapons;
CREATE POLICY ship_template_weapons_select ON ship_template_weapons FOR SELECT TO authenticated USING (shipyard_read());
DROP POLICY IF EXISTS ship_template_weapons_insert ON ship_template_weapons FOR INSERT TO authenticated WITH CHECK (shipyard_write());
DROP POLICY IF EXISTS ship_template_weapons_update ON ship_template_weapons FOR UPDATE TO authenticated USING (shipyard_write());
DROP POLICY IF EXISTS ship_template_weapons_delete ON ship_template_weapons FOR DELETE TO authenticated USING (shipyard_write());
