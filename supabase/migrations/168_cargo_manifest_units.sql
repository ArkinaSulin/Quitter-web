-- 168_cargo_manifest_units.sql
-- Convert cargo manifest lines from the old { name, category, mass } shape to
-- { name, category, quantity } using each category's unit:
--   Food & water: person-days (200 per ton)
--   Ship repair kit: kits (0.1 ton each)
--   Ammunition / General cargo / Mission cargo: tons
-- Applies to template rows and to placed-ship snapshot manifests.

CREATE OR REPLACE FUNCTION quitter_cargo_manifest_168(arr jsonb)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT COALESCE(jsonb_agg(
    CASE
      WHEN item ? 'quantity' THEN item
      ELSE jsonb_build_object(
        'name', COALESCE(NULLIF(item->>'name', ''), 'Cargo'),
        'category', COALESCE(item->>'category', 'general_cargo'),
        'quantity',
          CASE COALESCE(item->>'category', 'general_cargo')
            WHEN 'food_water' THEN round(COALESCE((item->>'mass')::numeric, 0) * 200)
            WHEN 'ship_repair_kit' THEN round(COALESCE((item->>'mass')::numeric, 0) / 0.1)
            ELSE round(COALESCE((item->>'mass')::numeric, 0), 1)
          END
      )
    END
  ), '[]'::jsonb)
  FROM jsonb_array_elements(COALESCE(arr, '[]'::jsonb)) item;
$$;

UPDATE ship_templates
SET manifest = quitter_cargo_manifest_168(manifest)
WHERE manifest IS NOT NULL
  AND manifest <> '[]'::jsonb;

UPDATE ship_spelljammer s
SET snapshot = jsonb_set(
  jsonb_set(
    s.snapshot,
    '{template,manifest}',
    quitter_cargo_manifest_168(s.snapshot->'template'->'manifest'),
    true
  ),
  '{build,manifest}',
  quitter_cargo_manifest_168(s.snapshot->'build'->'manifest'),
  true
)
WHERE s.snapshot IS NOT NULL
  AND (s.snapshot->'template'->'manifest' IS NOT NULL
    OR s.snapshot->'build'->'manifest' IS NOT NULL);

DROP FUNCTION quitter_cargo_manifest_168(jsonb);
