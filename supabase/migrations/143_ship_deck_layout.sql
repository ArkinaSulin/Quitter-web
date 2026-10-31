-- 143: Region-container deck layout + stable weapon rows.
--
-- The fixed 3x9 cell layout is replaced by five region containers
-- (bow/port/body/starboard/stern). Slots carry the card key and can be moved
-- between regions; the Ram slot is a fixed Bow slot. Weapon rows get a stable
-- UUID so cards survive weapon changes and no longer need a mount-slot column.

ALTER TABLE ship_templates ADD COLUMN IF NOT EXISTS deck_layout jsonb NOT NULL DEFAULT '{}';
ALTER TABLE ship_templates DROP COLUMN IF EXISTS card_placements;

ALTER TABLE ship_template_weapons ADD COLUMN IF NOT EXISTS id uuid NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE ship_template_weapons DROP CONSTRAINT IF EXISTS ship_template_weapons_pkey;
ALTER TABLE ship_template_weapons ADD PRIMARY KEY (template_id, id);
ALTER TABLE ship_template_weapons DROP COLUMN IF EXISTS mount_slot;
