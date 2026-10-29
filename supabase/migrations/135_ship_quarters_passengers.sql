-- 135: authored crew quarters + passengers for the mass-first ship model.
-- Crew quarters were previously auto-derived as ceil(crew_count / 5); the new
-- templates author them explicitly (1 ton = 5 crew/passenger capacity).
-- Passengers are display-only for now (default 0).

ALTER TABLE ship_templates ADD COLUMN IF NOT EXISTS crew_quarters integer NOT NULL DEFAULT 0;
ALTER TABLE ship_templates ADD COLUMN IF NOT EXISTS passengers integer NOT NULL DEFAULT 0;

-- Preserve the old auto-computed quarters for existing templates. New/edited
-- ships can set this to 0 (e.g. short-range fighters).
UPDATE ship_templates
SET crew_quarters = CEIL(crew_count / 5.0)::integer
WHERE crew_quarters = 0 AND crew_count > 0;
