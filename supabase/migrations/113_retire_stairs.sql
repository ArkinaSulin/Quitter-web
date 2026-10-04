-- 113: Retire the `stairs` boolean in favour of an `ignore_climb` effect modifier.
--
-- `stairs` was an edge-only flag that waived the climb cost (elevation). It is
-- replaced by the general amount-less `ignore_climb` modifier (usable on a unit,
-- an edge structure, or a ground zone). This migration:
--   1. appends {"kind":"ignore_climb"} to any template whose stairs = true;
--   2. sweeps placed instances (library boards + scenario snapshots) the same way
--      and drops their `stairs` key;
--   3. drops the map_structure_templates.stairs column.
--
-- No data is lost: the mechanical effect is preserved via the modifier.

-- 1. Templates: backfill stairs -> ignore_climb modifier.
UPDATE map_structure_templates
SET modifiers = COALESCE(modifiers, '[]'::jsonb) || '[{"kind":"ignore_climb"}]'::jsonb
WHERE stairs = true
  AND NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(COALESCE(modifiers, '[]'::jsonb)) AS e
    WHERE e->>'kind' = 'ignore_climb'
  );

-- 2a. Library boards: instance-level stairs -> modifier, drop the key.
UPDATE maps
SET structures = COALESCE((
  SELECT jsonb_object_agg(
    e.key,
    CASE
      WHEN e.value->>'stairs' = 'true'
        THEN jsonb_set(
          e.value - 'stairs',
          '{modifiers}',
          COALESCE(e.value->'modifiers', '[]'::jsonb) || '[{"kind":"ignore_climb"}]'::jsonb
        )
      ELSE e.value - 'stairs'
    END
  )
  FROM jsonb_each(structures) AS e(key, value)
), '{}'::jsonb)
WHERE structures IS NOT NULL AND structures <> '{}'::jsonb;

-- 2b. Scenario snapshots: same sweep inside map_data.structures.
UPDATE scenarios
SET map_data = jsonb_set(
  map_data,
  '{structures}',
  COALESCE((
    SELECT jsonb_object_agg(
      e.key,
      CASE
        WHEN e.value->>'stairs' = 'true'
          THEN jsonb_set(
            e.value - 'stairs',
            '{modifiers}',
            COALESCE(e.value->'modifiers', '[]'::jsonb) || '[{"kind":"ignore_climb"}]'::jsonb
          )
        ELSE e.value - 'stairs'
      END
    )
    FROM jsonb_each(map_data->'structures') AS e(key, value)
  ), '{}'::jsonb),
  true
)
WHERE map_data ? 'structures';

-- 3. Drop the column.
ALTER TABLE map_structure_templates DROP COLUMN IF EXISTS stairs;
