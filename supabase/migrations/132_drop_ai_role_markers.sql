-- 132: retire the scenario-level AI role-marker flag.
--
-- Role markers are now an Advanced-AI-only, per-player "This device" option.
-- The old GM scenario flag (131) is no longer used. Safe whether or not 131 was
-- applied.

ALTER TABLE scenarios
  DROP COLUMN IF EXISTS ai_role_markers;
