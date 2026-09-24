-- 099: Structure template rework — direction-relative, locomotion-aware movement,
-- two-pool durability (door + structure), and one mode-scoped modifier list.
--
-- Replaces the authored A/B faces + hex_move_cost with:
--   * mp_foot_in/out, mp_mounted_in/out — MP to cross (replaces terrain cost);
--     NULL = fall back to terrain; NEGATIVE = hard block for that locomotion.
--     _in = outside->inside, _out = inside->outside (hex uses _in only).
--   * door_hp — the door's pool. Passage is gated by door_hp (0 = passable);
--     NULL means "no explicit door" and the app defaults it to max_hp so a
--     freshly authored barrier allows no free passage. 0 <= door_hp <= max_hp.
--   * max_hp — the structure's pool. <= 0 = destroyed (instance removed).
--     Damage applies to door_hp AND max_hp simultaneously.
--   * modifiers — one jsonb list; per-entry `mode: 'melee' | 'ranged'` (absent =
--     both) scopes ac / advantage / disadvantage / grant_* to the attack distance.
--     `enter_org_max` (pass-through gate) and `range` (occupant aura) ignore mode.
--
-- The old face/hex columns and all placed instances are dropped (owner decision);
-- the 9 preset templates are reseeded in the new shape.

ALTER TABLE map_structure_templates
  DROP COLUMN IF EXISTS edge_a_block,
  DROP COLUMN IF EXISTS edge_a_move_cost,
  DROP COLUMN IF EXISTS edge_a_melee_ac,
  DROP COLUMN IF EXISTS edge_a_ranged_ac,
  DROP COLUMN IF EXISTS edge_b_block,
  DROP COLUMN IF EXISTS edge_b_move_cost,
  DROP COLUMN IF EXISTS edge_b_melee_ac,
  DROP COLUMN IF EXISTS edge_b_ranged_ac,
  DROP COLUMN IF EXISTS hex_move_cost,
  ADD COLUMN IF NOT EXISTS mp_foot_in integer,
  ADD COLUMN IF NOT EXISTS mp_foot_out integer,
  ADD COLUMN IF NOT EXISTS mp_mounted_in integer,
  ADD COLUMN IF NOT EXISTS mp_mounted_out integer;

-- door_hp stays nullable (NULL = no explicit door -> app defaults to max_hp).
ALTER TABLE map_structure_templates
  DROP CONSTRAINT IF EXISTS map_structure_templates_door_le_max;
ALTER TABLE map_structure_templates
  ADD CONSTRAINT map_structure_templates_door_le_max
  CHECK (door_hp IS NULL OR door_hp <= max_hp);

-- Wipe every placed instance (library boards + scenario snapshots).
UPDATE maps SET structures = '{}'::jsonb;
UPDATE scenarios
  SET map_data = jsonb_set(COALESCE(map_data, '{}'::jsonb), '{structures}', '{}'::jsonb, true)
  WHERE map_data ? 'structures';

-- Reseed the preset templates in the new shape.
DELETE FROM map_structure_templates;

INSERT INTO map_structure_templates
  (name, description, anchor, color, battlement, spikes,
   mp_foot_in, mp_foot_out, mp_mounted_in, mp_mounted_out,
   door_hp, max_hp, dt, modifiers)
VALUES
  ('Archer''s Stake', 'Low stakes only loose troops can cross.', 'edge', '#a1887f', false, true,
   2, 2, -1, -1, 0, 30, 15, '[{"kind":"enter_org_max","delta":1}]'),
  ('Wood Wall', 'Wooden barrier. Must be destroyed to pass; grants cover.', 'edge', '#c49a58', true, false,
   NULL, NULL, NULL, NULL, 30, 30, 15,
   '[{"kind":"ac","delta":2,"mode":"melee"},{"kind":"ac","delta":2,"mode":"ranged"}]'),
  ('Stone Wall', 'Stone barrier. Must be destroyed to pass; grants cover.', 'edge', '#b0bec5', true, false,
   NULL, NULL, NULL, NULL, 60, 60, 20,
   '[{"kind":"ac","delta":3,"mode":"melee"},{"kind":"ac","delta":3,"mode":"ranged"}]'),
  ('Wood Gate', 'Wooden gate. Costs extra MP to pass.', 'hex', '#c49a58', false, false,
   2, NULL, -1, NULL, 0, 30, 15, '[]'),
  ('Stone Gate', 'Stone gate. Costs extra MP to pass.', 'hex', '#b0bec5', false, false,
   2, NULL, -1, NULL, 0, 30, 20, '[]'),
  ('Wood Gate Tower', 'Gate tower with a 30 HP door; the tower outlasts it.', 'hex', '#a1887f', false, false,
   2, NULL, -1, NULL, 30, 100, 15, '[]'),
  ('Stone Gate Tower', 'Stone gate tower with a 30 HP door.', 'hex', '#90a4ae', false, false,
   2, NULL, -1, NULL, 30, 100, 20, '[]'),
  ('Wood Watch Tower', 'Occupant shoots from above (advantage); attackers are exposed.', 'hex', '#8d6e63', false, false,
   2, NULL, -1, NULL, 0, 100, 15,
   '[{"kind":"advantage","delta":0},{"kind":"grant_disadvantage","delta":0}]'),
  ('Stone Watch Tower', 'Stone watch tower; occupant shoots from above.', 'hex', '#78909c', false, false,
   2, NULL, -1, NULL, 0, 100, 20,
   '[{"kind":"advantage","delta":0},{"kind":"grant_disadvantage","delta":0}]');
