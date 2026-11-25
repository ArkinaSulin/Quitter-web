-- 176: Campaign ships replace persistent player ships.
--
-- A campaign ship row IS a version of a ship family. `parent_id` links a version
-- to the version it was derived from; rows with `parent_id IS NULL` are the
-- family roots and carry the family name. A scenario ship instance links to the
-- campaign row it currently represents (`ship_spelljammer.campaign_id`); only
-- the instance flagged `campaign_carrier` mirrors its runtime back into
-- `ship_campaign`. Other instances are scenario copies that live entirely in
-- `ship_spelljammer`.
--
-- Guards:
--   * at most one live carrier per campaign row (partial unique index);
--   * at most one un-superseded (leaf) child per (parent, scenario)
--     (`occupies_slot` + partial unique index).
--
-- The old player-ship tables are dropped: they were test data and the new model
-- does not need a separate versions table.

-- ---------------------------------------------------------------------------
-- 1. Drop the player-ship tables and their RPCs
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS release_idle_player_ships();
DROP FUNCTION IF EXISTS acquire_player_ship_editor(uuid);
DROP FUNCTION IF EXISTS heartbeat_player_ship_editor(uuid);
DROP FUNCTION IF EXISTS release_player_ship_editor(uuid, boolean);
DROP FUNCTION IF EXISTS convert_ship_to_player(text, text);
DROP FUNCTION IF EXISTS convert_ship_to_player(text);

-- The instance FK must go before the table it references.
ALTER TABLE ship_spelljammer DROP COLUMN IF EXISTS player_ship_id;

DROP TABLE IF EXISTS ship_player_versions;
DROP TABLE IF EXISTS ship_player;

-- ---------------------------------------------------------------------------
-- 2. Campaign ship versions
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ship_campaign (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  parent_id uuid REFERENCES ship_campaign(id) ON DELETE SET NULL,
  name text NOT NULL,
  numeral integer NOT NULL DEFAULT 1,
  scenario_id uuid REFERENCES scenarios(id) ON DELETE SET NULL,
  scenario_label text NOT NULL DEFAULT '',
  template_id text REFERENCES ship_templates(id) ON DELETE SET NULL,
  serial_number integer NOT NULL DEFAULT 0,
  ship_hp integer NOT NULL DEFAULT 1,
  ship_hp_max integer NOT NULL DEFAULT 1,
  min_hp_attained integer NOT NULL DEFAULT 1,
  damage jsonb NOT NULL DEFAULT '{}',
  crew_state jsonb NOT NULL DEFAULT '{}',
  cargo jsonb NOT NULL DEFAULT '[]',
  snapshot jsonb,
  occupies_slot boolean NOT NULL DEFAULT true,
  editor_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  editor_heartbeat_at timestamptz,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ship_campaign_owner ON ship_campaign(owner_id);
CREATE INDEX IF NOT EXISTS idx_ship_campaign_parent ON ship_campaign(parent_id);
CREATE INDEX IF NOT EXISTS idx_ship_campaign_scenario ON ship_campaign(scenario_id);

-- At most one un-superseded (leaf) child per (parent, scenario).
CREATE UNIQUE INDEX IF NOT EXISTS uq_ship_campaign_slot
  ON ship_campaign(parent_id, scenario_id)
  WHERE parent_id IS NOT NULL AND occupies_slot AND scenario_id IS NOT NULL;

ALTER TABLE ship_campaign ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ship_campaign_read ON ship_campaign;
CREATE POLICY ship_campaign_read ON ship_campaign
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS ship_campaign_write ON ship_campaign;
CREATE POLICY ship_campaign_write ON ship_campaign
  FOR ALL TO authenticated
  USING (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid());

-- ---------------------------------------------------------------------------
-- 3. Scenario instances link to a campaign version
-- ---------------------------------------------------------------------------
ALTER TABLE ship_spelljammer ADD COLUMN IF NOT EXISTS campaign_id uuid
  REFERENCES ship_campaign(id) ON DELETE SET NULL;
ALTER TABLE ship_spelljammer ADD COLUMN IF NOT EXISTS campaign_carrier boolean
  NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_ship_spelljammer_campaign
  ON ship_spelljammer(campaign_id) WHERE campaign_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_ship_spelljammer_carrier
  ON ship_spelljammer(campaign_id)
  WHERE campaign_carrier AND is_deleted = false AND campaign_id IS NOT NULL;

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
    WHEN 'campaignId' THEN 'campaign_id'
    WHEN 'campaignCarrier' THEN 'campaign_carrier'
    WHEN 'dryDockOpen' THEN 'dry_dock_open'
    WHEN 'dryDockRevision' THEN 'dry_dock_revision'
    WHEN 'isDeleted' THEN 'is_deleted'
    WHEN 'mcReduction' THEN 'mc_reduction'
    WHEN 'sailMaxStep' THEN 'sail_max_step'
    WHEN 'sailTrimStep' THEN 'sail_trim_step'
    WHEN 'ramUsedTurn' THEN 'ram_used_turn'
  END;
$$;

-- ---------------------------------------------------------------------------
-- 4. Real-time mirror: only the carrier instance writes its campaign row.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION mirror_campaign_ship_runtime()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.is_deleted AND NEW.campaign_carrier THEN
    NEW.campaign_carrier := false;
  END IF;

  IF NEW.campaign_id IS NOT NULL AND NEW.campaign_carrier AND NOT NEW.is_deleted THEN
    UPDATE ship_campaign
    SET ship_hp = NEW.ship_hp,
        ship_hp_max = GREATEST(1, NEW.ship_hp_max),
        min_hp_attained = COALESCE(NEW.min_hp_attained, NEW.ship_hp),
        damage = COALESCE(NEW.box_state, '{}'::jsonb),
        crew_state = COALESCE(NEW.crew_state, '{}'::jsonb),
        cargo = COALESCE(NEW.snapshot->'template'->'manifest', '[]'::jsonb),
        snapshot = COALESCE(NEW.snapshot, ship_campaign.snapshot),
        serial_number = COALESCE(NULLIF(NEW.serial_number, 0), ship_campaign.serial_number),
        updated_at = now()
    WHERE id = NEW.campaign_id;
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_ship_campaign_mirror ON ship_spelljammer;
CREATE TRIGGER trg_ship_campaign_mirror
  BEFORE INSERT OR UPDATE ON ship_spelljammer
  FOR EACH ROW EXECUTE FUNCTION mirror_campaign_ship_runtime();

-- A deleted carrier hands the flag to the earliest remaining live instance.
CREATE OR REPLACE FUNCTION promote_campaign_carrier()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.campaign_carrier AND OLD.campaign_id IS NOT NULL THEN
    UPDATE ship_spelljammer
    SET campaign_carrier = true
    WHERE id = (
      SELECT id FROM ship_spelljammer
      WHERE campaign_id = OLD.campaign_id AND is_deleted = false
      ORDER BY created_at, id
      LIMIT 1
    );
  END IF;
  RETURN OLD;
END $$;

DROP TRIGGER IF EXISTS trg_ship_campaign_promote ON ship_spelljammer;
CREATE TRIGGER trg_ship_campaign_promote
  AFTER DELETE ON ship_spelljammer
  FOR EACH ROW EXECUTE FUNCTION promote_campaign_carrier();

-- Soft delete also releases the carrier flag; promote in a second statement.
CREATE OR REPLACE FUNCTION release_campaign_carrier_on_soft_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.is_deleted AND NOT OLD.is_deleted AND OLD.campaign_carrier AND OLD.campaign_id IS NOT NULL THEN
    UPDATE ship_spelljammer
    SET campaign_carrier = true
    WHERE id = (
      SELECT id FROM ship_spelljammer
      WHERE campaign_id = OLD.campaign_id AND is_deleted = false
      ORDER BY created_at, id
      LIMIT 1
    );
  END IF;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS trg_ship_campaign_soft_delete ON ship_spelljammer;
CREATE TRIGGER trg_ship_campaign_soft_delete
  AFTER UPDATE ON ship_spelljammer
  FOR EACH ROW
  WHEN (NEW.is_deleted AND NOT OLD.is_deleted)
  EXECUTE FUNCTION release_campaign_carrier_on_soft_delete();

-- ---------------------------------------------------------------------------
-- 5. Scenario deletion keeps the versions readable
-- ---------------------------------------------------------------------------
-- The rows survive with the scenario name baked into `scenario_label`; the
-- scenario slot is released because the ship no longer belongs to a map.
CREATE OR REPLACE FUNCTION bake_campaign_scenario_label()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE ship_campaign
  SET scenario_label = CASE
        WHEN COALESCE(scenario_label, '') = '' THEN OLD.name
        ELSE scenario_label
      END,
      scenario_id = NULL,
      occupies_slot = false,
      updated_at = now()
  WHERE scenario_id = OLD.id;
  RETURN OLD;
END $$;

DROP TRIGGER IF EXISTS trg_ship_campaign_scenario_delete ON scenarios;
CREATE TRIGGER trg_ship_campaign_scenario_delete
  BEFORE DELETE ON scenarios
  FOR EACH ROW EXECUTE FUNCTION bake_campaign_scenario_label();

-- ---------------------------------------------------------------------------
-- 6. Editor lease (one person refits one version at a time)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION acquire_campaign_ship_editor(p_campaign_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_user_id uuid := auth.uid();
BEGIN
  UPDATE ship_campaign
  SET editor_user_id = current_user_id,
      editor_heartbeat_at = now(),
      updated_at = now()
  WHERE id = p_campaign_id
    AND (
      editor_user_id IS NULL
      OR editor_user_id = current_user_id
      OR editor_heartbeat_at IS NULL
      OR editor_heartbeat_at < now() - interval '30 seconds'
    );
  RETURN FOUND;
END $$;
REVOKE ALL ON FUNCTION acquire_campaign_ship_editor(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION acquire_campaign_ship_editor(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION heartbeat_campaign_ship_editor(p_campaign_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE ship_campaign
  SET editor_heartbeat_at = now()
  WHERE id = p_campaign_id AND editor_user_id = auth.uid();
  RETURN FOUND;
END $$;
REVOKE ALL ON FUNCTION heartbeat_campaign_ship_editor(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION heartbeat_campaign_ship_editor(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION release_campaign_ship_editor(p_campaign_id uuid, p_force boolean DEFAULT false)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE ship_campaign
  SET editor_user_id = NULL,
      editor_heartbeat_at = NULL,
      updated_at = now()
  WHERE id = p_campaign_id
    AND (p_force OR editor_user_id = auth.uid());
  RETURN FOUND;
END $$;
REVOKE ALL ON FUNCTION release_campaign_ship_editor(uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION release_campaign_ship_editor(uuid, boolean) TO authenticated;

-- ---------------------------------------------------------------------------
-- 7. Declare / convert / rename / fork / delete
-- ---------------------------------------------------------------------------
-- Display name = name + " " + roman(numeral) (numeral 1 is implicit) on the map;
-- the scenario label is appended by the client for the campaign list.
CREATE OR REPLACE FUNCTION declare_campaign_ship(p_ship_id text, p_name text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  s record;
  new_campaign_id uuid;
  ship_name text;
  scenario_name text;
  serial integer;
BEGIN
  SELECT * INTO s FROM ship_spelljammer WHERE id = p_ship_id AND is_deleted = false;
  IF NOT FOUND THEN RAISE EXCEPTION 'Ship not found'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM scenario_participants
    WHERE scenario_id = s.scenario_id AND user_id = auth.uid() AND role = 'GM'
  ) THEN
    RAISE EXCEPTION 'Only the DM can declare a campaign ship';
  END IF;
  IF s.campaign_id IS NOT NULL THEN
    RETURN s.campaign_id;
  END IF;
  IF s.template_id IS NULL OR s.snapshot IS NULL THEN
    RAISE EXCEPTION 'This ship has no design to save';
  END IF;

  ship_name := COALESCE(NULLIF(btrim(p_name), ''), s.name);
  scenario_name := COALESCE((SELECT name FROM scenarios WHERE id = s.scenario_id), '');
  serial := COALESCE(NULLIF(s.serial_number, 0), next_scenario_serial(s.scenario_id));

  INSERT INTO ship_campaign (
    owner_id, parent_id, name, numeral, scenario_id, scenario_label,
    template_id, serial_number, ship_hp, ship_hp_max, min_hp_attained,
    damage, crew_state, cargo, snapshot, created_by
  ) VALUES (
    auth.uid(), NULL, ship_name, 1, s.scenario_id, scenario_name,
    s.template_id, serial, s.ship_hp, s.ship_hp_max, COALESCE(s.min_hp_attained, s.ship_hp),
    COALESCE(s.box_state, '{}'::jsonb), COALESCE(s.crew_state, '{}'::jsonb),
    COALESCE(s.snapshot->'template'->'manifest', '[]'::jsonb), s.snapshot, auth.uid()
  ) RETURNING id INTO new_campaign_id;

  UPDATE ship_spelljammer
  SET campaign_id = new_campaign_id,
      campaign_carrier = true,
      serial_number = serial,
      name = ship_name,
      updated_at = now()
  WHERE id = s.id;

  RETURN new_campaign_id;
END $$;
REVOKE ALL ON FUNCTION declare_campaign_ship(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION declare_campaign_ship(text, text) TO authenticated;

-- Convert a scenario copy into its own campaign version. The new row is parented
-- to the version it copied.
CREATE OR REPLACE FUNCTION convert_instance_to_campaign(p_ship_id text, p_name text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  s record;
  parent record;
  new_id uuid;
  ship_name text;
  scenario_name text;
  next_numeral integer;
BEGIN
  SELECT * INTO s FROM ship_spelljammer WHERE id = p_ship_id AND is_deleted = false;
  IF NOT FOUND THEN RAISE EXCEPTION 'Ship not found'; END IF;
  IF s.campaign_id IS NULL THEN RAISE EXCEPTION 'This ship is not based on a campaign ship'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM scenario_participants
    WHERE scenario_id = s.scenario_id AND user_id = auth.uid() AND role = 'GM'
  ) THEN
    RAISE EXCEPTION 'Only the DM can create a campaign ship';
  END IF;
  IF s.campaign_carrier THEN RAISE EXCEPTION 'This ship is already a campaign carrier'; END IF;

  SELECT * INTO parent FROM ship_campaign WHERE id = s.campaign_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'The campaign version no longer exists'; END IF;
  IF parent.owner_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'You do not own that campaign ship';
  END IF;

  IF EXISTS (
    SELECT 1 FROM ship_campaign
    WHERE parent_id = parent.id AND scenario_id = s.scenario_id AND occupies_slot
  ) THEN
    RAISE EXCEPTION 'This scenario already has a campaign version of that ship; evolve it first';
  END IF;

  ship_name := COALESCE(NULLIF(btrim(p_name), ''), parent.name);
  scenario_name := COALESCE((SELECT name FROM scenarios WHERE id = s.scenario_id), '');
  next_numeral := parent.numeral;

  INSERT INTO ship_campaign (
    owner_id, parent_id, name, numeral, scenario_id, scenario_label,
    template_id, serial_number, ship_hp, ship_hp_max, min_hp_attained,
    damage, crew_state, cargo, snapshot, created_by
  ) VALUES (
    auth.uid(), parent.id, ship_name, next_numeral, s.scenario_id, scenario_name,
    s.template_id, s.serial_number, s.ship_hp, s.ship_hp_max,
    COALESCE(s.min_hp_attained, s.ship_hp),
    COALESCE(s.box_state, '{}'::jsonb), COALESCE(s.crew_state, '{}'::jsonb),
    COALESCE(s.snapshot->'template'->'manifest', '[]'::jsonb), s.snapshot, auth.uid()
  ) RETURNING id INTO new_id;

  UPDATE ship_campaign SET occupies_slot = false, updated_at = now() WHERE id = parent.id;
  UPDATE ship_spelljammer
  SET campaign_id = new_id, campaign_carrier = true, updated_at = now()
  WHERE id = s.id;

  RETURN new_id;
END $$;
REVOKE ALL ON FUNCTION convert_instance_to_campaign(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION convert_instance_to_campaign(text, text) TO authenticated;

CREATE OR REPLACE FUNCTION rename_campaign_ship(p_campaign_id uuid, p_name text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  ship_name text := btrim(COALESCE(p_name, ''));
BEGIN
  IF ship_name = '' THEN RETURN false; END IF;
  UPDATE ship_campaign
  SET name = ship_name, updated_at = now()
  WHERE id = p_campaign_id AND owner_id = auth.uid();
  RETURN FOUND;
END $$;
REVOKE ALL ON FUNCTION rename_campaign_ship(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION rename_campaign_ship(uuid, text) TO authenticated;

-- Fork the carrier's current ship model into a new version. This is a committed
-- transaction outside the undo log: a refit cannot be reverted.
CREATE OR REPLACE FUNCTION fork_campaign_version(
  p_ship_id text,
  p_name text,
  p_display_name text,
  p_numeral integer,
  p_snapshot jsonb,
  p_ship_hp integer,
  p_ship_hp_max integer,
  p_min_hp_attained integer,
  p_box_state jsonb,
  p_crew_state jsonb,
  p_cargo jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  s record;
  parent record;
  new_id uuid;
  ship_name text;
  scenario_name text;
BEGIN
  SELECT * INTO s FROM ship_spelljammer WHERE id = p_ship_id AND is_deleted = false;
  IF NOT FOUND THEN RAISE EXCEPTION 'Ship not found'; END IF;
  IF s.campaign_id IS NULL OR NOT s.campaign_carrier THEN
    RAISE EXCEPTION 'Only a campaign carrier can be refitted into a new version';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM scenario_participants
    WHERE scenario_id = s.scenario_id AND user_id = auth.uid() AND role = 'GM'
  ) THEN
    RAISE EXCEPTION 'Only the DM can create a campaign version';
  END IF;

  SELECT * INTO parent FROM ship_campaign WHERE id = s.campaign_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'The campaign version no longer exists'; END IF;
  IF parent.owner_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'You do not own that campaign ship';
  END IF;

  IF EXISTS (
    SELECT 1 FROM ship_campaign
    WHERE parent_id = parent.id AND scenario_id = s.scenario_id AND occupies_slot
  ) THEN
    RAISE EXCEPTION 'This version already has a successor in this scenario';
  END IF;

  ship_name := COALESCE(NULLIF(btrim(p_name), ''), parent.name);
  scenario_name := COALESCE((SELECT name FROM scenarios WHERE id = s.scenario_id), '');

  INSERT INTO ship_campaign (
    owner_id, parent_id, name, numeral, scenario_id, scenario_label,
    template_id, serial_number, ship_hp, ship_hp_max, min_hp_attained,
    damage, crew_state, cargo, snapshot, created_by
  ) VALUES (
    parent.owner_id, parent.id, ship_name, GREATEST(1, COALESCE(p_numeral, parent.numeral + 1)),
    s.scenario_id, scenario_name, s.template_id, s.serial_number,
    p_ship_hp, GREATEST(1, p_ship_hp_max), COALESCE(p_min_hp_attained, p_ship_hp),
    COALESCE(p_box_state, '{}'::jsonb), COALESCE(p_crew_state, '{}'::jsonb),
    COALESCE(p_cargo, '[]'::jsonb), p_snapshot, auth.uid()
  ) RETURNING id INTO new_id;

  UPDATE ship_campaign SET occupies_slot = false, updated_at = now() WHERE id = parent.id;

  UPDATE ship_spelljammer
  SET campaign_id = new_id,
      campaign_carrier = true,
      name = COALESCE(NULLIF(btrim(p_display_name), ''), ship_name),
      snapshot = p_snapshot,
      ship_hp = p_ship_hp,
      ship_hp_max = GREATEST(1, p_ship_hp_max),
      min_hp_attained = COALESCE(p_min_hp_attained, p_ship_hp),
      box_state = COALESCE(p_box_state, '{}'::jsonb),
      crew_state = COALESCE(p_crew_state, '{}'::jsonb),
      updated_at = now()
  WHERE id = s.id;

  RETURN new_id;
END $$;
REVOKE ALL ON FUNCTION fork_campaign_version(text, text, text, integer, jsonb, integer, integer, integer, jsonb, jsonb, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fork_campaign_version(text, text, text, integer, jsonb, integer, integer, integer, jsonb, jsonb, jsonb) TO authenticated;

-- Delete a version. Leaf rows are always removable; a frozen row may be removed
-- only when its children can be spliced into its parent's free slot.
CREATE OR REPLACE FUNCTION delete_campaign_ship(p_campaign_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  row record;
  child record;
  promoted uuid;
BEGIN
  SELECT * INTO row FROM ship_campaign WHERE id = p_campaign_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Campaign ship not found'; END IF;
  IF row.owner_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Only the owner can delete this campaign ship';
  END IF;
  IF EXISTS (
    SELECT 1 FROM ship_spelljammer
    WHERE campaign_id = p_campaign_id AND is_deleted = false
  ) THEN
    RAISE EXCEPTION 'This version is still on a scenario map';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM ship_campaign WHERE parent_id = p_campaign_id) THEN
    DELETE FROM ship_campaign WHERE id = p_campaign_id;
    RETURN true;
  END IF;

  IF row.parent_id IS NULL THEN
    SELECT * INTO child FROM ship_campaign
    WHERE parent_id = p_campaign_id ORDER BY created_at, id LIMIT 1;
    promoted := child.id;
    -- Refuse when two children would occupy the same (new root, scenario) slot.
    IF EXISTS (
      SELECT 1 FROM ship_campaign a
      JOIN ship_campaign b
        ON a.parent_id = p_campaign_id AND b.parent_id = p_campaign_id
       AND a.id < b.id AND a.scenario_id = b.scenario_id AND a.occupies_slot AND b.occupies_slot
    ) THEN
      RAISE EXCEPTION 'Two versions in the same scenario cannot both become the new root';
    END IF;
    UPDATE ship_campaign SET parent_id = NULL WHERE id = promoted;
    UPDATE ship_campaign SET parent_id = promoted WHERE parent_id = p_campaign_id;
  ELSE
    IF EXISTS (
      SELECT 1 FROM ship_campaign c
      WHERE c.parent_id = p_campaign_id AND c.occupies_slot
        AND EXISTS (
          SELECT 1 FROM ship_campaign occ
          WHERE occ.parent_id = row.parent_id AND occ.scenario_id = c.scenario_id
            AND occ.occupies_slot AND occ.id <> p_campaign_id
        )
    ) THEN
      RAISE EXCEPTION 'The parent slot is taken; delete the other successor first';
    END IF;
    UPDATE ship_campaign SET parent_id = row.parent_id WHERE parent_id = p_campaign_id;
  END IF;

  DELETE FROM ship_campaign WHERE id = p_campaign_id;
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION delete_campaign_ship(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION delete_campaign_ship(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 8. Placement creates a campaign version inside the same command
-- ---------------------------------------------------------------------------
-- A `CAMPAIGN` sub-step carries the whole row. It is ordered before the matching
-- SHIP row on execute, and after it on undo, so undo removes the instance first
-- and then deletes the version only while it is still an orphan.
--
-- The existing apply_substeps keeps its body; it is renamed once to
-- `apply_substeps_core` and a thin wrapper interleaves the campaign steps.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'apply_substeps_core') THEN
    ALTER FUNCTION apply_substeps(uuid, jsonb, boolean, bigint) RENAME TO apply_substeps_core;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION apply_campaign_substeps(p_scenario_id uuid, p_steps jsonb, p_use_to boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  step_rec record;
  chg_rec record;
  val jsonb;
  campaign_id uuid;
  campaign_parent uuid;
  campaign_scenario uuid;
BEGIN
  FOR step_rec IN
    SELECT value, ord
    FROM jsonb_array_elements(p_steps) WITH ORDINALITY AS t(value, ord)
    ORDER BY CASE WHEN p_use_to THEN ord ELSE -ord END
  LOOP
    IF step_rec.value->>'type' <> 'CAMPAIGN' THEN CONTINUE; END IF;
    campaign_id := NULLIF(step_rec.value->>'unitId', '')::uuid;
    IF campaign_id IS NULL THEN CONTINUE; END IF;

    FOR chg_rec IN
      SELECT value, ord
      FROM jsonb_array_elements(COALESCE(step_rec.value->'changes', '[]'::jsonb)) WITH ORDINALITY AS u(value, ord)
      ORDER BY CASE WHEN p_use_to THEN ord ELSE -ord END
    LOOP
      IF chg_rec.value->>'field' <> 'row' THEN CONTINUE; END IF;
      val := chg_rec.value -> (CASE WHEN p_use_to THEN 'to' ELSE 'from' END);

      IF val IS NULL OR val = 'null'::jsonb THEN
        SELECT parent_id, scenario_id INTO campaign_parent, campaign_scenario
        FROM ship_campaign WHERE id = campaign_id;

        DELETE FROM ship_campaign c
        WHERE c.id = campaign_id
          AND NOT EXISTS (SELECT 1 FROM ship_campaign ch WHERE ch.parent_id = c.id)
          AND NOT EXISTS (
            SELECT 1 FROM ship_spelljammer s
            WHERE s.campaign_id = c.id AND s.is_deleted = false
          );

        IF campaign_parent IS NOT NULL THEN
          UPDATE ship_campaign p
          SET occupies_slot = NOT EXISTS (
            SELECT 1 FROM ship_campaign ch
            WHERE ch.parent_id = p.id
              AND ch.scenario_id = campaign_scenario
              AND ch.occupies_slot
          )
          WHERE p.id = campaign_parent;
        END IF;
      ELSE
        INSERT INTO ship_campaign (
          id, owner_id, parent_id, name, numeral, scenario_id, scenario_label,
          template_id, serial_number, ship_hp, ship_hp_max, min_hp_attained,
          damage, crew_state, cargo, snapshot, occupies_slot, created_by
        ) VALUES (
          campaign_id,
          COALESCE(NULLIF(val->>'ownerId', '')::uuid, auth.uid()),
          NULLIF(val->>'parentId', '')::uuid,
          COALESCE(NULLIF(val->>'name', ''), 'Ship'),
          COALESCE((val->>'numeral')::int, 1),
          p_scenario_id,
          COALESCE(val->>'scenarioLabel', ''),
          NULLIF(val->>'templateId', ''),
          COALESCE((val->>'serialNumber')::int, 0),
          COALESCE((val->>'shipHp')::int, 1),
          GREATEST(1, COALESCE((val->>'shipHpMax')::int, 1)),
          COALESCE((val->>'minHpAttained')::int, COALESCE((val->>'shipHp')::int, 1)),
          COALESCE(val->'damage', '{}'::jsonb),
          COALESCE(val->'crewState', '{}'::jsonb),
          COALESCE(val->'cargo', '[]'::jsonb),
          val->'snapshot',
          COALESCE((val->>'occupiesSlot')::boolean, true),
          auth.uid()
        )
        ON CONFLICT (id) DO NOTHING;

        IF NULLIF(val->>'parentId', '') IS NOT NULL THEN
          UPDATE ship_campaign
          SET occupies_slot = false, updated_at = now()
          WHERE id = (val->>'parentId')::uuid;
        END IF;
      END IF;
    END LOOP;
  END LOOP;
END $$;

REVOKE ALL ON FUNCTION apply_campaign_substeps(uuid, jsonb, boolean) FROM PUBLIC;

CREATE OR REPLACE FUNCTION apply_substeps(p_scenario_id uuid, p_steps jsonb, p_use_to boolean, p_command_seq bigint)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  rest jsonb;
BEGIN
  SELECT COALESCE(jsonb_agg(value ORDER BY ord), '[]'::jsonb) INTO rest
  FROM jsonb_array_elements(p_steps) WITH ORDINALITY AS t(value, ord)
  WHERE value->>'type' <> 'CAMPAIGN';

  IF p_use_to THEN
    PERFORM apply_campaign_substeps(p_scenario_id, p_steps, true);
    PERFORM apply_substeps_core(p_scenario_id, rest, p_use_to, p_command_seq);
  ELSE
    PERFORM apply_substeps_core(p_scenario_id, rest, p_use_to, p_command_seq);
    PERFORM apply_campaign_substeps(p_scenario_id, p_steps, false);
  END IF;
END $$;

REVOKE ALL ON FUNCTION apply_substeps(uuid, jsonb, boolean, bigint) FROM PUBLIC;

NOTIFY pgrst, 'reload schema';
