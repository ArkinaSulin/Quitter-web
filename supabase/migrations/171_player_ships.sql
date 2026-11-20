-- 171: Persistent player ships, versioned saves, dry-dock editor lease.
--
-- A player ship links to a normal ship template row for its design; the
-- player_ships row carries identity + runtime state (HP/damage/crew/cargo).
-- Immutable player_ship_versions rows are full snapshots created on Save.

CREATE TABLE IF NOT EXISTS player_ships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  template_id text NOT NULL REFERENCES ship_templates(id) ON DELETE RESTRICT,
  name text NOT NULL,
  serial_number integer NOT NULL,
  ship_hp integer NOT NULL DEFAULT 1,
  ship_hp_max integer NOT NULL DEFAULT 1,
  damage jsonb NOT NULL DEFAULT '{}',
  crew_state jsonb NOT NULL DEFAULT '{}',
  cargo jsonb NOT NULL DEFAULT '[]',
  deployed_scenario_id uuid REFERENCES scenarios(id) ON DELETE SET NULL,
  editor_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  editor_heartbeat_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS player_ship_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  player_ship_id uuid NOT NULL REFERENCES player_ships(id) ON DELETE CASCADE,
  version_number integer NOT NULL,
  name text NOT NULL,
  ship_hp integer NOT NULL,
  damage jsonb NOT NULL DEFAULT '{}',
  crew_state jsonb NOT NULL DEFAULT '{}',
  cargo jsonb NOT NULL DEFAULT '[]',
  snapshot jsonb NOT NULL,
  source_scenario_id uuid REFERENCES scenarios(id) ON DELETE SET NULL,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (player_ship_id, version_number)
);

CREATE INDEX IF NOT EXISTS idx_player_ship_versions_ship
  ON player_ship_versions(player_ship_id, version_number DESC);
CREATE INDEX IF NOT EXISTS idx_player_ships_deployed
  ON player_ships(deployed_scenario_id)
  WHERE deployed_scenario_id IS NOT NULL;

ALTER TABLE scenarios ADD COLUMN IF NOT EXISTS next_serial integer NOT NULL DEFAULT 1;
ALTER TABLE units ADD COLUMN IF NOT EXISTS serial_number integer;
ALTER TABLE ship_spelljammer ADD COLUMN IF NOT EXISTS serial_number integer;
ALTER TABLE ship_spelljammer ADD COLUMN IF NOT EXISTS player_ship_id uuid
  REFERENCES player_ships(id) ON DELETE SET NULL;
ALTER TABLE ship_spelljammer ADD COLUMN IF NOT EXISTS dry_dock_open boolean NOT NULL DEFAULT false;

-- Spreadsheet-style labels: A, B, ... Z, AA, ...
CREATE OR REPLACE FUNCTION alpha_label_to_number(p_label text)
RETURNS integer
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  s text := upper(coalesce(p_label, ''));
  n bigint := 0;
  i integer;
BEGIN
  -- Backfill only recognizes the short suffix labels we actually use
  -- (A..Z, AA..ZZ). Longer trailing words in a unit name are not serials.
  IF s !~ '^[A-Z]{1,2}$' THEN RETURN 0; END IF;
  FOR i IN 1..char_length(s) LOOP
    n := n * 26 + (ascii(substr(s, i, 1)) - 64);
  END LOOP;
  IF n > 2147483647 THEN RETURN 0; END IF;
  RETURN n::integer;
EXCEPTION
  WHEN numeric_value_out_of_range THEN RETURN 0;
END $$;

-- Backfill existing unit serials from their "Name A" suffix.
UPDATE units
SET serial_number = alpha_label_to_number(substring(unit_name from '([A-Za-z]+)\s*$'))
WHERE serial_number IS NULL;

UPDATE scenarios s
SET next_serial = GREATEST(
  COALESCE((SELECT MAX(serial_number) FROM units WHERE scenario_id = s.id::text), 0),
  COALESCE((SELECT MAX(serial_number) FROM ship_spelljammer WHERE scenario_id = s.id), 0),
  (SELECT COUNT(*) FROM units WHERE scenario_id = s.id::text),
  (SELECT COUNT(*) FROM ship_spelljammer WHERE scenario_id = s.id)
) + 1;

-- Atomic shared serial allocation for units, NPC ships and player ships.
CREATE OR REPLACE FUNCTION next_scenario_serial(p_scenario_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  n integer;
BEGIN
  UPDATE scenarios
  SET next_serial = next_serial + 1
  WHERE id = p_scenario_id
  RETURNING next_serial - 1 INTO n;
  RETURN COALESCE(n, 1);
END $$;
REVOKE ALL ON FUNCTION next_scenario_serial(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION next_scenario_serial(uuid) TO authenticated;

-- One active dry-dock editor per player ship.
CREATE OR REPLACE FUNCTION acquire_player_ship_editor(p_ship_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_user_id uuid := auth.uid();
BEGIN
  UPDATE player_ships
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
  UPDATE player_ships
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
  UPDATE player_ships
  SET editor_user_id = NULL,
      editor_heartbeat_at = NULL,
      updated_at = now()
  WHERE id = p_ship_id
    AND (p_force OR editor_user_id = auth.uid());
  RETURN FOUND;
END $$;
REVOKE ALL ON FUNCTION release_player_ship_editor(uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION release_player_ship_editor(uuid, boolean) TO authenticated;

-- Release player ships whose scenario no longer has a live DM heartbeat.
CREATE OR REPLACE FUNCTION release_idle_player_ships()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  released integer := 0;
BEGIN
  UPDATE player_ships ps
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
      SELECT 1 FROM player_ships ps
      WHERE ps.id = ss.player_ship_id
        AND ps.deployed_scenario_id = ss.scenario_id
    );

  RETURN released;
END $$;
REVOKE ALL ON FUNCTION release_idle_player_ships() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION release_idle_player_ships() TO authenticated;

ALTER TABLE player_ships ENABLE ROW LEVEL SECURITY;
ALTER TABLE player_ship_versions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS player_ships_read ON player_ships;
CREATE POLICY player_ships_read ON player_ships
  FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS player_ships_write ON player_ships;
CREATE POLICY player_ships_write ON player_ships
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS player_ship_versions_read ON player_ship_versions;
CREATE POLICY player_ship_versions_read ON player_ship_versions
  FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS player_ship_versions_write ON player_ship_versions;
CREATE POLICY player_ship_versions_write ON player_ship_versions
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION ship_field_to_column(fld text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE fld
    WHEN 'templateId' THEN 'template_id'
    WHEN 'name' THEN 'name'
    WHEN 'team' THEN 'team'
    WHEN 'hex' THEN 'hex'
    WHEN 'facing' THEN 'facing'
    WHEN 'speedStat' THEN 'speed_stat'
    WHEN 'shipHp' THEN 'ship_hp'
    WHEN 'shipHpMax' THEN 'ship_hp_max'
    WHEN 'loadedCargo' THEN 'loaded_cargo'
    WHEN 'crewAssigned' THEN 'crew_assigned'
    WHEN 'boxState' THEN 'box_state'
    WHEN 'attachedToShip' THEN 'attached_to_ship'
    WHEN 'snapshot' THEN 'snapshot'
    WHEN 'elevation' THEN 'elevation'
    WHEN 'lastSpeed' THEN 'last_speed'
    WHEN 'declaredSpeed' THEN 'declared_speed'
    WHEN 'declaredRound' THEN 'declared_round'
    WHEN 'speedSpent' THEN 'speed_spent'
    WHEN 'turnsSinceFacing' THEN 'turns_since_facing'
    WHEN 'stepBudget' THEN 'step_budget'
    WHEN 'stations' THEN 'stations'
    WHEN 'crewState' THEN 'crew_state'
    WHEN 'crewTeam' THEN 'crew_team'
    WHEN 'reload' THEN 'reload'
    WHEN 'cardState' THEN 'card_state'
    WHEN 'weaponState' THEN 'card_state'
    WHEN 'imageUrl' THEN 'image_url'
    WHEN 'keelLength' THEN 'keel_length'
    WHEN 'imageOffsetY' THEN 'image_offset_y'
    WHEN 'hidden' THEN 'hidden'
    WHEN 'serialNumber' THEN 'serial_number'
    WHEN 'playerShipId' THEN 'player_ship_id'
    WHEN 'dryDockOpen' THEN 'dry_dock_open'
    WHEN 'isDeleted' THEN 'is_deleted'
    WHEN 'mcReduction' THEN 'mc_reduction'
    WHEN 'sailMaxStep' THEN 'sail_max_step'
    WHEN 'sailTrimStep' THEN 'sail_trim_step'
    WHEN 'ramUsedTurn' THEN 'ram_used_turn'
  END;
$$;
