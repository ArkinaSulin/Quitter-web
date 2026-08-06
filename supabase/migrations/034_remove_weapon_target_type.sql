-- 034: Remove the weapon "target type" field — it's redundant. An area-effect
-- weapon is exactly one with magicRadius > 0 (area is derived, not stored).
-- Rewrites each weapon_string entry to drop its 3rd comma-field (targetType),
-- shifting damageDice 3→2, range 4→3, magicRadius 5→4, reach 6→5,
-- noRetaliation 7→6, freeAction 8→7, isTwoHanded 9→8, numberOfAttacks 10→9.
-- Also drops the now-unused target_type column from the weapons library.

UPDATE units
SET weapon_string = (
  SELECT string_agg(
    (SELECT string_agg(part, ',' ORDER BY ord)
     FROM unnest(string_to_array(entry, ',')) WITH ORDINALITY AS p(part, ord)
     WHERE ord <> 3),
    ';' ORDER BY ord
  )
  FROM unnest(string_to_array(units.weapon_string, ';')) WITH ORDINALITY AS e(entry, ord)
  WHERE btrim(entry) <> ''
)
WHERE btrim(COALESCE(weapon_string, '')) <> '';

UPDATE unit_templates
SET weapon_string = (
  SELECT string_agg(
    (SELECT string_agg(part, ',' ORDER BY ord)
     FROM unnest(string_to_array(entry, ',')) WITH ORDINALITY AS p(part, ord)
     WHERE ord <> 3),
    ';' ORDER BY ord
  )
  FROM unnest(string_to_array(unit_templates.weapon_string, ';')) WITH ORDINALITY AS e(entry, ord)
  WHERE btrim(entry) <> ''
)
WHERE btrim(COALESCE(weapon_string, '')) <> '';

ALTER TABLE weapons DROP COLUMN IF EXISTS target_type;
