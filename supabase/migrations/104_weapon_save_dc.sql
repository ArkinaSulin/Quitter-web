-- 104: Weapon save DC.
-- Area-effect weapons (magic_dimension > 0) gain a fixed save DC, authored on the
-- weapon at creation time (Weapon Editor / Add-Weapon modal / Weapon Editor modal)
-- instead of being asked every cast. Defaults to 10, matching the prior hardcoded
-- value so existing spells resolve identically.
ALTER TABLE unit_weapons ADD COLUMN IF NOT EXISTS save_dc integer NOT NULL DEFAULT 10;
