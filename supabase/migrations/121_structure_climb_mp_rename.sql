-- 121: rename the structure climb-MP columns; make them NOT NULL DEFAULT 4.
--
-- These four columns are the structure's CLIMB cost in MP per 10 ft (not an entry
-- cost): `_in/_out` are renamed to `up/down` (ascending / descending), for foot and
-- mounted. They default to 4 and are never NULL (a 0 is a free climb). Applies to
-- hex and edge templates alike.

ALTER TABLE map_structure_templates RENAME COLUMN mp_foot_in TO mp_climb_up;
ALTER TABLE map_structure_templates RENAME COLUMN mp_foot_out TO mp_climb_down;
ALTER TABLE map_structure_templates RENAME COLUMN mp_mounted_in TO mp_mounted_up;
ALTER TABLE map_structure_templates RENAME COLUMN mp_mounted_out TO mp_mounted_down;

-- Backfill NULLs to the default before enforcing NOT NULL.
UPDATE map_structure_templates SET mp_climb_up = 4 WHERE mp_climb_up IS NULL;
UPDATE map_structure_templates SET mp_climb_down = 4 WHERE mp_climb_down IS NULL;
UPDATE map_structure_templates SET mp_mounted_up = 4 WHERE mp_mounted_up IS NULL;
UPDATE map_structure_templates SET mp_mounted_down = 4 WHERE mp_mounted_down IS NULL;

ALTER TABLE map_structure_templates
  ALTER COLUMN mp_climb_up SET DEFAULT 4, ALTER COLUMN mp_climb_up SET NOT NULL,
  ALTER COLUMN mp_climb_down SET DEFAULT 4, ALTER COLUMN mp_climb_down SET NOT NULL,
  ALTER COLUMN mp_mounted_up SET DEFAULT 4, ALTER COLUMN mp_mounted_up SET NOT NULL,
  ALTER COLUMN mp_mounted_down SET DEFAULT 4, ALTER COLUMN mp_mounted_down SET NOT NULL;

-- Force a PostgREST schema-cache reload so the renamed columns are visible.
NOTIFY pgrst, 'reload schema';
