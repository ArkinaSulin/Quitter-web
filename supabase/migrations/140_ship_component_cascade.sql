-- 140: Cascade catalog deletion + usage lookups for the Component Workshop.
--
-- Deleting an optional component/weapon that is selected on a ship template
-- previously failed with an FK violation. The templates should lose the
-- deleted selection; the catalog row is the source of truth.

ALTER TABLE ship_template_components
  DROP CONSTRAINT IF EXISTS ship_template_components_component_id_fkey;
ALTER TABLE ship_template_components
  ADD CONSTRAINT ship_template_components_component_id_fkey
  FOREIGN KEY (component_id) REFERENCES ship_components(id) ON DELETE CASCADE;

ALTER TABLE ship_template_weapons
  DROP CONSTRAINT IF EXISTS ship_template_weapons_weapon_id_fkey;
ALTER TABLE ship_template_weapons
  ADD CONSTRAINT ship_template_weapons_weapon_id_fkey
  FOREIGN KEY (weapon_id) REFERENCES ship_weapons(id) ON DELETE CASCADE;

-- Usage lookups for the delete confirmation. SECURITY DEFINER so component
-- editors (not only ship editors) can see which templates reference a row.
CREATE OR REPLACE FUNCTION ship_component_usage(p_id uuid)
RETURNS TABLE(template_id text, template_name text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT st.id, st.name
  FROM ship_template_components stc
  JOIN ship_templates st ON st.id = stc.template_id
  WHERE stc.component_id = p_id
    AND (user_has_access('view_component_editor') OR user_has_access('view_ship_editor'))
  ORDER BY st.name;
$$;

CREATE OR REPLACE FUNCTION ship_weapon_usage(p_id uuid)
RETURNS TABLE(template_id text, template_name text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT st.id, st.name
  FROM ship_template_weapons stw
  JOIN ship_templates st ON st.id = stw.template_id
  WHERE stw.weapon_id = p_id
    AND (user_has_access('view_component_editor') OR user_has_access('view_ship_editor'))
  ORDER BY st.name;
$$;

REVOKE ALL ON FUNCTION ship_component_usage(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION ship_weapon_usage(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ship_component_usage(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION ship_weapon_usage(uuid) TO authenticated;
