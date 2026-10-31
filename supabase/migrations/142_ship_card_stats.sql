-- 142: Ship component/weapon DT + forward-compatible card placements.
--
-- Components and weapons each carry their own damage threshold. Ship templates
-- store card positions for the future 3x9 deck (key -> cell) and the set of cards
-- carrying a reinforcement.

ALTER TABLE ship_components ADD COLUMN IF NOT EXISTS dt integer NOT NULL DEFAULT 15;
ALTER TABLE ship_weapons ADD COLUMN IF NOT EXISTS dt integer NOT NULL DEFAULT 15;

ALTER TABLE ship_templates ADD COLUMN IF NOT EXISTS card_placements jsonb NOT NULL DEFAULT '{}';
ALTER TABLE ship_templates ADD COLUMN IF NOT EXISTS reinforcements jsonb NOT NULL DEFAULT '[]';
