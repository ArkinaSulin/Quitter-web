-- 179: fix the ambiguous `numeral` reference in fork_campaign_version (178).
--
-- PL/pgSQL resolves a bare name to a column first; the function also declared a
-- variable called `numeral`, so the recursive CTE's `SELECT ... numeral FROM
-- ship_campaign` raised `column reference "numeral" is ambiguous`. The variable
-- is renamed to `new_numeral` and the CTE column to `family_numeral`, so no
-- identifier is shared with a column.

CREATE OR REPLACE FUNCTION fork_campaign_version(
  p_ship_id text,
  p_name text,
  p_snapshot jsonb,
  p_ship_hp integer,
  p_ship_hp_max integer,
  p_min_hp_attained integer,
  p_box_state jsonb,
  p_crew_state jsonb,
  p_cargo jsonb,
  p_reset_numeral boolean DEFAULT false
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  s record;
  source record;
  walk record;
  root_id uuid;
  new_id uuid;
  ship_name text;
  display_name text;
  new_numeral integer;
  family_max integer;
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

  SELECT * INTO source FROM ship_campaign WHERE id = s.campaign_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'The campaign version no longer exists'; END IF;
  IF source.owner_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'You do not own that campaign ship';
  END IF;

  IF EXISTS (
    SELECT 1 FROM ship_campaign
    WHERE parent_id = source.id AND scenario_id = s.scenario_id AND occupies_slot
  ) THEN
    RAISE EXCEPTION 'This version already has a successor in this scenario';
  END IF;

  -- Family root drives the numeral.
  root_id := source.id;
  walk := source;
  WHILE walk.parent_id IS NOT NULL LOOP
    SELECT * INTO walk FROM ship_campaign WHERE id = walk.parent_id;
    EXIT WHEN NOT FOUND;
    root_id := walk.id;
  END LOOP;

  ship_name := COALESCE(NULLIF(btrim(p_name), ''), source.name);

  IF p_reset_numeral THEN
    new_numeral := 1;
  ELSE
    WITH RECURSIVE family AS (
      SELECT id, numeral AS family_numeral FROM ship_campaign WHERE id = root_id
      UNION ALL
      SELECT c.id, c.numeral FROM ship_campaign c JOIN family f ON c.parent_id = f.id
    )
    SELECT COALESCE(MAX(family_numeral), 1) INTO family_max FROM family;
    new_numeral := family_max + 1;
  END IF;

  display_name := ship_name
    || CASE WHEN new_numeral > 1 THEN ' ' || roman_numeral(new_numeral) ELSE '' END;

  INSERT INTO ship_campaign (
    owner_id, parent_id, name, numeral, scenario_id, scenario_label,
    template_id, serial_number, ship_hp, ship_hp_max, min_hp_attained,
    damage, crew_state, cargo, snapshot, created_by
  ) VALUES (
    source.owner_id, source.id, ship_name, new_numeral, s.scenario_id,
    COALESCE((SELECT name FROM scenarios WHERE id = s.scenario_id), ''),
    s.template_id, s.serial_number,
    p_ship_hp, GREATEST(1, p_ship_hp_max), COALESCE(p_min_hp_attained, p_ship_hp),
    COALESCE(p_box_state, '{}'::jsonb), COALESCE(p_crew_state, '{}'::jsonb),
    COALESCE(p_cargo, '[]'::jsonb), p_snapshot, auth.uid()
  ) RETURNING id INTO new_id;

  UPDATE ship_campaign SET occupies_slot = false, updated_at = now() WHERE id = source.id;

  UPDATE ship_spelljammer
  SET campaign_id = new_id,
      campaign_carrier = true,
      name = display_name,
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
REVOKE ALL ON FUNCTION fork_campaign_version(text, text, jsonb, integer, integer, integer, jsonb, jsonb, jsonb, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fork_campaign_version(text, text, jsonb, integer, integer, integer, jsonb, jsonb, jsonb, boolean) TO authenticated;

NOTIFY pgrst, 'reload schema';
