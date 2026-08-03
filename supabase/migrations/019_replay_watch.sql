-- 019: allow any approved user to watch replays of any scenario
-- (replay is read-only; the existing participant policy stays via OR-ing)
CREATE POLICY "select_log_any_approved"
  ON command_log FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid() AND role IS NOT NULL
    )
  );
