-- 071: Fog of war + night vision.
-- Per-unit sight is authored on the RACE (night_vision in hex), inherited by the
-- unit template at creation and by the scenario unit at spawn — the value is kept
-- at all three levels so no information is lost. Effective sight of a unit =
-- max(scenario sight_radius, night_vision) — own hex is not counted.
-- Scenario-level fog: fog_of_war (off by default) + sight_radius (base, default 2).

ALTER TABLE races ADD COLUMN IF NOT EXISTS night_vision integer NOT NULL DEFAULT 0;
ALTER TABLE unit_templates ADD COLUMN IF NOT EXISTS night_vision integer NOT NULL DEFAULT 0;
ALTER TABLE units ADD COLUMN IF NOT EXISTS night_vision integer NOT NULL DEFAULT 0;

ALTER TABLE scenarios ADD COLUMN IF NOT EXISTS fog_of_war boolean NOT NULL DEFAULT false;
ALTER TABLE scenarios ADD COLUMN IF NOT EXISTS sight_radius integer NOT NULL DEFAULT 2;

-- Backfill existing rows so their sight is never lost: templates inherit from
-- their race; units inherit from their template (fall back to their race).
UPDATE unit_templates ut
SET night_vision = COALESCE((SELECT r.night_vision FROM races r WHERE r.id = ut.race_id), 0)
WHERE ut.race_id IS NOT NULL;

UPDATE units u
SET night_vision = COALESCE(
  (SELECT ut.night_vision FROM unit_templates ut WHERE ut.id = u.template_id),
  (SELECT r.night_vision FROM races r WHERE r.id = u.race_id),
  0
);
