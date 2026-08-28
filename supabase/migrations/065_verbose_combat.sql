-- 065: GM per-scenario toggle for verbose combat descriptions.
-- Default OFF. When on, attack/spell descriptions print every dice roll (sorted).
ALTER TABLE scenarios ADD COLUMN IF NOT EXISTS verbose_combat BOOLEAN NOT NULL DEFAULT false;
