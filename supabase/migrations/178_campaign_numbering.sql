-- 178: Campaign version numbering is server-authoritative.
--
-- The dry dock used to send the numeral it displayed. A wrong family slice made
-- a fork reuse the parent's numeral ("John Doe II" twice). The server now derives
-- the next numeral from the whole family, and a renamed version resets to 1.
--
-- Also adds `renumber_campaign_family`, an owner-only repair that renumbers a
-- family's versions by creation order (1..N) and refreshes the carrier instance
-- names — used to fix families created before this migration. It linearises
-- branches by design (names are display only; numerals are not identity).

CREATE OR REPLACE FUNCTION roman_numeral(p_value integer)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  value integer := GREATEST(0, COALESCE(p_value, 0));
  values integer[] := ARRAY[1000, 900, 500, 400, 100, 90, 50, 40, 10, 9, 5, 4, 1];
  symbols text[] := ARRAY['M', 'CM', 'D', 'CD', 'C', 'XC', 'L', 'XL', 'X', 'IX', 'V', 'IV', 'I'];
  out text := '';
  i integer;
BEGIN
  FOR i IN 1..array_length(values, 1) LOOP
    WHILE value >= values[i] LOOP
      out := out || symbols[i];
      value := value - values[i];
    END LOOP;
  END LOOP;
  RETURN out;
END $$;
REVOKE ALL ON FUNCTION roman_numeral(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION roman_numeral(integer) TO authenticated;

-- Replace the client-numbered fork with a server-numbered one.
DROP FUNCTION IF EXISTS fork_campaign_version(text, text, text, integer, jsonb, integer, integer, integer, jsonb, jsonb, jsonb);

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
  numeral integer;
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
    numeral := 1;
  ELSE
    WITH RECURSIVE family AS (
      SELECT id, numeral FROM ship_campaign WHERE id = root_id
      UNION ALL
      SELECT c.id, c.numeral FROM ship_campaign c JOIN family f ON c.parent_id = f.id
    )
    SELECT COALESCE(MAX(numeral), 1) INTO family_max FROM family;
    numeral := family_max + 1;
  END IF;

  display_name := ship_name || CASE WHEN numeral > 1 THEN ' ' || roman_numeral(numeral) ELSE '' END;

  INSERT INTO ship_campaign (
    owner_id, parent_id, name, numeral, scenario_id, scenario_label,
    template_id, serial_number, ship_hp, ship_hp_max, min_hp_attained,
    damage, crew_state, cargo, snapshot, created_by
  ) VALUES (
    source.owner_id, source.id, ship_name, numeral, s.scenario_id,
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

-- Owner-only repair: renumber a family by creation order and refresh map names.
CREATE OR REPLACE FUNCTION renumber_campaign_family(p_campaign_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  start record;
  walk record;
  root_id uuid;
  root_owner uuid;
  fam record;
  n integer := 0;
  display_name text;
BEGIN
  SELECT * INTO start FROM ship_campaign WHERE id = p_campaign_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Campaign ship not found'; END IF;

  root_id := start.id;
  walk := start;
  WHILE walk.parent_id IS NOT NULL LOOP
    SELECT * INTO walk FROM ship_campaign WHERE id = walk.parent_id;
    EXIT WHEN NOT FOUND;
    root_id := walk.id;
  END LOOP;

  SELECT owner_id INTO root_owner FROM ship_campaign WHERE id = root_id;
  IF root_owner IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Only the owner can renumber this family';
  END IF;

  FOR fam IN
    WITH RECURSIVE family AS (
      SELECT id, name, created_at FROM ship_campaign WHERE id = root_id
      UNION ALL
      SELECT c.id, c.name, c.created_at FROM ship_campaign c JOIN family f ON c.parent_id = f.id
    )
    SELECT id, name FROM family ORDER BY created_at, id
  LOOP
    n := n + 1;
    UPDATE ship_campaign SET numeral = n, updated_at = now() WHERE id = fam.id;
    display_name := fam.name || CASE WHEN n > 1 THEN ' ' || roman_numeral(n) ELSE '' END;
    UPDATE ship_spelljammer
    SET name = display_name, updated_at = now()
    WHERE campaign_id = fam.id AND campaign_carrier AND is_deleted = false;
  END LOOP;

  RETURN n;
END $$;
REVOKE ALL ON FUNCTION renumber_campaign_family(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION renumber_campaign_family(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
