-- 072: night_vision -> darkvision (one word) + backfill existing rows.
-- 071 may already be applied (with race values authored), so the renames are
-- guarded. Values on races are the authored source; templates inherit race,
-- units inherit template with a race fallback (same chain as 071).
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name='races' AND column_name='night_vision')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name='races' AND column_name='darkvision') THEN
    ALTER TABLE races RENAME COLUMN night_vision TO darkvision;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name='unit_templates' AND column_name='night_vision')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name='unit_templates' AND column_name='darkvision') THEN
    ALTER TABLE unit_templates RENAME COLUMN night_vision TO darkvision;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name='units' AND column_name='night_vision')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name='units' AND column_name='darkvision') THEN
    ALTER TABLE units RENAME COLUMN night_vision TO darkvision;
  END IF;
END $$;

-- Templates inherit their race's darkvision; units inherit template (fall back to race).
UPDATE unit_templates ut
SET darkvision = COALESCE((SELECT r.darkvision FROM races r WHERE r.id = ut.race_id), 0)
WHERE ut.race_id IS NOT NULL;

UPDATE units u
SET darkvision = COALESCE(
  (SELECT ut.darkvision FROM unit_templates ut WHERE ut.id = u.template_id),
  (SELECT r.darkvision FROM races r WHERE r.id = u.race_id),
  0
);

NOTIFY pgrst, 'reload schema';
