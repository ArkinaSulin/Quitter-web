-- 175: Dry-dock refit invoice, Min HP Attained, armor pricing and cargo prices.
--
-- A player ship remembers the worst HP it reached before a dock visit. Field
-- repair kits patch that damage; the dock strips the patch (50 gp/HP) and then
-- repairs the real damage (100 gp/HP). Every Save stores the design before and
-- after the refit plus the itemized invoice.
--
-- Equipment is priced by one rule: cost per ton. Components and weapons derive
-- it from their unit price and mass; armor authors it directly.

ALTER TABLE ship_armors ADD COLUMN IF NOT EXISTS cost_per_ton numeric NOT NULL DEFAULT 0;

ALTER TABLE ship_player ADD COLUMN IF NOT EXISTS min_hp_attained integer;
ALTER TABLE ship_player_versions ADD COLUMN IF NOT EXISTS min_hp_attained integer;
ALTER TABLE ship_player_versions ADD COLUMN IF NOT EXISTS snapshot_before jsonb;
ALTER TABLE ship_player_versions ADD COLUMN IF NOT EXISTS invoice jsonb;
ALTER TABLE ship_player_versions ADD COLUMN IF NOT EXISTS total_cost integer NOT NULL DEFAULT 0;

ALTER TABLE ship_spelljammer ADD COLUMN IF NOT EXISTS min_hp_attained integer;
ALTER TABLE ship_spelljammer ADD COLUMN IF NOT EXISTS dry_dock_revision integer NOT NULL DEFAULT 0;

-- Legacy ships start their min-HP history at their current HP: no retroactive
-- patch-removal charge for damage that happened before this rule existed.
UPDATE ship_player
SET min_hp_attained = ship_hp
WHERE min_hp_attained IS NULL;

UPDATE ship_spelljammer
SET min_hp_attained = ship_hp
WHERE min_hp_attained IS NULL;

-- Cargo price catalog. The manifest stays free-form JSON; the invoice looks a
-- line up by name (case-insensitive). DM price changes are a later feature.
CREATE TABLE IF NOT EXISTS ship_cargo (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  category text NOT NULL DEFAULT 'general_cargo',
  unit text NOT NULL DEFAULT 'ton',
  unit_mass numeric NOT NULL DEFAULT 1,
  unit_cost integer NOT NULL DEFAULT 0,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE ship_cargo ENABLE ROW LEVEL SECURITY;

-- Dry dock is a player-facing editor, so every authenticated player may read
-- the part catalogs (armor/component/weapon/cargo). The library template rows
-- stay gated by shipyard read; writes stay admin/DM.
DROP POLICY IF EXISTS ship_catalog_select ON ship_armors;
CREATE POLICY ship_catalog_select ON ship_armors FOR SELECT TO authenticated
  USING (true);
DROP POLICY IF EXISTS ship_catalog_insert ON ship_armors;
CREATE POLICY ship_catalog_insert ON ship_armors FOR INSERT TO authenticated
  WITH CHECK (ship_component_write());
DROP POLICY IF EXISTS ship_catalog_update ON ship_armors;
CREATE POLICY ship_catalog_update ON ship_armors FOR UPDATE TO authenticated
  USING (ship_component_write()) WITH CHECK (ship_component_write());
DROP POLICY IF EXISTS ship_catalog_delete ON ship_armors;
CREATE POLICY ship_catalog_delete ON ship_armors FOR DELETE TO authenticated
  USING (ship_component_write());
DROP POLICY IF EXISTS ship_catalog_select ON ship_components;
CREATE POLICY ship_catalog_select ON ship_components FOR SELECT TO authenticated
  USING (true);
DROP POLICY IF EXISTS ship_catalog_select ON ship_weapons;
CREATE POLICY ship_catalog_select ON ship_weapons FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS ship_cargo_select ON ship_cargo;
CREATE POLICY ship_cargo_select ON ship_cargo FOR SELECT TO authenticated
  USING (true);
DROP POLICY IF EXISTS ship_cargo_insert ON ship_cargo;
CREATE POLICY ship_cargo_insert ON ship_cargo FOR INSERT TO authenticated
  WITH CHECK (ship_component_write());
DROP POLICY IF EXISTS ship_cargo_update ON ship_cargo;
CREATE POLICY ship_cargo_update ON ship_cargo FOR UPDATE TO authenticated
  USING (ship_component_write()) WITH CHECK (ship_component_write());
DROP POLICY IF EXISTS ship_cargo_delete ON ship_cargo;
CREATE POLICY ship_cargo_delete ON ship_cargo FOR DELETE TO authenticated
  USING (ship_component_write());

-- SHIP command field allowlist (adds min HP and the dry-dock re-share revision).
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
    WHEN 'minHpAttained' THEN 'min_hp_attained'
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
    WHEN 'dryDockRevision' THEN 'dry_dock_revision'
    WHEN 'isDeleted' THEN 'is_deleted'
    WHEN 'mcReduction' THEN 'mc_reduction'
    WHEN 'sailMaxStep' THEN 'sail_max_step'
    WHEN 'sailTrimStep' THEN 'sail_trim_step'
    WHEN 'ramUsedTurn' THEN 'ram_used_turn'
  END;
$$;

-- Claiming a ship starts its min-HP history at the claimed HP.
CREATE OR REPLACE FUNCTION convert_ship_to_player(p_ship_id text, p_name text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  s record;
  player_id uuid;
  ship_name text;
  serial integer;
  manifest jsonb;
BEGIN
  SELECT * INTO s
  FROM ship_spelljammer
  WHERE id = p_ship_id AND is_deleted = false;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

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
    ship_hp, ship_hp_max, min_hp_attained, damage, crew_state, cargo, deployed_scenario_id
  ) VALUES (
    NULL, s.template_id, ship_name, serial,
    s.ship_hp, s.ship_hp_max, COALESCE(s.min_hp_attained, s.ship_hp),
    s.box_state, s.crew_state, manifest, s.scenario_id
  ) RETURNING id INTO player_id;

  INSERT INTO ship_player_versions (
    player_ship_id, version_number, name, ship_hp, min_hp_attained, damage, crew_state, cargo,
    snapshot, source_scenario_id, created_by
  ) VALUES (
    player_id, 1, ship_name, s.ship_hp, COALESCE(s.min_hp_attained, s.ship_hp),
    s.box_state, s.crew_state, manifest,
    s.snapshot, s.scenario_id, auth.uid()
  );

  UPDATE ship_spelljammer
  SET player_ship_id = player_id,
      serial_number = serial,
      name = ship_name,
      min_hp_attained = COALESCE(min_hp_attained, ship_hp),
      updated_at = now()
  WHERE id = s.id;

  RETURN player_id;
END $$;
REVOKE ALL ON FUNCTION convert_ship_to_player(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION convert_ship_to_player(text, text) TO authenticated;

NOTIFY pgrst, 'reload schema';
