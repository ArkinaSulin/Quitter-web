-- 088_advantage_effects.sql
-- Seed the four attack-roll flag effects into the effect library. They carry no
-- amount/dice/save — the `advantage`/`disadvantage` kinds modify the CARRIER's own
-- attack rolls, `grant_advantage`/`grant_disadvantage` modify the rolls of anyone
-- ATTACKING the carrier. Scope 'both' so the DM can apply them to a unit or paint
-- them as a ground zone (any unit standing in the hex). D&D 5e: any advantage
-- cancels any disadvantage (and the long-range band) back to a normal roll.
INSERT INTO effect_templates (name, description, color, scope, default_duration, modifiers) VALUES
  ('Advantage', 'Advantage on the carrier''s own attack rolls (roll 2d20, take higher)', '#b2ff59', 'both', 3, '[{"kind":"advantage","delta":0}]'),
  ('Disadvantage', 'Disadvantage on the carrier''s own attack rolls (roll 2d20, take lower)', '#ff8a80', 'both', 3, '[{"kind":"disadvantage","delta":0}]'),
  ('Grant Advantage', 'Anyone attacking the carrier gains advantage', '#69f0ae', 'both', 3, '[{"kind":"grant_advantage","delta":0}]'),
  ('Grant Disadvantage', 'Anyone attacking the carrier suffers disadvantage', '#ff5252', 'both', 3, '[{"kind":"grant_disadvantage","delta":0}]')
ON CONFLICT (name) DO NOTHING;
