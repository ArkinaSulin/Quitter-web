-- 180: Ship weapon maximum crew targets.
--
-- A penetrating ship-weapon hit can wound up to `max_targets` living crew on
-- the struck card. The number is rolled 1..max_targets (1d1, 1d3, ...), so a
-- Ballista (1) always hits one crew while a Mangonel (3) can catch one to three.
-- The roll is independent of the number of component tons destroyed.

ALTER TABLE ship_weapons
  ADD COLUMN IF NOT EXISTS max_targets integer NOT NULL DEFAULT 1;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ship_weapons_max_targets_check'
  ) THEN
    ALTER TABLE ship_weapons
      ADD CONSTRAINT ship_weapons_max_targets_check CHECK (max_targets >= 1);
  END IF;
END $$;

-- Catalog rows are authored by users, but the named siege weapons carry their
-- known ceiling. New rows default to 1.
UPDATE ship_weapons
SET max_targets = 3
WHERE lower(name) LIKE '%mangonel%';

NOTIFY pgrst, 'reload schema';
