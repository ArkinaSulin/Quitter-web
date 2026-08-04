-- 022: Two-handed weapons & active weapon selection
-- is_two_handed: two-handed weapons occupy both hands, so a shield cannot be
--                used while one is active (dropping 2 AC) and Shield Wall is
--                forbidden.
-- active_weapon_index: which weapon in the unit's weapon string is currently
--                      active (defaults to 0 / the first weapon).
ALTER TABLE weapons ADD COLUMN IF NOT EXISTS is_two_handed BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE units ADD COLUMN IF NOT EXISTS active_weapon_index INT NOT NULL DEFAULT 0;
