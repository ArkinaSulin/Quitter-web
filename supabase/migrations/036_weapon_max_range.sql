-- 036: Weapon max range.
-- - weapons.max_range column for the library.
-- - Rewrites each weapon_string entry to insert `0` (maxRange = no maximum) right
--   after the range field (index 3), shifting magicRadius 4→5, reach 5→6,
--   noRetaliation 6→7, freeAction 7→8, isTwoHanded 8→9, numberOfAttacks 9→10.
--   Semantics: maxRange 0 = no maximum (attacks beyond range are at disadvantage);
--   maxRange > 0 = hard cap (beyond is out of range).

ALTER TABLE weapons ADD COLUMN IF NOT EXISTS max_range INTEGER NOT NULL DEFAULT 0;

UPDATE units
SET weapon_string = (
  SELECT string_agg(rewritten, ';' ORDER BY ord)
  FROM (
    SELECT (
      SELECT string_agg(x, ',' ORDER BY ord)
      FROM (
        SELECT part AS x, ord FROM unnest(string_to_array(entry, ',')) WITH ORDINALITY AS p(part, ord)
        UNION ALL
        SELECT '0' AS x, 3.5 AS ord
        WHERE array_length(string_to_array(entry, ','), 1) < 11
      ) q
    ) AS rewritten, ord
    FROM unnest(string_to_array(units.weapon_string, ';')) WITH ORDINALITY AS e(entry, ord)
    WHERE btrim(entry) <> ''
  ) w
)
WHERE btrim(COALESCE(weapon_string, '')) <> '';

UPDATE unit_templates
SET weapon_string = (
  SELECT string_agg(rewritten, ';' ORDER BY ord)
  FROM (
    SELECT (
      SELECT string_agg(x, ',' ORDER BY ord)
      FROM (
        SELECT part AS x, ord FROM unnest(string_to_array(entry, ',')) WITH ORDINALITY AS p(part, ord)
        UNION ALL
        SELECT '0' AS x, 3.5 AS ord
        WHERE array_length(string_to_array(entry, ','), 1) < 11
      ) q
    ) AS rewritten, ord
    FROM unnest(string_to_array(unit_templates.weapon_string, ';')) WITH ORDINALITY AS e(entry, ord)
    WHERE btrim(entry) <> ''
  ) w
)
WHERE btrim(COALESCE(weapon_string, '')) <> '';
