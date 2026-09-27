-- 102: Edge decorations — rename `spikes` → `barricade` and add `sin_wave`.
--
-- The "archer's spikes" decoration becomes a more generic **barricade**: a line
-- of X marks sitting ON the edge (it affects both in and out, so it no longer
-- extrudes toward one side). A new **sin wave** edge (magical) oscillates around
-- the edge, likewise centered. Both draw no thick base segment — just the marks.
-- The battlement keeps its outside-face crenellation and base line.

ALTER TABLE map_structure_templates RENAME COLUMN spikes TO barricade;
ALTER TABLE map_structure_templates ADD COLUMN IF NOT EXISTS sin_wave boolean NOT NULL DEFAULT false;

-- The seeded stake is now a barricade.
UPDATE map_structure_templates SET name = 'Barricade' WHERE name = 'Archer''s Stake';
