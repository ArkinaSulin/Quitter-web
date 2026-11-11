-- 156: RLS for `ship_spelljammer` scenario instances.
--
-- Reads: any participant of the scenario. Writes: the scenario GM (direct
-- placement/removal). Runtime commands go through `execute_command` /
-- `apply_substeps`, which are SECURITY DEFINER and therefore bypass RLS.

ALTER TABLE ship_spelljammer ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ship_spelljammer_select ON ship_spelljammer;
CREATE POLICY ship_spelljammer_select ON ship_spelljammer
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM scenario_participants sp
      WHERE sp.scenario_id = ship_spelljammer.scenario_id
        AND sp.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS ship_spelljammer_insert ON ship_spelljammer;
CREATE POLICY ship_spelljammer_insert ON ship_spelljammer
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM scenario_participants sp
      WHERE sp.scenario_id = ship_spelljammer.scenario_id
        AND sp.user_id = auth.uid()
        AND sp.role = 'GM'
    )
  );

DROP POLICY IF EXISTS ship_spelljammer_update ON ship_spelljammer;
CREATE POLICY ship_spelljammer_update ON ship_spelljammer
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM scenario_participants sp
      WHERE sp.scenario_id = ship_spelljammer.scenario_id
        AND sp.user_id = auth.uid()
        AND sp.role = 'GM'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM scenario_participants sp
      WHERE sp.scenario_id = ship_spelljammer.scenario_id
        AND sp.user_id = auth.uid()
        AND sp.role = 'GM'
    )
  );

DROP POLICY IF EXISTS ship_spelljammer_delete ON ship_spelljammer;
CREATE POLICY ship_spelljammer_delete ON ship_spelljammer
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM scenario_participants sp
      WHERE sp.scenario_id = ship_spelljammer.scenario_id
        AND sp.user_id = auth.uid()
        AND sp.role = 'GM'
    )
  );
