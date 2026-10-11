-- 122: Strip DESTROYED placed structures (one-time legacy cleanup).
--
-- Destruction now removes a structure's instance, but instances destroyed before
-- that change linger at `hp <= 0` and can never be re-targeted, so they rendered
-- forever. Remove any placed structure whose instance HP is <= 0 AND whose
-- referenced template is destructible (`max_hp > 0`) — DECORATIVE structures
-- (`max_hp = 0`) are kept. Cleans both `scenarios.map_data.structures` and
-- `maps.structures`.

CREATE OR REPLACE FUNCTION strip_destroyed_structures(p_structures jsonb)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  out jsonb := '{}'::jsonb;
  k text;
  v jsonb;
  hp int;
  max_hp int;
BEGIN
  IF p_structures IS NULL OR jsonb_typeof(p_structures) <> 'object' THEN
    RETURN COALESCE(p_structures, '{}'::jsonb);
  END IF;
  FOR k, v IN SELECT key, value FROM jsonb_each(p_structures) LOOP
    hp := NULLIF(v->>'hp', '')::int;
    max_hp := NULL;
    IF v ? 'templateId' AND (v->>'templateId') ~ '^[0-9a-fA-F-]{36}$' THEN
      SELECT t.max_hp INTO max_hp FROM map_structure_templates t WHERE t.id = (v->>'templateId')::uuid;
    END IF;
    IF hp IS NOT NULL AND hp <= 0 AND COALESCE(max_hp, 0) > 0 THEN
      CONTINUE; -- destroyed, non-decorative → drop
    END IF;
    out := jsonb_set(out, ARRAY[k], v, true);
  END LOOP;
  RETURN out;
END $$;

UPDATE scenarios
SET map_data = jsonb_set(map_data, '{structures}', strip_destroyed_structures(map_data -> 'structures'), true)
WHERE map_data ? 'structures';

UPDATE maps
SET structures = strip_destroyed_structures(structures)
WHERE structures IS NOT NULL;

DROP FUNCTION strip_destroyed_structures(jsonb);
