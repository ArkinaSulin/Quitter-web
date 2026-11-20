-- 166_ship_manifest.sql
-- Cargo manifest on ship templates. Each item is { name, category, mass } with
-- mass in tons (one decimal). The manifest is frozen into a placed ship's
-- snapshot at placement; runtime edits rewrite that snapshot.

ALTER TABLE ship_templates
  ADD COLUMN IF NOT EXISTS manifest jsonb NOT NULL DEFAULT '[]';
