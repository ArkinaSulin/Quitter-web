-- 144: New ship template set (24 ships) + derived crew cleanup.
--
-- Removes the old template rows (and their joins/rosters) and replaces them with
-- the new master list. `crew_count` / `passengers` are derived (roster length and
-- excess crew), so the columns are dropped. Sail crew requirements are zero;
-- weapon handling crew is no longer part of minimum crew (stats code).
--
-- The 24 templates use the spreadsheet's structural columns only. Weapon tonnage
-- is stored as the authored capacity; weapon/component rows are intentionally
-- empty for now. Any unallocated mass stays as Reserve.

DO $$
BEGIN
  IF to_regclass('public.ship_spelljammer') IS NOT NULL THEN
    UPDATE ship_spelljammer SET template_id = NULL WHERE template_id IS NOT NULL;
  ELSIF to_regclass('public.spelljammer_ships') IS NOT NULL THEN
    UPDATE spelljammer_ships SET template_id = NULL WHERE template_id IS NOT NULL;
  END IF;
END $$;

DELETE FROM ship_crews;
DELETE FROM ship_template_components;
DELETE FROM ship_template_weapons;
DELETE FROM ship_templates;

ALTER TABLE ship_templates DROP COLUMN IF EXISTS passengers;
ALTER TABLE ship_templates DROP COLUMN IF EXISTS crew_count;

UPDATE ship_components SET crew = 0 WHERE name = 'Sail';

INSERT INTO ship_templates
  (id, name, armor_id, total_mass, helm, command_bridge, sails, rudders,
   reinforcement, weapon_capacity, cargo_area, crew_quarters)
VALUES
  ('racer_hummingbird', 'Racer (Humming bird)',
   (SELECT id FROM ship_armors WHERE name = 'wood'), 10, 1, 0, 2, 4, 0, 0, 0, 0),
  ('shuttle_liner_bee', 'Shuttle liner (Bee)',
   (SELECT id FROM ship_armors WHERE name = 'wood'), 10, 1, 0, 1, 1, 0, 0, 1, 4),
  ('scout_wasp', 'Scout (Wasp)',
   (SELECT id FROM ship_armors WHERE name = 'wood'), 20, 1, 0, 1, 6, 0, 1, 3, 2),
  ('scout_damselfly_a', 'Scout (Damselfly A)',
   (SELECT id FROM ship_armors WHERE name = 'metal'), 30, 1, 0, 7, 3, 0, 3, 1, 2),
  ('star_moth', 'Star Moth',
   (SELECT id FROM ship_armors WHERE name = 'ceramic'), 60, 1, 1, 2, 18, 0, 4, 2, 5),
  ('scout_damselfly_b', 'Scout (Damselfly B)',
   (SELECT id FROM ship_armors WHERE name = 'plated'), 70, 1, 0, 21, 7, 0, 3, 5, 3),
  ('flying_fish', 'Flying fish',
   (SELECT id FROM ship_armors WHERE name = 'wood'), 70, 1, 0, 0, 14, 0, 3, 25, 3),
  ('living_ship', 'Living ship',
   (SELECT id FROM ship_armors WHERE name = 'wood'), 70, 1, 1, 12, 7, 0, 1, 13, 2),
  ('lamprey', 'Lamprey',
   (SELECT id FROM ship_armors WHERE name = 'wood'), 70, 2, 1, 3, 14, 0, 4, 12, 6),
  ('scorpion_ship', 'Scorpion ship',
   (SELECT id FROM ship_armors WHERE name = 'metal'), 70, 1, 0, 7, 7, 0, 3, 10, 3),
  ('shrike_ship', 'Shrike ship',
   (SELECT id FROM ship_armors WHERE name = 'wood'), 80, 2, 1, 3, 24, 0, 3, 5, 6),
  ('nightspider', 'Nightspider',
   (SELECT id FROM ship_armors WHERE name = 'metal'), 90, 1, 1, 15, 9, 0, 6, 2, 6),
  ('squid_ship', 'Squid Ship',
   (SELECT id FROM ship_armors WHERE name = 'wood'), 90, 1, 1, 9, 9, 0, 4, 27, 5),
  ('space_galleon', 'Space Galleon',
   (SELECT id FROM ship_armors WHERE name = 'wood'), 120, 1, 1, 2, 6, 0, 4, 56, 4),
  ('nautiloid', 'Nautiloid',
   (SELECT id FROM ship_armors WHERE name = 'wood'), 120, 2, 1, 20, 12, 0, 6, 21, 7),
  ('hammerhead', 'Hammerhead',
   (SELECT id FROM ship_armors WHERE name = 'wood'), 120, 1, 1, 16, 12, 0, 5, 29, 6),
  ('bombard', 'Bombard',
   (SELECT id FROM ship_armors WHERE name = 'wood'), 120, 2, 1, 12, 12, 1, 10, 20, 5),
  ('turtle_ship', 'Turtle ship',
   (SELECT id FROM ship_armors WHERE name = 'metal'), 80, 1, 1, 8, 4, 0, 5, 12, 3),
  ('tyrant_ship', 'Tyrant Ship',
   (SELECT id FROM ship_armors WHERE name = 'stone'), 90, 3, 0, 0, 0, 0, 3, 20, 2),
  ('warship_small', 'Warship - small',
   (SELECT id FROM ship_armors WHERE name = 'plated'), 60, 2, 1, 0, 12, 0, 8, 3, 6),
  ('warship_medium', 'Warship - medium',
   (SELECT id FROM ship_armors WHERE name = 'plated'), 100, 2, 1, 0, 20, 0, 12, 4, 8),
  ('warship_large', 'Warship - large',
   (SELECT id FROM ship_armors WHERE name = 'wood'), 140, 2, 1, 0, 42, 0, 6, 3, 9),
  ('super_cargo_ship', 'Super cargo ship',
   (SELECT id FROM ship_armors WHERE name = 'wood'), 200, 1, 0, 8, 5, 0, 0, 80, 2),
  ('gun_boat', 'Gun Boat',
   (SELECT id FROM ship_armors WHERE name = 'plated'), 100, 2, 1, 10, 10, 0, 18, 2, 10);
