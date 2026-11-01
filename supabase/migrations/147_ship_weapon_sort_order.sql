-- 147: Persisted manual order for ship weapon rows.
--
-- The Ship Editor weapon child list is manually ordered with up/down arrows.
-- Store the array index so the order survives a reload.

ALTER TABLE ship_template_weapons
  ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 0;
