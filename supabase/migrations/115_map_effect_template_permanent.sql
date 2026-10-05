-- 115: map_effect_templates.permanent — the EffectTemplate `permanent` flag.
--
-- A template flagged `permanent` produces unit effects / ground zones that never
-- tick or expire once applied (innate / board-feature effects). The flag was
-- introduced in code (EffectTemplate.permanent; mapEffectRow / mapEffectToRow)
-- without a migration, so the column was absent from the schema history — this
-- backfills it. Already applied to the live DB.
--
-- No `apply_substeps` allowlist change is needed: this is a template-library
-- column, not a unit field.

ALTER TABLE map_effect_templates
  ADD COLUMN IF NOT EXISTS permanent boolean NOT NULL DEFAULT false;
