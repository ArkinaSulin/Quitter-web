-- 137: Ship catalog UUID + name refactor.
--
-- Ship catalogs currently use text ids as their primary key (helm, sail, wood,
-- ballista_light...). Align them with the unit_* catalogs: keep the old id as a
-- unique `name`, add a UUID `id` primary key, and migrate the template/join FKs.
--
-- Ship templates keep their text ids for now; the engine pass can migrate them.

-- ---------------------------------------------------------------------------
-- ship_components (no FK references)
-- ---------------------------------------------------------------------------
ALTER TABLE ship_components RENAME COLUMN id TO name;
ALTER TABLE ship_components DROP CONSTRAINT IF EXISTS ship_components_pkey;
ALTER TABLE ship_components ADD COLUMN id uuid NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE ship_components ADD PRIMARY KEY (id);
ALTER TABLE ship_components ADD CONSTRAINT ship_components_name_key UNIQUE (name);

-- ---------------------------------------------------------------------------
-- ship_armors (referenced by ship_templates.armor_id)
-- ---------------------------------------------------------------------------
ALTER TABLE ship_templates DROP CONSTRAINT IF EXISTS ship_templates_armor_id_fkey;

ALTER TABLE ship_armors RENAME COLUMN id TO name;
ALTER TABLE ship_armors DROP CONSTRAINT IF EXISTS ship_armors_pkey;
ALTER TABLE ship_armors ADD COLUMN id uuid NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE ship_armors ADD PRIMARY KEY (id);
ALTER TABLE ship_armors ADD CONSTRAINT ship_armors_name_key UNIQUE (name);

ALTER TABLE ship_templates ADD COLUMN IF NOT EXISTS armor_uuid uuid;
UPDATE ship_templates st
SET armor_uuid = a.id
FROM ship_armors a
WHERE a.name = st.armor_id;
UPDATE ship_templates
SET armor_uuid = (SELECT id FROM ship_armors WHERE name = 'wood' LIMIT 1)
WHERE armor_uuid IS NULL;
ALTER TABLE ship_templates ALTER COLUMN armor_uuid SET NOT NULL;
ALTER TABLE ship_templates DROP COLUMN armor_id;
ALTER TABLE ship_templates RENAME COLUMN armor_uuid TO armor_id;
ALTER TABLE ship_templates
  ADD CONSTRAINT ship_templates_armor_id_fkey
  FOREIGN KEY (armor_id) REFERENCES ship_armors(id);

-- ---------------------------------------------------------------------------
-- ship_accessories (referenced by ship_template_accessories.accessory_id)
-- ---------------------------------------------------------------------------
ALTER TABLE ship_template_accessories
  DROP CONSTRAINT IF EXISTS ship_template_accessories_accessory_id_fkey;
ALTER TABLE ship_template_accessories
  DROP CONSTRAINT IF EXISTS ship_template_accessories_pkey;

ALTER TABLE ship_accessories RENAME COLUMN id TO name;
ALTER TABLE ship_accessories DROP CONSTRAINT IF EXISTS ship_accessories_pkey;
ALTER TABLE ship_accessories ADD COLUMN id uuid NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE ship_accessories ADD PRIMARY KEY (id);
ALTER TABLE ship_accessories ADD CONSTRAINT ship_accessories_name_key UNIQUE (name);

ALTER TABLE ship_template_accessories ADD COLUMN IF NOT EXISTS accessory_uuid uuid;
UPDATE ship_template_accessories ta
SET accessory_uuid = a.id
FROM ship_accessories a
WHERE a.name = ta.accessory_id;
DELETE FROM ship_template_accessories WHERE accessory_uuid IS NULL;
ALTER TABLE ship_template_accessories ALTER COLUMN accessory_uuid SET NOT NULL;
ALTER TABLE ship_template_accessories DROP COLUMN accessory_id;
ALTER TABLE ship_template_accessories RENAME COLUMN accessory_uuid TO accessory_id;
ALTER TABLE ship_template_accessories
  ADD PRIMARY KEY (template_id, accessory_id);
ALTER TABLE ship_template_accessories
  ADD CONSTRAINT ship_template_accessories_accessory_id_fkey
  FOREIGN KEY (accessory_id) REFERENCES ship_accessories(id);

-- ---------------------------------------------------------------------------
-- ship_weapons (referenced by ship_template_weapons.weapon_id)
-- ---------------------------------------------------------------------------
ALTER TABLE ship_template_weapons
  DROP CONSTRAINT IF EXISTS ship_template_weapons_weapon_id_fkey;
ALTER TABLE ship_template_weapons
  DROP CONSTRAINT IF EXISTS ship_template_weapons_pkey;

ALTER TABLE ship_weapons RENAME COLUMN id TO name;
ALTER TABLE ship_weapons DROP CONSTRAINT IF EXISTS ship_weapons_pkey;
ALTER TABLE ship_weapons ADD COLUMN id uuid NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE ship_weapons ADD PRIMARY KEY (id);
ALTER TABLE ship_weapons ADD CONSTRAINT ship_weapons_name_key UNIQUE (name);

ALTER TABLE ship_template_weapons ADD COLUMN IF NOT EXISTS weapon_uuid uuid;
UPDATE ship_template_weapons tw
SET weapon_uuid = w.id
FROM ship_weapons w
WHERE w.name = tw.weapon_id;
DELETE FROM ship_template_weapons WHERE weapon_uuid IS NULL;
ALTER TABLE ship_template_weapons ALTER COLUMN weapon_uuid SET NOT NULL;
ALTER TABLE ship_template_weapons DROP COLUMN weapon_id;
ALTER TABLE ship_template_weapons RENAME COLUMN weapon_uuid TO weapon_id;
ALTER TABLE ship_template_weapons
  ADD PRIMARY KEY (template_id, weapon_id, mount_slot);
ALTER TABLE ship_template_weapons
  ADD CONSTRAINT ship_template_weapons_weapon_id_fkey
  FOREIGN KEY (weapon_id) REFERENCES ship_weapons(id);
