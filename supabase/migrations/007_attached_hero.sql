-- Add attached_to_unit_id column for hero attachment mechanic
-- Heroes (Small/Medium/Large) can attach to a unit and position at its front

ALTER TABLE units ADD COLUMN attached_to_unit_id TEXT NULL;

-- Index for looking up attached heroes
CREATE INDEX idx_units_attached_to_unit_id ON units(attached_to_unit_id);
