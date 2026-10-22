-- 131: persistent AI role markers.
--
-- ai_role_markers is a scenario display flag: when true, the map overlays the
-- current AI battle role on AI-controlled tokens (M frontline melee, A
-- high-damage frontline/shock, C flanker, S skirmisher/ranged, R reserve,
-- G structure/garrison). It is display-only; the planner behaviour is unchanged.
-- The DM/effective GM sees all roles; players see only units in their own team.

ALTER TABLE scenarios
  ADD COLUMN IF NOT EXISTS ai_role_markers BOOLEAN NOT NULL DEFAULT false;
