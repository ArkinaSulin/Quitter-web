-- 093: Map structure templates — authorable map features (walls, spikes, gates,
-- towers). A structure template is the authored *type*; instances live on the map
-- layers (maps.structures / scenarios.map_data.structures) and reference the
-- template id, exactly like weapons/effects split authored vs placed.
--
-- Edge structures (anchor 'edge') carry two directional faces: face A = INSIDE,
-- face B = OUTSIDE. The placement's `outside` flip maps them onto the canonical
-- edge sides and also decides which side the battlement (crenellation) draws on.
-- Hex structures (anchor 'hex') carry a movement cost and an optional destructible
-- DOOR (door_hp NULL = no door; the door is gated by the template DT and resolves
-- door-first, then the structure HP). Effect behaviour (tower auras, entry damage,
-- the reusable `enter_org_max` gate) rides the `modifiers` list.
--
-- This migration is additive: it only adds caps + the library table. Scenario
-- instances, movement/combat consumption and the wall unification land later.

-- 1. Access matrix extensions (view/use structure editor), mirroring the others.
ALTER TABLE access_roles ADD COLUMN IF NOT EXISTS can_view_structure_editor BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE access_roles ADD COLUMN IF NOT EXISTS can_use_structure_editor BOOLEAN NOT NULL DEFAULT false;

UPDATE access_roles SET can_view_structure_editor = true, can_use_structure_editor = true WHERE role IN ('admin', 'dm');
UPDATE access_roles SET can_view_structure_editor = true, can_use_structure_editor = false WHERE role NOT IN ('admin', 'dm');

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
        WHEN 'weapon_editor'     THEN ar.can_use_weapon_editor
        WHEN 'view_weapon_editor' THEN ar.can_view_weapon_editor
        WHEN 'structure_editor'  THEN ar.can_use_structure_editor
        WHEN 'view_structure_editor' THEN ar.can_view_structure_editor
        WHEN 'create_scenario'   THEN ar.can_create_scenario
        WHEN 'join_game'         THEN ar.can_join_game
        WHEN 'view_replay'       THEN ar.can_view_replay
        ELSE false
      END
  );
$$;

REVOKE ALL ON FUNCTION user_has_access(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION user_has_access(text) TO authenticated;

-- 2. The structure library table.
CREATE TABLE IF NOT EXISTS map_structure_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  description text NOT NULL DEFAULT '',
  anchor text NOT NULL CHECK (anchor IN ('edge', 'hex')),
  color text NOT NULL DEFAULT '#cccccc',
  image_url text NOT NULL DEFAULT '',
  -- Edge: draw crenellations on the outside face.
  battlement boolean NOT NULL DEFAULT false,
  -- Edge faces: A = inside, B = outside. NULL = normal terrain / no AC.
  edge_a_block boolean NOT NULL DEFAULT false,
  edge_a_move_cost integer,
  edge_a_melee_ac integer,
  edge_a_ranged_ac integer,
  edge_b_block boolean NOT NULL DEFAULT false,
  edge_b_move_cost integer,
  edge_b_melee_ac integer,
  edge_b_ranged_ac integer,
  -- Hex: extra MP to enter; NULL = normal.
  hex_move_cost integer,
  -- Hex: destructible door pool (NULL = no door). Gated by the template DT and
  -- resolved door-first, then the structure HP.
  door_hp integer,
  -- Durability: 30/15 by default (a random trooper cannot push a wall down).
  max_hp integer NOT NULL DEFAULT 30,
  dt integer NOT NULL DEFAULT 15,
  -- EffectModifier[] — tower auras (advantage / grant_disadvantage), entry
  -- damage, the reusable `enter_org_max` gate, etc.
  modifiers jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE map_structure_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "map_structure_templates_select" ON map_structure_templates;
CREATE POLICY "map_structure_templates_select"
  ON map_structure_templates FOR SELECT TO authenticated
  USING (user_has_access('view_structure_editor'));

DROP POLICY IF EXISTS "map_structure_templates_insert" ON map_structure_templates;
CREATE POLICY "map_structure_templates_insert"
  ON map_structure_templates FOR INSERT TO authenticated
  WITH CHECK (user_has_access('structure_editor'));

DROP POLICY IF EXISTS "map_structure_templates_update" ON map_structure_templates;
CREATE POLICY "map_structure_templates_update"
  ON map_structure_templates FOR UPDATE TO authenticated
  USING (user_has_access('structure_editor'))
  WITH CHECK (user_has_access('structure_editor'));

DROP POLICY IF EXISTS "map_structure_templates_delete" ON map_structure_templates;
CREATE POLICY "map_structure_templates_delete"
  ON map_structure_templates FOR DELETE TO authenticated
  USING (user_has_access('structure_editor'));

-- 3. Starter templates (editable in the Structure Editor). Wood DT 15 / stone
-- DT 20; stone walls are tougher; gate towers house a 30 HP door.
INSERT INTO map_structure_templates
  (name, description, anchor, color, battlement,
   edge_a_block, edge_a_move_cost, edge_a_melee_ac, edge_a_ranged_ac,
   edge_b_block, edge_b_move_cost, edge_b_melee_ac, edge_b_ranged_ac,
   hex_move_cost, door_hp, max_hp, dt, modifiers)
VALUES
  ('Archer Spikes', 'Low stakes that only loose troops can cross.', 'edge', '#a1887f', false,
   false, 2, NULL, NULL, false, 2, NULL, NULL,
   NULL, NULL, 30, 15, '[{"kind":"enter_org_max","delta":1}]'),
  ('Wood Wall', 'Wooden barrier. Blocks movement, grants cover.', 'edge', '#c49a58', true,
   true, NULL, 2, 2, true, NULL, 2, 2,
   NULL, NULL, 30, 15, '[]'),
  ('Stone Wall', 'Stone barrier. Blocks movement, grants cover.', 'edge', '#b0bec5', true,
   true, NULL, 3, 3, true, NULL, 3, 3,
   NULL, NULL, 60, 20, '[]'),
  ('Wood Gate', 'Wooden gate. Costs extra MP to pass until broken.', 'hex', '#c49a58', false,
   false, NULL, NULL, NULL, false, NULL, NULL, NULL,
   2, NULL, 30, 15, '[]'),
  ('Stone Gate', 'Stone gate. Costs extra MP to pass until broken.', 'hex', '#b0bec5', false,
   false, NULL, NULL, NULL, false, NULL, NULL, NULL,
   2, NULL, 30, 20, '[]'),
  ('Wood Gate Tower', 'Gate tower with a 30 HP door; the tower outlasts it.', 'hex', '#a1887f', false,
   false, NULL, NULL, NULL, false, NULL, NULL, NULL,
   2, 30, 100, 15, '[]'),
  ('Stone Gate Tower', 'Stone gate tower with a 30 HP door.', 'hex', '#90a4ae', false,
   false, NULL, NULL, NULL, false, NULL, NULL, NULL,
   2, 30, 100, 20, '[]'),
  ('Wood Watch Tower', 'Occupant shoots from above (advantage); attackers are exposed.', 'hex', '#8d6e63', false,
   false, NULL, NULL, NULL, false, NULL, NULL, NULL,
   2, NULL, 100, 15, '[{"kind":"advantage","delta":0},{"kind":"grant_disadvantage","delta":0}]'),
  ('Stone Watch Tower', 'Stone watch tower; occupant shoots from above.', 'hex', '#78909c', false,
   false, NULL, NULL, NULL, false, NULL, NULL, NULL,
   2, NULL, 100, 20, '[{"kind":"advantage","delta":0},{"kind":"grant_disadvantage","delta":0}]')
ON CONFLICT (name) DO NOTHING;
