-- 096: Structure "spikes" decoration + rename Archer Spikes -> Archer's Stake.
--
-- Adds a per-template `spikes` flag: edge structures render small outward-facing
-- triangles (stakes) instead of a wall segment/crenellation. The seeded
-- "Archer Spikes" becomes "Archer's Stake" with spikes enabled.

ALTER TABLE map_structure_templates ADD COLUMN IF NOT EXISTS spikes boolean NOT NULL DEFAULT false;

UPDATE map_structure_templates SET name = 'Archer''s Stake' WHERE name = 'Archer Spikes';
UPDATE map_structure_templates SET spikes = true WHERE name = 'Archer''s Stake';
