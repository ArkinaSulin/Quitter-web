-- 120: Retire the `ignore_climb` modifier on STRUCTURES (it stays for units + zones).
--
-- Rationale: an edge structure's climb is now the template's per-10-ft `mp_*`
-- (direction/locomotion) over its authored height — a `0` mp_* is the free case,
-- making `ignore_climb` redundant on structures. So every structure template (and
-- placed-instance override) that carried `ignore_climb` gets the modifier stripped
-- and its `mp_*` set to 0 (free), preserving behaviour.
--
-- `ignore_climb` remains a valid UNIT effect and GROUND-ZONE effect (unchanged).

-- 1. Templates: drop `ignore_climb` from modifiers and set every mp_* to 0 (free).
UPDATE map_structure_templates
SET modifiers = (
      SELECT COALESCE(jsonb_agg(e), '[]'::jsonb)
      FROM jsonb_array_elements(COALESCE(modifiers, '[]'::jsonb)) AS e
      WHERE e->>'kind' <> 'ignore_climb'
    ),
    mp_foot_in = 0,
    mp_foot_out = 0,
    mp_mounted_in = 0,
    mp_mounted_out = 0
WHERE EXISTS (
  SELECT 1 FROM jsonb_array_elements(COALESCE(modifiers, '[]'::jsonb)) AS e
  WHERE e->>'kind' = 'ignore_climb'
);

-- 2a. Library boards: strip an instance-level `ignore_climb` (drop the key when the
--     array becomes empty, so the template's modifiers still apply).
UPDATE maps
SET structures = COALESCE((
  SELECT jsonb_object_agg(
    e.key,
    CASE
      WHEN jsonb_typeof(e.value->'modifiers') = 'array'
        AND (e.value->'modifiers') @> '[{"kind":"ignore_climb"}]'::jsonb
        THEN CASE
          WHEN jsonb_array_length((
            SELECT COALESCE(jsonb_agg(m), '[]'::jsonb)
            FROM jsonb_array_elements(e.value->'modifiers') AS m
            WHERE m->>'kind' <> 'ignore_climb'
          )) = 0
            THEN e.value - 'modifiers'
            ELSE jsonb_set(e.value, '{modifiers}', (
              SELECT COALESCE(jsonb_agg(m), '[]'::jsonb)
              FROM jsonb_array_elements(e.value->'modifiers') AS m
              WHERE m->>'kind' <> 'ignore_climb'
            ))
        END
      ELSE e.value
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
        WHEN jsonb_typeof(e.value->'modifiers') = 'array'
          AND (e.value->'modifiers') @> '[{"kind":"ignore_climb"}]'::jsonb
          THEN CASE
            WHEN jsonb_array_length((
              SELECT COALESCE(jsonb_agg(m), '[]'::jsonb)
              FROM jsonb_array_elements(e.value->'modifiers') AS m
              WHERE m->>'kind' <> 'ignore_climb'
            )) = 0
              THEN e.value - 'modifiers'
              ELSE jsonb_set(e.value, '{modifiers}', (
                SELECT COALESCE(jsonb_agg(m), '[]'::jsonb)
                FROM jsonb_array_elements(e.value->'modifiers') AS m
                WHERE m->>'kind' <> 'ignore_climb'
              ))
          END
        ELSE e.value
      END
    )
    FROM jsonb_each(map_data->'structures') AS e(key, value)
  ), '{}'::jsonb),
  true
)
WHERE map_data ? 'structures';
