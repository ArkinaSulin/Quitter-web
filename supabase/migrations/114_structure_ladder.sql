-- 114: Edge structure `ladder` decoration.
--
-- The trapezoid-ladder graphic used to be tied to the `stairs` boolean (retired
-- in migration 113, replaced mechanically by the `ignore_climb` effect modifier).
-- `ladder` is now a standalone VISUAL flag (like battlement/barricade/sin_wave):
-- it draws the trapezoid ladder on an edge without granting any mechanic.
--
-- Backfill: any template whose modifiers already carry `ignore_climb` (the old
-- stairs, migrated in 113) keeps its graphic by setting `ladder = true`.
--
-- Placed instances may override per-key in the existing jsonb layers
-- (maps.structures / scenarios.map_data.structures); no column change there.

ALTER TABLE map_structure_templates ADD COLUMN IF NOT EXISTS ladder boolean NOT NULL DEFAULT false;

UPDATE map_structure_templates
SET ladder = true
WHERE NOT ladder
  AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(COALESCE(modifiers, '[]'::jsonb)) AS e
    WHERE e->>'kind' = 'ignore_climb'
  );
