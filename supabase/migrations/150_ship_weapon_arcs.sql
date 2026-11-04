-- 150: Per-weapon-card firing-arc overrides.
--
-- Map keyed by the weapon card key (weapon:<rowId>:<unitIndex>), storing only
-- added/removed arcs. Non-Body frames protect their default arc; Body starts 360.

ALTER TABLE ship_templates
  ADD COLUMN IF NOT EXISTS weapon_arcs jsonb NOT NULL DEFAULT '{}';
