-- 106: Mounted-pair attack split.
--
-- mount_main_attack_split: when attacking a mounted pair (a hero riding a larger
-- hero), the attacker picks the MAIN target and that target takes this fraction
-- of the volley (the other takes the remainder). Read via
-- getSetting('mount_main_attack_split', 0.7); the code fallback matches this seed.
INSERT INTO admin_game_settings (key, value, description) VALUES
  ('mount_main_attack_split', '0.7'::jsonb, 'Fraction of attacks aimed at the chosen main target of a mounted pair (rider vs mount)')
ON CONFLICT (key) DO UPDATE SET
  value = EXCLUDED.value,
  description = EXCLUDED.description;
