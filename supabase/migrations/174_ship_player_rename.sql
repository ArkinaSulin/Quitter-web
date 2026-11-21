-- 174: Rename player-ship tables to the ship_* subsystem convention.
--
-- player_ships        -> ship_player
-- player_ship_versions -> ship_player_versions
--
-- Identity/ownership/deployment/lease stay on the stable header row; versions
-- remain immutable snapshots. No columns or data are merged.

ALTER TABLE IF EXISTS public.player_ships RENAME TO ship_player;
ALTER TABLE IF EXISTS public.player_ship_versions RENAME TO ship_player_versions;

ALTER INDEX IF EXISTS public.idx_player_ship_versions_ship
  RENAME TO idx_ship_player_versions_ship;
ALTER INDEX IF EXISTS public.idx_player_ships_deployed
  RENAME TO idx_ship_player_deployed;

DROP POLICY IF EXISTS player_ships_read ON public.ship_player;
DROP POLICY IF EXISTS ship_player_read ON public.ship_player;
CREATE POLICY ship_player_read ON public.ship_player
  FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS player_ships_write ON public.ship_player;
DROP POLICY IF EXISTS ship_player_write ON public.ship_player;
CREATE POLICY ship_player_write ON public.ship_player
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS player_ship_versions_read ON public.ship_player_versions;
DROP POLICY IF EXISTS ship_player_versions_read ON public.ship_player_versions;
CREATE POLICY ship_player_versions_read ON public.ship_player_versions
  FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS player_ship_versions_write ON public.ship_player_versions;
DROP POLICY IF EXISTS ship_player_versions_write ON public.ship_player_versions;
CREATE POLICY ship_player_versions_write ON public.ship_player_versions
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Recreate the RPCs whose bodies referenced the old table names. The RPC names
-- stay unchanged so existing clients keep working.
CREATE OR REPLACE FUNCTION acquire_player_ship_editor(p_ship_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_user_id uuid := auth.uid();
BEGIN
  UPDATE ship_player
  SET editor_user_id = current_user_id,
      editor_heartbeat_at = now(),
      updated_at = now()
  WHERE id = p_ship_id
    AND (
      editor_user_id IS NULL
      OR editor_user_id = current_user_id
      OR editor_heartbeat_at IS NULL
      OR editor_heartbeat_at < now() - interval '30 seconds'
    );
  RETURN FOUND;
END $$;
REVOKE ALL ON FUNCTION acquire_player_ship_editor(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION acquire_player_ship_editor(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION heartbeat_player_ship_editor(p_ship_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE ship_player
  SET editor_heartbeat_at = now()
  WHERE id = p_ship_id AND editor_user_id = auth.uid();
  RETURN FOUND;
END $$;
REVOKE ALL ON FUNCTION heartbeat_player_ship_editor(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION heartbeat_player_ship_editor(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION release_player_ship_editor(p_ship_id uuid, p_force boolean DEFAULT false)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE ship_player
  SET editor_user_id = NULL,
      editor_heartbeat_at = NULL,
      updated_at = now()
  WHERE id = p_ship_id
    AND (p_force OR editor_user_id = auth.uid());
  RETURN FOUND;
END $$;
REVOKE ALL ON FUNCTION release_player_ship_editor(uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION release_player_ship_editor(uuid, boolean) TO authenticated;

CREATE OR REPLACE FUNCTION release_idle_player_ships()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  released integer := 0;
BEGIN
  UPDATE ship_player ps
  SET deployed_scenario_id = NULL,
      editor_user_id = NULL,
      editor_heartbeat_at = NULL,
      updated_at = now()
  FROM scenarios s
  WHERE ps.deployed_scenario_id = s.id
    AND (s.dm_heartbeat_at IS NULL OR s.dm_heartbeat_at < now() - interval '20 seconds');
  GET DIAGNOSTICS released = ROW_COUNT;

  UPDATE ship_spelljammer ss
  SET player_ship_id = NULL,
      dry_dock_open = false,
      updated_at = now()
  WHERE ss.player_ship_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM ship_player ps
      WHERE ps.id = ss.player_ship_id
        AND ps.deployed_scenario_id = ss.scenario_id
    );

  RETURN released;
END $$;
REVOKE ALL ON FUNCTION release_idle_player_ships() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION release_idle_player_ships() TO authenticated;

CREATE OR REPLACE FUNCTION convert_ship_to_player(p_ship_id text, p_name text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  s record;
  player_id uuid;
  serial integer;
  manifest jsonb;
  ship_name text;
BEGIN
  SELECT * INTO s
  FROM ship_spelljammer
  WHERE id = p_ship_id AND is_deleted = false;

  IF NOT FOUND THEN RETURN NULL; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM scenario_participants
    WHERE scenario_id = s.scenario_id
      AND user_id = auth.uid()
      AND role = 'GM'
  ) THEN
    RETURN NULL;
  END IF;

  IF s.player_ship_id IS NOT NULL THEN
    RETURN s.player_ship_id;
  END IF;

  IF s.template_id IS NULL OR s.snapshot IS NULL THEN
    RETURN NULL;
  END IF;

  ship_name := COALESCE(NULLIF(btrim(p_name), ''), s.name);
  serial := COALESCE(NULLIF(s.serial_number, 0), next_scenario_serial(s.scenario_id));
  manifest := COALESCE(s.snapshot->'template'->'manifest', '[]'::jsonb);

  INSERT INTO ship_player (
    owner_id, template_id, name, serial_number,
    ship_hp, ship_hp_max, damage, crew_state, cargo, deployed_scenario_id
  ) VALUES (
    NULL, s.template_id, ship_name, serial,
    s.ship_hp, s.ship_hp_max, s.box_state, s.crew_state, manifest, s.scenario_id
  ) RETURNING id INTO player_id;

  INSERT INTO ship_player_versions (
    player_ship_id, version_number, name, ship_hp, damage, crew_state, cargo,
    snapshot, source_scenario_id, created_by
  ) VALUES (
    player_id, 1, ship_name, s.ship_hp, s.box_state, s.crew_state, manifest,
    s.snapshot, s.scenario_id, auth.uid()
  );

  UPDATE ship_spelljammer
  SET player_ship_id = player_id,
      serial_number = serial,
      name = ship_name,
      updated_at = now()
  WHERE id = s.id;

  RETURN player_id;
END $$;
REVOKE ALL ON FUNCTION convert_ship_to_player(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION convert_ship_to_player(text, text) TO authenticated;
