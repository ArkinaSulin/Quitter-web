-- 103: Unit-template effects — design-time inherited effects.
--
-- A unit template can carry a list of effect modifiers (`effects` jsonb). When a
-- unit is spawned from the template, each modifier is expanded into a PERMANENT
-- UnitEffect on the spawned unit (an innate ability — never ticks or expires).

ALTER TABLE unit_templates ADD COLUMN IF NOT EXISTS effects jsonb NOT NULL DEFAULT '[]'::jsonb;
