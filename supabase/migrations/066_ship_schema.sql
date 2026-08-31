-- 066: Spelljammer ship schema (all ship_ prefixed so the tables stay grouped).
-- Design contract: .scratch/spelljammer-mod/spec.md (v8.1 FINAL) + .scratch/shipyard-formula/shipyard.csv.
-- Tables: ship_frames, ship_armors, ship_components, ship_accessories, ship_weapons,
--         ship_templates (+ accessory/weapon joins), spelljammer_ships (scenario instances).

-- Frames: mass cap / base HP / deck squares / top speed / max rudders / base cost / hull spaces.
CREATE TABLE IF NOT EXISTS ship_frames (
  id          text PRIMARY KEY,
  mass_cap    numeric NOT NULL,
  base_hp     integer NOT NULL,
  deck_space  integer NOT NULL,
  top_speed   integer NOT NULL,
  max_rudders integer NOT NULL,
  base_cost   integer NOT NULL,
  hull_spaces integer NOT NULL
);

-- Armors: mass factor (eats capacity) / AC / box HP / cost multiplier.
CREATE TABLE IF NOT EXISTS ship_armors (
  id          text PRIMARY KEY,
  mass_factor numeric NOT NULL,
  ac          integer NOT NULL,
  box_hp      integer NOT NULL,
  cost_mult   numeric NOT NULL
);

-- Components: mass / deck / crew / cost / reinforcement order (null = never) / hittable.
CREATE TABLE IF NOT EXISTS ship_components (
  id              text PRIMARY KEY,
  mass            numeric NOT NULL,
  deck            numeric NOT NULL DEFAULT 0,
  crew            numeric NOT NULL DEFAULT 0,
  cost            integer NOT NULL DEFAULT 0,
  reinforce_order integer,
  hittable        boolean NOT NULL DEFAULT true
);

-- Accessories (specials): pool type drives hit-box pool.
--   pool_type: 'mass_x_boxhp' | 'small_anchor' | 'safe' | 'none'
CREATE TABLE IF NOT EXISTS ship_accessories (
  id        text PRIMARY KEY,
  mass      numeric NOT NULL DEFAULT 0,
  deck      numeric NOT NULL DEFAULT 0,
  crew      numeric NOT NULL DEFAULT 0,
  cost      integer NOT NULL DEFAULT 0,
  pool_type text NOT NULL DEFAULT 'mass_x_boxhp',
  hittable  boolean NOT NULL DEFAULT true,
  effect    text
);

-- Weapons: mount (small/large/special), damage, range, Fire Cycle (once per N rounds), crew, cost.
CREATE TABLE IF NOT EXISTS ship_weapons (
  id             text PRIMARY KEY,
  mount          text NOT NULL,             -- 'small' | 'large' | 'special'
  damage         text NOT NULL,
  range_std      integer NOT NULL,
  range_dis      integer,
  fire_cycle_rd  integer NOT NULL,          -- fires once per N rounds (load N-1, fire on N)
  crew           numeric NOT NULL DEFAULT 1,
  cost           integer NOT NULL DEFAULT 0,
  ammo_cost      integer,
  special        text
);

-- Templates: the 18 presets + user builds.
CREATE TABLE IF NOT EXISTS ship_templates (
  id               text PRIMARY KEY,
  name             text NOT NULL,
  role             text,
  frame_id         text NOT NULL REFERENCES ship_frames(id),
  armor_id         text NOT NULL REFERENCES ship_armors(id),
  atmosphere_speed integer NOT NULL,        -- authored (given, not calculated)
  rudders          integer NOT NULL DEFAULT 0,
  sails            integer NOT NULL DEFAULT 0,
  l_weap           integer NOT NULL DEFAULT 0,
  s_weap           integer NOT NULL DEFAULT 0,
  hull_r           integer NOT NULL DEFAULT 0,
  bridge           integer NOT NULL DEFAULT 0,
  aux_helm         integer NOT NULL DEFAULT 0,
  extra_crew       numeric NOT NULL DEFAULT 0,
  cargo_area       integer NOT NULL DEFAULT 0,  -- designated load (tons)
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ship_template_accessories (
  template_id  text NOT NULL REFERENCES ship_templates(id) ON DELETE CASCADE,
  accessory_id text NOT NULL REFERENCES ship_accessories(id),
  count        integer NOT NULL DEFAULT 1,
  PRIMARY KEY (template_id, accessory_id)
);

CREATE TABLE IF NOT EXISTS ship_template_weapons (
  template_id text NOT NULL REFERENCES ship_templates(id) ON DELETE CASCADE,
  weapon_id   text NOT NULL REFERENCES ship_weapons(id),
  mount_slot  text,                          -- e.g. 'fore', 'side', 'rear', '360', 'X-quadrant'
  count       integer NOT NULL DEFAULT 1,
  PRIMARY KEY (template_id, weapon_id, mount_slot)
);

-- Scenario instances (scenarioMap ships). Mirrors units; per-subsystem box-pool state in box_state.
CREATE TABLE IF NOT EXISTS spelljammer_ships (
  id               text PRIMARY KEY,
  scenario_id      uuid NOT NULL REFERENCES scenarios(id) ON DELETE CASCADE,
  template_id      text REFERENCES ship_templates(id),
  name             text NOT NULL,
  team             text,
  hex              text,
  facing           integer NOT NULL DEFAULT 0,
  speed_stat       numeric NOT NULL DEFAULT 0,
  ship_hp          integer NOT NULL,
  ship_hp_max      integer NOT NULL,
  loaded_cargo     numeric NOT NULL DEFAULT 0,
  crew_assigned    jsonb NOT NULL DEFAULT '{}',  -- station -> crew count
  box_state        jsonb NOT NULL DEFAULT '{}',  -- subsystem key -> {pool_hp, destroyed}
  attached_to_ship text,                        -- heroes attach via existing attach mechanism
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_spelljammer_ships_scenario ON spelljammer_ships(scenario_id);
CREATE INDEX IF NOT EXISTS idx_ship_templates_frame ON ship_templates(frame_id);
