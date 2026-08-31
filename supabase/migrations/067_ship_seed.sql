-- 067: Spelljammer ship seed data (v8.1 FINAL).
-- Source: .scratch/shipyard-formula/shipyard.csv + author's working file (Quiver ship analytic temp - spelljammer AI 8.1.csv).
-- Idempotent (ON CONFLICT DO NOTHING). Weapon assignments per mount slot happen in the Shipyard builder.

INSERT INTO ship_frames (id, mass_cap, base_hp, deck_space, top_speed, max_rudders, base_cost, hull_spaces) VALUES
  ('tiny',   35, 200, 10, 12, 2, 5000,  8),
  ('small',  55, 250, 30, 11, 3, 15000, 10),
  ('medium', 80, 350, 50, 10, 4, 35000, 14),
  ('large', 100, 500, 90,  9, 5, 60000, 20)
ON CONFLICT (id) DO NOTHING;

INSERT INTO ship_armors (id, mass_factor, ac, box_hp, cost_mult) VALUES
  ('wood',    0.0, 15, 5, 1),
  ('plated',  0.2, 17, 6, 2),
  ('metal',   0.4, 19, 7, 4),
  ('ceramic', 0.1, 13, 6, 3),
  ('stone',   0.5, 17, 8, 1)
ON CONFLICT (id) DO NOTHING;

INSERT INTO ship_components (id, mass, deck, crew, cost, reinforce_order, hittable) VALUES
  ('helm_bridge',     2, 6, 1,   0, 1,    true),
  ('aux_helm',        2, 6, 1, 3000, 3,    true),
  ('sail',            2, 0, 0.5, 2000, NULL, true),
  ('rudder',          2, 0, 1, 3000, 5,    true),
  ('l_weap',          4, 6, 1, 4000, 4,    true),
  ('s_weap',          2, 4, 1, 2000, 6,    true),
  ('hull_r',          1, 0, 0, 1000, NULL, false),
  ('crew_quarters',   1, 1, 5,   0, NULL, true),
  ('command_bridge',  2, 8, 2, 6000, 2,    true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO ship_accessories (id, mass, deck, crew, cost, pool_type, hittable, effect) VALUES
  ('watertight_hull',   5, 5, 0,     0, 'mass_x_boxhp', false, 'Water + Underwater travel (safe hull plating)'),
  ('ram',               5, 2, 0,  5000, 'mass_x_boxhp', true,  '16d10 ram; attacker takes 1/2 damage'),
  ('grappling_jaws',    2, 2, 0,     0, 'mass_x_boxhp', true,  '4d10 melee (Lamprey)'),
  ('tentacles',         3, 4, 0,  4000, 'mass_x_boxhp', true,  '4d10/teleport melee, reach 3 forward hexes'),
  ('bombard_mount',    40, 4, 0, 80000, 'mass_x_boxhp', true,  'Siege cannon (16d10, cycle 600), DT flat'),
  ('magazine',          2, 0, 0,  6000, 'mass_x_boxhp', true,  'Ammo store'),
  ('smoke_sac',         1, 1, 0,  2000, 'mass_x_boxhp', true,  'Reaction smoke overlay, AC+2'),
  ('living_treant',     2, 0, 0, 50000, 'mass_x_boxhp', true,  'Regenerate 2d8/rd on water; replaces 9 crew'),
  ('hover_device',      2, 4, 0, 60000, 'mass_x_boxhp', true,  'Rotate in place at any speed (MC 3 always); NOT for sale'),
  ('scorpion_claws',    2, 2, 0,     0, 'small_anchor',  true,  'Land travel + 3d10 melee (2 claws)'),
  ('eyestalk_cannons',  2, 4, 0,     0, 'small_anchor',  true,  '10d6, Beholder concentration / Destructive Ray'),
  ('grappling_legs',    2, 2, 0,     0, 'mass_x_boxhp',  true,  'Grappling legs (Nightspider)'),
  ('low_visibility',    0, 0, 0,  2000, 'none',          false, 'Magic - surprise + double speed round 1 (no hit box)'),
  ('air_envelope',      0, 0, 0,     0, 'none',          false, 'Air - spelljammer physics (no hit box)'),
  ('planar_device',     4, 4, 0, 60000, 'mass_x_boxhp',  true,  'Plane travel (narrative)')
ON CONFLICT (id) DO NOTHING;

INSERT INTO ship_weapons (id, mount, damage, range_std, range_dis, fire_cycle_rd, crew, cost, ammo_cost, special) VALUES
  ('ballista_light',    'small',   '2d10',      3, 10,   2, 2,  500,  1,    'ammo 1gp'),
  ('ballista_medium',   'small',   '3d10',      3, 10,   3, 2,  600,  1,    'ammo 1gp'),
  ('ballista_heavy',    'small',   '4d8',       3, 10,   3, 2,  800,  1,    'ammo 1gp'),
  ('gnomish_sweeper',   'small',   '2d8',       4, 12,   1, 3,  800,  NULL, 'chain breaks on nat 1-2 (10%), weapon 0 HP'),
  ('gnomish_boilerdrak','small',   '5d10',      2, NULL, 3, 2,  2500, NULL, 'fire; misfire nat 1 (5%) explodes 5d10'),
  ('swivel_solid',      'small',   '2d10',      1, 3,    2, 1,  3000, NULL, NULL),
  ('swivel_grape',      'small',   '4d6',       1, 2,    2, 1,  3000, NULL, NULL),
  ('giff_gun',          'small',   '4d10',      4, 12, 600, 1,  500,  NULL, 'disposable - one time use'),
  ('cannon',            'small',   '6d10',      5, 15,  10, 4,  7500, 150,  '10x10 area; crit 19-20; misfire nat1 5% explodes 6d10'),
  ('accelerator',       'small',   '2d10',      4, 12,   1, 1, 45000, NULL, NULL),
  ('mangonel',          'small',   '5d6',       4, 12,   5, 5,  600,  NULL, 'min range 2; boulder 1/20t'),
  ('psicannon_low',     'small',   '3d10',      2, 6,    3, 2, 25000, NULL, 'force'),
  ('catapult_medium',   'large',   '5d10',      4, 16,   5, 4,  800,  NULL, 'min range 2; 1/15t'),
  ('catapult_heavy',    'large',   '6d10',      4, 16,   5, 4,  1000, NULL, 'min range 2; 1/10t'),
  ('cannon_heavy',      'large',   '8d10',     12, 48,  20, 4, 15000, NULL, 'crit 19-20; misfire 10d10'),
  ('lightning_cannon',  'large',   '4d10/10',   5, 24,   3, 1,  3500, NULL, 'misfire nat1 5% 4d10; overheat on 1 -> 1hr cool'),
  ('psicannon_med',     'large',   '5d10',      4, 12,   5, 4, 25000, NULL, 'force'),
  ('psicannon_high',    'large',   '10d10',     6, 18,   5, 6, 25000, NULL, 'force'),
  ('space_mine',        'large',   '16d10',     1, NULL,  5, 5,  100, 1000, 'munition via jettison device, 1t each'),
  ('jettison_heavy',    'large',   '5d4',       2, 6,    3, 4,  800,  NULL, 'ejects 1t cargo (device); DC 11 (DC 15 same round); deploys mines'),
  ('cannon_bombard',    'special', '16d10',    16, 100, 600, 4, 60000, 500, 'siege; misfire 16d10'),
  ('scorpion_claws_wpn','special', '3d10',      1, 1,    1, 1,    0,  NULL, '2 claws (special; mount via accessory)'),
  ('eyestalk_wpn',      'special', '10d6',      5, 8,    2, 1,    0,  NULL, 'Beholder concentration (special; mount via accessory)'),
  ('ram_wpn',           'special', '16d10',     1, NULL,  5, 0, 5000, NULL, 'attacker takes 1/2 dmg (special; mount via accessory)'),
  ('grappling_jaws_wpn','special', '4d10',      1, 1,    5, 0,    0,  NULL, 'Lamprey (special; mount via accessory)'),
  ('tentacles_wpn',     'special', '4d10/teleport', 3, NULL, 5, 0, 0, NULL, 'reach 3 forward hexes (special; mount via accessory)')
ON CONFLICT (id) DO NOTHING;

INSERT INTO ship_templates
  (id, name, role, frame_id, armor_id, atmosphere_speed, rudders, sails, l_weap, s_weap, hull_r, bridge, aux_helm, extra_crew, cargo_area) VALUES
  ('wasp',        'Wasp Ship',                'Shuttle',      'tiny',   'wood',    5, 2,  6,  0, 1,  0, 0, 0,  0,  8),
  ('damselfly',   'Damselfly',                'Scout',        'small',  'plated',  7, 3,  8,  1, 1,  0, 1, 0,  2,  5),
  ('scorpion',    'Scorpion Ship',            'Heavy Melee',  'small',  'metal',   3, 3,  2,  1, 1,  0, 0, 0,  5, 10),
  ('flying_fish', 'Flying Fish',              'Light Cargo',  'medium', 'wood',    4, 2,  9,  1, 1,  0, 0, 0, -1, 40),
  ('shrike',      'Shrike Ship',              'Flanker',      'medium', 'wood',    7, 3, 11,  0, 3,  0, 0, 0, -1, 20),
  ('lamprey',     'Lamprey',                  'Old Warship',  'medium', 'wood',    4, 3,  9,  0, 4, 10, 0, 0,  5,  6),
  ('squid',       'Squid Ship',               'Old Cargo',    'medium', 'wood',    3, 2,  2,  0, 2,  0, 0, 0,  2, 47),
  ('star_moth',   'Star Moth',                'Astral Elves', 'medium', 'ceramic', 5, 3,  7,  1, 2,  2, 1, 0,  2, 30),
  ('tyrant',      'Tyrant Ship',              'Beholder',     'medium', 'stone',   4, 0,  3,  0, 3,  0, 0, 0,  4, 15),
  ('fast_lamprey','Fast Lamprey',             'Warship',      'medium', 'wood',    5, 3, 12,  1, 4, 10, 0, 0,  5,  6),
  ('nightspider', 'Nightspider',              'Sneaker',      'large',  'plated',  4, 3,  6,  1, 4,  0, 0, 0, 10, 30),
  ('galleon',     'Space Galleon',            'Heavy Cargo',  'large',  'wood',    4, 2,  3,  1, 2,  0, 0, 0,  4, 70),
  ('hammerhead',  'Hammerhead',               'Medium Cargo', 'large',  'wood',    4, 2, 11,  2, 1,  0, 0, 0,  2, 50),
  ('turtle',      'Turtle Ship',              'Submarine',    'large',  'metal',   3, 3,  4,  1, 3,  0, 1, 0,  5, 20),
  ('living',      'Living Ship',              'Treant',       'small',  'wood',    4, 2, 10,  0, 1, 10, 0, 0,  0, 10),
  ('nautiloid',   'Nautiloid',                'Mind Flayers', 'large',  'wood',    4, 3, 10,  1, 4,  0, 1, 0,  7, 17),
  ('bombard',     'Bombard',                  'Siege',        'large',  'wood',    4, 3,  8,  0, 2,  0, 1, 0,  4, 15),
  ('gun_boat',    'Space Galleon (Gun Boat)', 'Gun Boat',     'large',  'plated',  3, 3,  8,  2, 4, 20, 1, 0,  4, 13)
ON CONFLICT (id) DO NOTHING;

INSERT INTO ship_template_accessories (template_id, accessory_id, count) VALUES
  ('scorpion',    'scorpion_claws',    1),
  ('shrike',      'ram',               1),
  ('lamprey',     'grappling_jaws',    1),
  ('squid',       'ram',               1),
  ('squid',       'smoke_sac',         1),
  ('tyrant',      'hover_device',      1),
  ('tyrant',      'eyestalk_cannons',  1),
  ('fast_lamprey','grappling_jaws',    1),
  ('nightspider', 'grappling_legs',    1),
  ('nightspider', 'low_visibility',    1),
  ('hammerhead',  'ram',               1),
  ('turtle',      'watertight_hull',   1),
  ('living',      'living_treant',     1),
  ('nautiloid',   'tentacles',         1),
  ('bombard',     'bombard_mount',     1),
  ('bombard',     'magazine',          2)
ON CONFLICT (template_id, accessory_id) DO NOTHING;
