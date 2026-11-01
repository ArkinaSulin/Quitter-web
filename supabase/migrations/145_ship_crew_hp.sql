-- 145: Ship crew HP + authored weekly cost defaults.
--
-- Crew HP is authored (default 10 + 7 per level above 1). Weekly cost is
-- authored (default level² × 2 + 2). New crew default stats are
-- 12-14-14-10-14-10. Existing null costs are filled before making cost required.

ALTER TABLE ship_crews ADD COLUMN IF NOT EXISTS hp integer NOT NULL DEFAULT 10;

ALTER TABLE ship_crews ALTER COLUMN str SET DEFAULT 12;
ALTER TABLE ship_crews ALTER COLUMN dex SET DEFAULT 14;
ALTER TABLE ship_crews ALTER COLUMN con SET DEFAULT 14;
ALTER TABLE ship_crews ALTER COLUMN int SET DEFAULT 10;
ALTER TABLE ship_crews ALTER COLUMN wis SET DEFAULT 14;
ALTER TABLE ship_crews ALTER COLUMN cha SET DEFAULT 10;

ALTER TABLE ship_crews ALTER COLUMN cost SET DEFAULT 4;
UPDATE ship_crews SET cost = 4 WHERE cost IS NULL;
ALTER TABLE ship_crews ALTER COLUMN cost SET NOT NULL;
