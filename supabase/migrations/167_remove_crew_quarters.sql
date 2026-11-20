-- 167_remove_crew_quarters.sql
-- Crew sleep wherever there is space (Deck/Cargo); food & water supply is the
-- endurance limiter. Seed each template with ceil(full crew / 10) tons of
-- Food & water, then remove the crew-quarters mechanic/catalog row.

WITH builtins AS (
  SELECT
    COALESCE(MAX(CASE WHEN name = 'Helm' THEN crew END), 1) AS helm_crew,
    COALESCE(MAX(CASE WHEN name = 'Command bridge' THEN crew END), 5) AS bridge_crew
  FROM ship_components
  WHERE built_in
),
optional_crew AS (
  SELECT tc.template_id, SUM(CEIL(c.crew * tc.count)) AS crew
  FROM ship_template_components tc
  JOIN ship_components c ON c.id = tc.component_id
  GROUP BY tc.template_id
),
weapon_crew AS (
  SELECT tw.template_id, SUM(CEIL(w.crew * tw.count)) AS crew
  FROM ship_template_weapons tw
  JOIN ship_weapons w ON w.id = tw.weapon_id
  GROUP BY tw.template_id
),
calc AS (
  SELECT
    t.id,
    (CASE WHEN t.helm > 0 THEN CEIL(b.helm_crew) ELSE 0 END
      + CASE WHEN t.sails > 0 THEN GREATEST(1, FLOOR(t.sails / 4.0)) ELSE 0 END
      + CASE WHEN t.rudders > 0 THEN GREATEST(1, CEIL(t.rudders / 2.0)) ELSE 0 END) AS min_crew,
    (CEIL(t.helm * b.helm_crew)
      + CEIL(t.command_bridge * b.bridge_crew)
      + CASE WHEN t.sails > 0 THEN GREATEST(1, FLOOR(t.sails / 4.0)) ELSE 0 END
      + CASE WHEN t.rudders > 0 THEN GREATEST(1, CEIL(t.rudders / 2.0)) ELSE 0 END
      + COALESCE(o.crew, 0)
      + COALESCE(w.crew, 0)) AS all_slots
  FROM ship_templates t
  CROSS JOIN builtins b
  LEFT JOIN optional_crew o ON o.template_id = t.id
  LEFT JOIN weapon_crew w ON w.template_id = t.id
)
UPDATE ship_templates t
SET manifest = jsonb_build_array(jsonb_build_object(
  'name', 'Food & water',
  'category', 'food_water',
  'mass', CEIL(GREATEST(c.min_crew * 2, c.all_slots) / 10.0)
))
FROM calc c
WHERE c.id = t.id
  AND (t.manifest IS NULL OR t.manifest = '[]'::jsonb);

DELETE FROM ship_template_components
WHERE component_id IN (
  SELECT id FROM ship_components WHERE name = 'Crew quarters' AND built_in
);

DELETE FROM ship_components
WHERE name = 'Crew quarters' AND built_in;

ALTER TABLE ship_templates
  DROP COLUMN IF EXISTS crew_quarters;
