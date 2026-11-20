-- 173: Player-ship claim name + confirmation support.
--
-- Claiming an ordinary ship can rename it. The persistent player ship, v1
-- version and current scenario instance all use the supplied name.

DROP FUNCTION IF EXISTS convert_ship_to_player(text);

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

  INSERT INTO player_ships (
    owner_id, template_id, name, serial_number,
    ship_hp, ship_hp_max, damage, crew_state, cargo, deployed_scenario_id
  ) VALUES (
    NULL, s.template_id, ship_name, serial,
    s.ship_hp, s.ship_hp_max, s.box_state, s.crew_state, manifest, s.scenario_id
  ) RETURNING id INTO player_id;

  INSERT INTO player_ship_versions (
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
