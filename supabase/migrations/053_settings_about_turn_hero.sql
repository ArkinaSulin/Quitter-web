-- 053: about-turn costs + hero combat troop cap.
--
-- about_turn_cost_foot/mounted: MP charged for a 180° about-turn (mounted units
-- pay more; free for Hero/Scattered/free-move). about_turn_org_penalty: org
-- levels lost on an about-turn (1 = drop one formation level).
-- hero_combat_capacity: fraction (decimal, 0.5 = 50%) of a unit's eligible
-- troops able to strike a hero — applied when a unit attacks a lone hero, or
-- when a hero (lone or front-attached) attacks a unit and that unit retaliates.

INSERT INTO settings (key, value, description) VALUES
  ('about_turn_cost_foot',    '1'::jsonb, 'MP for a 180° about-turn (infantry)'),
  ('about_turn_cost_mounted', '2'::jsonb, 'MP for a 180° about-turn (mounted)'),
  ('about_turn_org_penalty',  '1'::jsonb, 'Org levels lost on a 180° about-turn'),
  ('hero_combat_capacity',    '0.5'::jsonb, 'Fraction of a unit''s troops able to strike a hero (decimal, 0.5 = 50%)')
ON CONFLICT (key) DO UPDATE SET
  value = EXCLUDED.value,
  description = EXCLUDED.description;
