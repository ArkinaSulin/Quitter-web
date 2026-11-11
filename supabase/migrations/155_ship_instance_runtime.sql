-- 155: `ship_spelljammer` runtime instance columns.
--
-- The table is the scenario map instance (one row per placed ship). At
-- placement the client snapshots the resolved template build into `snapshot`,
-- so later template edits do not mutate a placed ship. The remaining columns
-- hold per-step/speed/facing/station/crew/reload state for the runtime engine.

ALTER TABLE ship_spelljammer ADD COLUMN IF NOT EXISTS snapshot jsonb NOT NULL DEFAULT '{}';
ALTER TABLE ship_spelljammer ADD COLUMN IF NOT EXISTS elevation integer NOT NULL DEFAULT 0;
ALTER TABLE ship_spelljammer ADD COLUMN IF NOT EXISTS last_speed integer NOT NULL DEFAULT 5;
ALTER TABLE ship_spelljammer ADD COLUMN IF NOT EXISTS declared_speed integer NOT NULL DEFAULT 0;
ALTER TABLE ship_spelljammer ADD COLUMN IF NOT EXISTS speed_spent integer NOT NULL DEFAULT 0;
ALTER TABLE ship_spelljammer ADD COLUMN IF NOT EXISTS turns_since_facing integer NOT NULL DEFAULT 0;
ALTER TABLE ship_spelljammer ADD COLUMN IF NOT EXISTS step_budget jsonb NOT NULL DEFAULT '[0,0,0,0,0]';
ALTER TABLE ship_spelljammer ADD COLUMN IF NOT EXISTS stations jsonb NOT NULL DEFAULT '{}';
ALTER TABLE ship_spelljammer ADD COLUMN IF NOT EXISTS crew_state jsonb NOT NULL DEFAULT '{}';
ALTER TABLE ship_spelljammer ADD COLUMN IF NOT EXISTS reload jsonb NOT NULL DEFAULT '{}';
ALTER TABLE ship_spelljammer ADD COLUMN IF NOT EXISTS weapon_state jsonb NOT NULL DEFAULT '{}';
ALTER TABLE ship_spelljammer ADD COLUMN IF NOT EXISTS image_url text;
ALTER TABLE ship_spelljammer ADD COLUMN IF NOT EXISTS keel_length numeric NOT NULL DEFAULT 100;
ALTER TABLE ship_spelljammer ADD COLUMN IF NOT EXISTS image_offset_y numeric NOT NULL DEFAULT 0;
ALTER TABLE ship_spelljammer ADD COLUMN IF NOT EXISTS is_deleted boolean NOT NULL DEFAULT false;
ALTER TABLE ship_spelljammer ADD COLUMN IF NOT EXISTS command_seq bigint NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_ship_spelljammer_scenario_live
  ON ship_spelljammer(scenario_id) WHERE is_deleted = false;
