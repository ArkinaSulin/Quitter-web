-- Add organization_level column to units table
ALTER TABLE units ADD COLUMN organization_level integer DEFAULT 0;

-- Populate from existing formations
UPDATE units SET organization_level = 0 WHERE current_formation IN ('Routed', 'Scattered');
UPDATE units SET organization_level = 1 WHERE current_formation = 'Loose';
UPDATE units SET organization_level = 2 WHERE current_formation = 'Tight';
UPDATE units SET organization_level = 3 WHERE current_formation IN ('Phalanx', 'Shield Wall');
