-- 153: Ship weapon reload steps + area-effect fields.
--
-- `fire_cycle_step` meant "fires once every N steps". The runtime now uses
-- RELOAD steps: 0 = can fire every step, 4 = load 4 steps then fire on step 5.
-- Backfill: new = greatest(0, old - 1).
--
-- Area-effect fields mirror the weapon/spell AoE contract (`magic_dimension`,
-- `shape`, `saving_throw`, `save_dc`, `on_save_half_or_neg`); 0 dimension =
-- single target.

DO $$
DECLARE
  did_rename boolean := false;
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'ship_weapons' AND column_name = 'fire_cycle_step')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'ship_weapons' AND column_name = 'reload_steps') THEN
    ALTER TABLE ship_weapons RENAME COLUMN fire_cycle_step TO reload_steps;
    did_rename := true;
  END IF;

  IF did_rename THEN
    UPDATE ship_weapons SET reload_steps = GREATEST(0, COALESCE(reload_steps, 1) - 1);
  END IF;
END $$;

ALTER TABLE ship_weapons ADD COLUMN IF NOT EXISTS reload_steps integer NOT NULL DEFAULT 0;
ALTER TABLE ship_weapons ADD COLUMN IF NOT EXISTS magic_dimension integer NOT NULL DEFAULT 0;
ALTER TABLE ship_weapons ADD COLUMN IF NOT EXISTS shape text NOT NULL DEFAULT 'circle';
ALTER TABLE ship_weapons ADD COLUMN IF NOT EXISTS saving_throw text NOT NULL DEFAULT 'Dex';
ALTER TABLE ship_weapons ADD COLUMN IF NOT EXISTS save_dc integer NOT NULL DEFAULT 10;
ALTER TABLE ship_weapons ADD COLUMN IF NOT EXISTS on_save_half_or_neg boolean NOT NULL DEFAULT true;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ship_weapons_reload_steps_check') THEN
    ALTER TABLE ship_weapons ADD CONSTRAINT ship_weapons_reload_steps_check CHECK (reload_steps >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ship_weapons_magic_dimension_check') THEN
    ALTER TABLE ship_weapons ADD CONSTRAINT ship_weapons_magic_dimension_check CHECK (magic_dimension >= 0);
  END IF;
END $$;
