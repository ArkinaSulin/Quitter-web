-- 032: Move "attacks per round" from a unit trait to a weapon factor.
-- Each weapon now carries its own number_of_attacks (embedded in weapon_string's
-- 12th field) so magic weapons / spells can grant different attack counts.
-- The weapons library gains a number_of_attacks column. Existing weapon strings
-- are rewritten to bake in each unit/template's current number_of_attacks, then
-- the number_of_attacks columns are dropped (full removal).

ALTER TABLE weapons ADD COLUMN IF NOT EXISTS number_of_attacks INTEGER NOT NULL DEFAULT 1;

-- Bake the unit's current per-round attacks into every weapon entry (append the
-- 12th field). Entries that already have 12+ fields are left untouched (rerun-safe).
UPDATE units
SET weapon_string = (
  SELECT string_agg(
    CASE WHEN array_length(string_to_array(entry, ','), 1) >= 12 THEN entry
         ELSE entry || ',' || units.number_of_attacks END,
    ';' ORDER BY ord
  )
  FROM unnest(string_to_array(units.weapon_string, ';')) WITH ORDINALITY AS e(entry, ord)
  WHERE btrim(entry) <> ''
)
WHERE btrim(COALESCE(weapon_string, '')) <> '';

UPDATE unit_templates
SET weapon_string = (
  SELECT string_agg(
    CASE WHEN array_length(string_to_array(entry, ','), 1) >= 12 THEN entry
         ELSE entry || ',' || unit_templates.number_of_attacks END,
    ';' ORDER BY ord
  )
  FROM unnest(string_to_array(unit_templates.weapon_string, ';')) WITH ORDINALITY AS e(entry, ord)
  WHERE btrim(entry) <> ''
)
WHERE btrim(COALESCE(weapon_string, '')) <> '';

-- Full removal: the attack count now lives only on the weapon.
ALTER TABLE units DROP COLUMN IF EXISTS number_of_attacks;
ALTER TABLE unit_templates DROP COLUMN IF EXISTS number_of_attacks;
