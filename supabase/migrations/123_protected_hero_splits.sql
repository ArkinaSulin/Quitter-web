-- 123: Protected (back-attached) hero ranged share.
--
-- protected_hero_range_split: share of a strike's attacks that reach a
-- back-attached (Protected) hero when the host is hit by RANGED fire. Melee from
-- the host's rear arc uses the existing `hero_attack_split` (0.3, same as a
-- front/Leader hero), and frontal/flank melee cannot reach the protected hero at
-- all. Read via getSetting('protected_hero_range_split', 0.1); the code fallback
-- matches this seed.
INSERT INTO admin_game_settings (key, value, description) VALUES
  ('protected_hero_range_split', '0.1'::jsonb, 'Fraction of a RANGED strike''s attacks directed at a back-attached (Protected) hero; rear melee uses hero_attack_split')
ON CONFLICT (key) DO UPDATE SET
  value = EXCLUDED.value,
  description = EXCLUDED.description;
