-- 165: Halloween Siege saved sequences (reusable wave plans).
--
-- A preset stores only the reusable PLAN - turns_per_wave + waves[] - never the
-- runtime markers (enabled, waveStartTurns, nextWaveStartTurn, lastSpawnedTurn,
-- announced*). Loading a preset fills the editor draft; "Save & arm" is still the
-- only action that arms the siege.
--
-- Templates are referenced by id inside `waves` JSONB (no FK), matching the live
-- scenarios.halloween_siege payload; the editor warns about missing templates.
--
-- Shared DM library: admin + dm can read/write (the users who can create and run
-- scenarios). Uses the existing access matrix - no new permission columns.

CREATE TABLE IF NOT EXISTS halloween_siege_presets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  turns_per_wave integer NOT NULL DEFAULT 3,
  waves jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT halloween_siege_presets_name_key UNIQUE (name)
);

ALTER TABLE halloween_siege_presets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS halloween_siege_presets_select ON halloween_siege_presets;
CREATE POLICY halloween_siege_presets_select
  ON halloween_siege_presets FOR SELECT TO authenticated
  USING (user_has_access('create_scenario'));

DROP POLICY IF EXISTS halloween_siege_presets_insert ON halloween_siege_presets;
CREATE POLICY halloween_siege_presets_insert
  ON halloween_siege_presets FOR INSERT TO authenticated
  WITH CHECK (user_has_access('create_scenario'));

DROP POLICY IF EXISTS halloween_siege_presets_update ON halloween_siege_presets;
CREATE POLICY halloween_siege_presets_update
  ON halloween_siege_presets FOR UPDATE TO authenticated
  USING (user_has_access('create_scenario'))
  WITH CHECK (user_has_access('create_scenario'));

DROP POLICY IF EXISTS halloween_siege_presets_delete ON halloween_siege_presets;
CREATE POLICY halloween_siege_presets_delete
  ON halloween_siege_presets FOR DELETE TO authenticated
  USING (user_has_access('create_scenario'));
