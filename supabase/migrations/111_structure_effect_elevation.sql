-- 111: Structure + effect elevation (Phase 2b, data/display only).
--
-- map_structure_templates.elevation: the top surface height in feet where troops
--   stand (a wall is assumed to cover the whole span from the ground up to this
--   surface). 0 = decorative / no height (no badge, no blocking, no climb).
--   Default 10 ft.
-- map_structure_templates.stairs: an EDGE stair that waives the climb cost for
--   both sides (no ownership). Only meaningful for edge-anchored templates.
-- map_effect_templates.elevation: the elevation band an authored effect's
--   artwork/label sits at (0 = ground).
--
-- Placed instances override these per-key in the existing jsonb layers
-- (maps.structures / scenarios.map_data.structures); no column change there.

ALTER TABLE map_structure_templates ADD COLUMN IF NOT EXISTS elevation integer NOT NULL DEFAULT 10;
ALTER TABLE map_structure_templates ADD COLUMN IF NOT EXISTS stairs boolean NOT NULL DEFAULT false;
ALTER TABLE map_effect_templates ADD COLUMN IF NOT EXISTS elevation integer NOT NULL DEFAULT 0;
