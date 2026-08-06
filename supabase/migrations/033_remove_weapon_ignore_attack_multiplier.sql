-- 033: Remove the weapon "ignore attack multiplier" flag (no longer needed —
-- per-weapon numberOfAttacks supersedes it). Rewrites each weapon_string entry to
-- drop its 10th comma-field (the ignoreAttackMultiplier flag), shifting
-- isTwoHanded from index 10 → 9 and numberOfAttacks from 11 → 10.

UPDATE units
SET weapon_string = (
  SELECT string_agg(
    (SELECT string_agg(part, ',' ORDER BY ord)
     FROM unnest(string_to_array(entry, ',')) WITH ORDINALITY AS p(part, ord)
     WHERE ord <> 10),
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
     WHERE ord <> 10),
    ';' ORDER BY ord
  )
  FROM unnest(string_to_array(unit_templates.weapon_string, ';')) WITH ORDINALITY AS e(entry, ord)
  WHERE btrim(entry) <> ''
)
WHERE btrim(COALESCE(weapon_string, '')) <> '';
