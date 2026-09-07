-- 077: Effects library (user-authored composite effects).
-- DM/admin author templates; everyone may apply them in scenarios. A template
-- is a name/color/image + a list of primitive modifiers, so one effect can
-- combine stats (Haunted = AC -2 + morale -1) or carry special behaviour kinds
-- (hp_borrow "Sleep", zone dot, entry damage, hex mp_cost). Scenario instances
-- still live on units.effects / map_data.groundEffects and reference templateId.

-- 1. Access matrix extensions (view/use effect editor), mirroring map editor.
ALTER TABLE access_roles ADD COLUMN IF NOT EXISTS can_view_effect_editor BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE access_roles ADD COLUMN IF NOT EXISTS can_use_effect_editor BOOLEAN NOT NULL DEFAULT false;

UPDATE access_roles SET can_view_effect_editor = true, can_use_effect_editor = true WHERE role IN ('admin', 'dm');
UPDATE access_roles SET can_view_effect_editor = true, can_use_effect_editor = false WHERE role NOT IN ('admin', 'dm');

CREATE OR REPLACE FUNCTION user_has_access(permission text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM access_roles ar
    WHERE ar.role = COALESCE((SELECT role FROM profiles WHERE id = auth.uid()), 'pending')
      AND CASE permission
        WHEN 'unit_editor'       THEN ar.can_use_unit_editor
        WHEN 'view_unit_editor'  THEN ar.can_view_unit_editor
        WHEN 'ship_editor'       THEN ar.can_use_ship_editor
        WHEN 'view_ship_editor'  THEN ar.can_view_ship_editor
        WHEN 'map_editor'        THEN ar.can_use_map_editor
        WHEN 'view_map_editor'   THEN ar.can_view_map_editor
        WHEN 'effect_editor'     THEN ar.can_use_effect_editor
        WHEN 'view_effect_editor' THEN ar.can_view_effect_editor
        WHEN 'create_scenario'   THEN ar.can_create_scenario
        WHEN 'join_game'         THEN ar.can_join_game
        WHEN 'view_replay'       THEN ar.can_view_replay
        ELSE false
      END
  );
$$;

REVOKE ALL ON FUNCTION user_has_access(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION user_has_access(text) TO authenticated;

-- 2. The library table.
CREATE TABLE IF NOT EXISTS effect_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  description text NOT NULL DEFAULT '',
  color text NOT NULL DEFAULT '#cccccc',
  image_url text NOT NULL DEFAULT '',
  scope text NOT NULL DEFAULT 'unit' CHECK (scope IN ('unit', 'zone', 'both')),
  magnitude_mode text NOT NULL DEFAULT 'fixed' CHECK (magnitude_mode IN ('fixed', 'caster_input')),
  default_duration integer NOT NULL DEFAULT 3,
  modifiers jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE effect_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "effect_templates_select"
  ON effect_templates FOR SELECT
  TO authenticated
  USING (user_has_access('view_effect_editor'));

CREATE POLICY "effect_templates_insert"
  ON effect_templates FOR INSERT
  TO authenticated
  WITH CHECK (user_has_access('effect_editor'));

CREATE POLICY "effect_templates_update"
  ON effect_templates FOR UPDATE
  TO authenticated
  USING (user_has_access('effect_editor'))
  WITH CHECK (user_has_access('effect_editor'));

CREATE POLICY "effect_templates_delete"
  ON effect_templates FOR DELETE
  TO authenticated
  USING (user_has_access('effect_editor'));

-- 3. Seed: migrate the in-code catalog to library rows, plus composite and
--    special examples. modifier = { kind, delta } where kind is one of
--    ac | morale | movement | dot | hp_borrow | entry | mp_cost.
INSERT INTO effect_templates (name, description, color, scope, magnitude_mode, default_duration, modifiers) VALUES
  ('Bless', '+2 AC', '#ffd54d', 'unit', 'fixed', 3, '[{"kind":"ac","delta":2}]'),
  ('Bane', '-2 AC', '#ff8a65', 'unit', 'fixed', 3, '[{"kind":"ac","delta":-2}]'),
  ('Haste', '+2 movement hexes', '#a5d6a7', 'unit', 'fixed', 3, '[{"kind":"movement","delta":2}]'),
  ('Slow', '-2 movement hexes', '#9e9d24', 'unit', 'fixed', 3, '[{"kind":"movement","delta":-2}]'),
  ('Rally', '+3 morale', '#4fc3f7', 'unit', 'fixed', 3, '[{"kind":"morale","delta":3}]'),
  ('Fear', '-3 morale', '#9575cd', 'unit', 'fixed', 3, '[{"kind":"morale","delta":-3}]'),
  ('Burning', '4 damage each tick', '#ff7043', 'unit', 'fixed', 3, '[{"kind":"dot","delta":4}]'),
  ('Regen', 'heal 4 each tick', '#81c784', 'unit', 'fixed', 3, '[{"kind":"dot","delta":-4}]'),
  ('Haunted', 'Composite: -2 AC and -1 morale', '#b39ddb', 'unit', 'fixed', 3, '[{"kind":"ac","delta":-2},{"kind":"morale","delta":-1}]'),
  ('Sleep', 'Remove X HP now, refund after the caster''s activations (never kills)', '#90caf9', 'unit', 'caster_input', 2, '[{"kind":"hp_borrow","delta":0}]'),
  ('Fire Field', 'Zone: 4 damage per tick to units standing inside', '#ff7043', 'zone', 'fixed', 3, '[{"kind":"dot","delta":4}]'),
  ('Smoke Field', 'Zone: -1 morale and obscures', '#9e9e9e', 'zone', 'fixed', 3, '[{"kind":"morale","delta":-1}]'),
  ('Bog', 'Zone: +2 MP to enter the hex', '#8d6e63', 'zone', 'fixed', 3, '[{"kind":"mp_cost","delta":2}]')
ON CONFLICT (name) DO NOTHING;
