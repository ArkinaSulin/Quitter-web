-- Rename 'Loose' → 'Open Order' and 'Tight' → 'Close Order' in all tables

-- 1. formations lookup table
UPDATE formations SET name = 'Open Order' WHERE name = 'Loose';
UPDATE formations SET name = 'Close Order' WHERE name = 'Tight';

-- 2. unit_templates.formation_availability (text[])
UPDATE unit_templates
SET formation_availability = array_replace(array_replace(formation_availability, 'Loose', 'Open Order'), 'Tight', 'Close Order');

-- 3. units.current_formation
UPDATE units SET current_formation = 'Open Order' WHERE current_formation = 'Loose';
UPDATE units SET current_formation = 'Close Order' WHERE current_formation = 'Tight';

-- 4. Unify units.formation_availability from jsonb → text[] to match unit_templates
CREATE OR REPLACE FUNCTION jsonb_to_text_array(j jsonb)
RETURNS text[] LANGUAGE sql IMMUTABLE AS
$$
  SELECT array_agg(elem) FROM jsonb_array_elements_text(j) AS elem;
$$;

ALTER TABLE units ALTER COLUMN formation_availability TYPE text[]
  USING jsonb_to_text_array(formation_availability);

UPDATE units
SET formation_availability = array_replace(array_replace(formation_availability, 'Loose', 'Open Order'), 'Tight', 'Close Order');

-- 5. Recalculate organization_level using new names
UPDATE units SET organization_level = 1 WHERE current_formation = 'Open Order';
UPDATE units SET organization_level = 2 WHERE current_formation = 'Close Order';
