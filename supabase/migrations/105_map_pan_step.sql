-- 105: WASD map panning step.
--
-- map_pan_step: screen pixels the map pans per WASD keypress (key-repeat gives
-- continuous panning). Read via getSetting('map_pan_step', 6); the code fallback
-- matches this seed so behavior is correct before the row is applied.
INSERT INTO admin_game_settings (key, value, description) VALUES
  ('map_pan_step', '6'::jsonb, 'Screen pixels the map pans per WASD keypress')
ON CONFLICT (key) DO UPDATE SET
  value = EXCLUDED.value,
  description = EXCLUDED.description;
