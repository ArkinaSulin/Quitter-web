-- 029: Player management foundations.
-- - scenario_participants.team: the team a player controls (NULL = unassigned, read-only).
-- - scenarios.room_open: when false, no new players may join the room.
-- - scenario_participants joins the realtime publication (live roster + kicked-client ejection).
-- - Defensive RLS: SELECT own-or-GM, INSERT open-room-gated, UPDATE/DELETE GM-only.

ALTER TABLE scenario_participants ADD COLUMN IF NOT EXISTS team TEXT;
ALTER TABLE scenario_participants
  ADD CONSTRAINT scenario_participants_team_check
  CHECK (team IS NULL OR team IN ('blue', 'yellow', 'violet', 'black', 'orange', 'green'));

ALTER TABLE scenarios ADD COLUMN IF NOT EXISTS room_open BOOLEAN NOT NULL DEFAULT true;

-- Guarantee one row per (scenario, user). Dedupe first (keep the earliest row, by
-- joined_at then id) so the constraint cannot fail on any pre-existing duplicates.
DELETE FROM scenario_participants a
WHERE EXISTS (
  SELECT 1 FROM (
    SELECT id, ROW_NUMBER() OVER (
      PARTITION BY scenario_id, user_id
      ORDER BY joined_at NULLS LAST, id
    ) AS rn
    FROM scenario_participants
  ) ranked
  WHERE ranked.id = a.id AND ranked.rn > 1
);

ALTER TABLE scenario_participants
  ADD CONSTRAINT scenario_participants_scenario_user_unique
  UNIQUE (scenario_id, user_id);

-- Clients subscribe to participant changes for the live roster and to detect a kick.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'scenario_participants'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.scenario_participants;
    END IF;
  END IF;
END $$;

-- ---- RLS ----
ALTER TABLE scenario_participants ENABLE ROW LEVEL SECURITY;

-- SELECT: the join flow counts existing participants before inserting (to decide
-- GM-vs-Player), and Lobby scenarios are already public metadata, so participant
-- roster rows are selectable by any authenticated user. Kick detection filters
-- client-side on user_id.
DROP POLICY IF EXISTS participant_select ON scenario_participants;
CREATE POLICY "participant_select" ON scenario_participants
  FOR SELECT TO authenticated
  USING (true);

-- INSERT: replaces 025's insert_approved_role, adding the room-open gate.
DROP POLICY IF EXISTS insert_approved_role ON scenario_participants;
CREATE POLICY "insert_approved_role" ON scenario_participants FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = user_id
    AND user_has_access('join_game')
    AND EXISTS (
      SELECT 1 FROM scenarios s
      WHERE s.id = scenario_participants.scenario_id AND s.room_open
    )
  );

-- UPDATE: only the scenario GM may change a player's role / team.
DROP POLICY IF EXISTS participant_update ON scenario_participants;
CREATE POLICY "participant_update" ON scenario_participants FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM scenario_participants sp
      WHERE sp.scenario_id = scenario_participants.scenario_id
        AND sp.user_id = auth.uid()
        AND sp.role = 'GM'
    )
  );

-- DELETE: only the scenario GM may kick a player.
DROP POLICY IF EXISTS participant_delete ON scenario_participants;
CREATE POLICY "participant_delete" ON scenario_participants FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM scenario_participants sp
      WHERE sp.scenario_id = scenario_participants.scenario_id
        AND sp.user_id = auth.uid()
        AND sp.role = 'GM'
    )
  );
