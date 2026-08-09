-- 045: is_healing weapon flag + weapon-string shift.
-- is_healing marks a weapon whose damage dice instead RECOVER hit points (heal),
-- capped at the unit's maxUnitHp — same mechanic as damage, opposite direction.
-- 1. weapons library column (Add Weapon modal pre-fills from it).
-- 2. weapon_string entries gain a new field right after the damage dice:
--    name,attackBonus,damageDice,isHealing,range,maxRange,magicRadius,reach,
--    noRetaliation,freeAction,isTwoHanded,numberOfAttacks,onSaveHalfOrNeg,savingThrow
-- Existing entries are shifted by inserting `false` after the 3rd field
-- (idempotent: entries already 14 fields are left untouched).

ALTER TABLE weapons ADD COLUMN IF NOT EXISTS is_healing BOOLEAN NOT NULL DEFAULT false;

UPDATE units
SET weapon_string = (
  SELECT string_agg(rewritten, ';' ORDER BY ord)
  FROM (
    SELECT (
      SELECT string_agg(x, ',' ORDER BY ord2)
      FROM (
        SELECT part AS x, ord2 FROM unnest(string_to_array(entry, ',')) WITH ORDINALITY AS p(part, ord2)
        UNION ALL
        SELECT 'false' AS x, 3.5 AS ord2
        WHERE array_length(string_to_array(entry, ','), 1) < 14
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
      SELECT string_agg(x, ',' ORDER BY ord2)
      FROM (
        SELECT part AS x, ord2 FROM unnest(string_to_array(entry, ',')) WITH ORDINALITY AS p(part, ord2)
        UNION ALL
        SELECT 'false' AS x, 3.5 AS ord2
        WHERE array_length(string_to_array(entry, ','), 1) < 14
      ) q
    ) AS rewritten, ord
    FROM unnest(string_to_array(unit_templates.weapon_string, ';')) WITH ORDINALITY AS e(entry, ord)
    WHERE btrim(entry) <> ''
  ) w
)
WHERE btrim(COALESCE(weapon_string, '')) <> '';
