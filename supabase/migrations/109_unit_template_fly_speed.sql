-- 109: Unit template fly speed.
--
-- fly_speed on the TEMPLATE (authored) — copied to each spawned unit's fly_speed.
-- > 0 = the unit can fly (derived). The instance `units.fly_speed` was added in
-- migration 108; this is the authored source.
ALTER TABLE unit_templates ADD COLUMN IF NOT EXISTS fly_speed integer NOT NULL DEFAULT 0;
