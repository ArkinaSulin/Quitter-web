-- 130: AI assist flags.
--
-- ai_assist_enabled (076) remains the master switch that reveals the AI tab.
-- ai_assist_advanced picks the planner's tuned brain (retaliation-aware melee,
-- finish/overkill value, light target reservation) instead of the green-friendly
-- greedy default.
-- ai_assist_players lets non-GM participants use the AI tab in this scenario
-- (the GM still owns the settings; server-side execute_command already permits
-- participant MOVE/ATTACK/ROTATE/FORMATION commands).

ALTER TABLE scenarios
  ADD COLUMN IF NOT EXISTS ai_assist_advanced BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS ai_assist_players  BOOLEAN NOT NULL DEFAULT false;
