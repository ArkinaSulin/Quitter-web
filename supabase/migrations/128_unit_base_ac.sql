-- 128: `units.base_ac` — the UNARMOURED base AC, carried onto every placed unit.
--
-- `unit_templates.base_ac` is the unarmoured base ("from race"; the editor's
-- "Base AC"); `baseline_ac` is base + armour. A war machine (huge bolt/rock)
-- ignores armour, shield and formation and rolls to-hit vs an AC built from the
-- unarmoured base + cover + direct `ac` effects (`unitStats.warMachineAc`), so the
-- spawned unit must carry `base_ac` too. Backfilled from the template where known.
ALTER TABLE units ADD COLUMN IF NOT EXISTS base_ac integer NOT NULL DEFAULT 10;
UPDATE units u SET base_ac = t.base_ac
  FROM unit_templates t
  WHERE u.template_id = t.id AND t.base_ac IS NOT NULL;
