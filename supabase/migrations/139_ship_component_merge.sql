-- 139: Merge ship accessories into ship components.
--
-- Accessories and components now have identical columns, so accessories are
-- just optional components. Move every ship_accessories row into
-- ship_components (same UUID id so joins stay valid), mark the built-in rows,
-- rename the template join table, and drop ship_accessories.
--
-- Depends on 135-138.

ALTER TABLE ship_components ADD COLUMN IF NOT EXISTS built_in boolean NOT NULL DEFAULT false;

UPDATE ship_components
SET built_in = true
WHERE name IN (
  'hull', 'helm', 'command_bridge', 'sail', 'rudder',
  'reinforcement', 'cargo', 'crew_quarters', 'weapon_capacity'
);

-- Preserve the UUID ids: the join-table rows already reference them.
INSERT INTO ship_components (id, name, mass, crew, cost, hittable, effect, image_url, ac, built_in)
SELECT id, name, mass, crew, cost, hittable, effect, image_url, ac, false
FROM ship_accessories;

-- Rename the template join table and repoint its FK to ship_components.
ALTER TABLE ship_template_accessories
  DROP CONSTRAINT IF EXISTS ship_template_accessories_accessory_id_fkey;
ALTER TABLE ship_template_accessories
  DROP CONSTRAINT IF EXISTS ship_template_accessories_pkey;

ALTER TABLE ship_template_accessories RENAME TO ship_template_components;
ALTER TABLE ship_template_components RENAME COLUMN accessory_id TO component_id;
ALTER TABLE ship_template_components
  ADD PRIMARY KEY (template_id, component_id);
ALTER TABLE ship_template_components
  ADD CONSTRAINT ship_template_components_component_id_fkey
  FOREIGN KEY (component_id) REFERENCES ship_components(id);

DROP TABLE ship_accessories;
