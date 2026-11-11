-- 154: Ram component flag + repair-station hull crew.
--
-- A ship may carry at most one ram. The DB already has "Ram - Piercing" and
-- "Ram - Bludgeoning" component rows; flag them with `is_ram` so the runtime can
-- resolve the ram type from the installed component. Hull becomes the repair
-- station with 3 crew slots (1 PC + 2 crew, or 3 crew).

ALTER TABLE ship_components ADD COLUMN IF NOT EXISTS is_ram boolean NOT NULL DEFAULT false;
UPDATE ship_components SET is_ram = true WHERE name ILIKE 'Ram%';
UPDATE ship_components SET crew = 3 WHERE name = 'Hull';
