-- 152: Scenario-level Spelljammer mode + firing-arc toggle + step counter.
--
-- `ship_mode` is DM-only: 'atmosphere' uses atmospheric speed as a normal
-- movement pool (up to, like unit MP); 'wildspace' uses the 5-step speed
-- declaration model. `ship_firing_arcs` is DM-only: when false every ship
-- weapon (except ram) fires 360°. `ship_step` is the current wildspace step
-- (1..5); atmosphere/legacy scenarios stay at 1.

ALTER TABLE scenarios ADD COLUMN IF NOT EXISTS ship_mode text NOT NULL DEFAULT 'wildspace';
ALTER TABLE scenarios ADD COLUMN IF NOT EXISTS ship_firing_arcs boolean NOT NULL DEFAULT true;
ALTER TABLE scenarios ADD COLUMN IF NOT EXISTS ship_step integer NOT NULL DEFAULT 1;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'scenarios_ship_mode_check'
  ) THEN
    ALTER TABLE scenarios
      ADD CONSTRAINT scenarios_ship_mode_check CHECK (ship_mode IN ('atmosphere', 'wildspace'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'scenarios_ship_step_check'
  ) THEN
    ALTER TABLE scenarios
      ADD CONSTRAINT scenarios_ship_step_check CHECK (ship_step BETWEEN 1 AND 5);
  END IF;
END $$;
