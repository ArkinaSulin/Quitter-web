-- 024: allow pending (role = NULL) users to watch replays.
-- Replay is strictly read-only. Migration 019 only granted command_log SELECT to
-- approved users (role IS NOT NULL), so a brand-new pending user watching a replay
-- would get zero rows. This policy ORs in any authenticated user who has a profile
-- row (pending included).
CREATE POLICY "select_log_pending"
  ON command_log FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
    )
  );
