-- 042: Move more hard-coded game-balance constants into `settings`.
-- Each key below was a magic number in code; the client now reads it via
-- getSetting/getBandSetting with a code fallback that matches these seeds, so the
-- DB row is the source of truth once this migration is applied.
--
-- Threat increment by SIZE is intentionally NOT a setting — the code keeps
-- `(sizeCategory / 100) ** 2`.

INSERT INTO settings (key, value, description) VALUES
  ('hero_attack_split',                  '0.3'::jsonb, 'Fraction of a strike''s attacks directed at a front-attached hero'),
  ('actions_per_turn',                   '2'::jsonb,   'Actions a unit starts each turn with'),
  ('turn_start_mp',                      '0'::jsonb,   'MP a unit starts each turn with'),
  ('formation_change_cost_per_step',     '2'::jsonb,   'MP per organization-level step when changing formation'),
  ('charge_full_distance',               '2'::jsonb,   'Hexes moved to qualify as a full charge (free attack)'),
  ('hero_attach_max_size',               '200'::jsonb, 'Max size_category a hero may attach to'),
  ('wounds_morale_factor',               '10'::jsonb,  'Wounds penalty = -floor((1 - hp%) * factor)'),
  ('isolation_penalty',                  '1'::jsonb,   'Morale penalty when a unit is isolated'),
  ('charging_threat_multiplier',         '2'::jsonb,   'Threat-rating multiplier while charging'),
  ('threat_increment_level',
   '[{"min":19,"value":6},{"min":13,"value":5},{"min":8,"value":4},{"min":5,"value":3},{"min":3,"value":2},{"min":2,"value":1},{"min":0,"value":0}]'::jsonb,
   'Threat rating by level bands (highest-min first)'),
  ('threat_increment_troop_count',
   '[{"min":50,"value":4},{"min":20,"value":3},{"min":10,"value":2},{"min":5,"value":1},{"min":0,"value":0}]'::jsonb,
   'Threat rating by current troop-count bands (highest-min first)'),
  ('row_capacity_by_size',
   '[{"min":400,"value":1},{"min":300,"value":2},{"min":200,"value":5},{"min":0,"value":10}]'::jsonb,
   'Fallback row capacity by size_category (size_categories table takes precedence)')
ON CONFLICT (key) DO NOTHING;
