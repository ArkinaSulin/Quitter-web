-- 035: Add the missing `range` column to the weapons library so the Add Weapon
-- screen can pre-fill range when a weapon is picked from the library.
-- Existing rows default to 1 (adjacent/melee); update them as needed.

ALTER TABLE weapons ADD COLUMN IF NOT EXISTS range INTEGER NOT NULL DEFAULT 1;
