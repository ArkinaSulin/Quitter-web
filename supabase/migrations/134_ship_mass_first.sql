-- 134: Spelljammer mass-first overhaul.
-- Removes ship frames. The player designates a total mass; hull + armor are paid
-- out of it, then the rest is furnished with components, weapons and cargo.
--
--   hullMass  = totalMass × (10% + totalMass / 500)
--   armorMass = totalMass × armor.massPct
--   HP        = (totalMass × 3 + 40) × armor.hpMult
--   accel     = (sails + rudders) / totalMass × 15
--   MC        = x = rudders × 10 / totalMass; x < 1 → 1/x + 2, else 4 − x
--
-- Hit boxes stay (1 ton = 1 box) but carry no HP; each hit destroys one box.
-- Hull reinforcement is +10 temp HP per unit, assigned later in the ship editor.

-- --- Frames -----------------------------------------------------------------
DROP INDEX IF EXISTS idx_ship_templates_frame;

-- Add the new template columns before dropping the old frame-derived ones.
ALTER TABLE ship_templates ADD COLUMN IF NOT EXISTS total_mass numeric;
ALTER TABLE ship_templates ADD COLUMN IF NOT EXISTS helm integer NOT NULL DEFAULT 1;
ALTER TABLE ship_templates ADD COLUMN IF NOT EXISTS command_bridge integer NOT NULL DEFAULT 0;
ALTER TABLE ship_templates ADD COLUMN IF NOT EXISTS reinforcement integer NOT NULL DEFAULT 0;

-- Backfill total mass from the old frame before the frame table disappears.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'ship_templates' AND column_name = 'frame_id'
  ) THEN
    UPDATE ship_templates st
    SET total_mass = f.mass_cap
    FROM ship_frames f
    WHERE st.frame_id = f.id AND st.total_mass IS NULL;
  END IF;
END $$;

UPDATE ship_templates SET total_mass = 20 WHERE total_mass IS NULL;
ALTER TABLE ship_templates ALTER COLUMN total_mass SET DEFAULT 20;
ALTER TABLE ship_templates ALTER COLUMN total_mass SET NOT NULL;

-- Carry the old hard-point counts forward where possible.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'ship_templates' AND column_name = 'bridge'
  ) THEN
    UPDATE ship_templates SET command_bridge = bridge WHERE command_bridge = 0 AND bridge > 0;
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'ship_templates' AND column_name = 'hull_r'
  ) THEN
    UPDATE ship_templates SET reinforcement = hull_r WHERE reinforcement = 0 AND hull_r > 0;
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'ship_templates' AND column_name = 'aux_helm'
  ) THEN
    UPDATE ship_templates SET helm = 1 + aux_helm WHERE aux_helm > 0;
  END IF;
END $$;

ALTER TABLE ship_templates DROP CONSTRAINT IF EXISTS ship_templates_frame_id_fkey;
ALTER TABLE ship_templates DROP COLUMN IF EXISTS frame_id;
ALTER TABLE ship_templates DROP COLUMN IF EXISTS atmosphere_speed;
ALTER TABLE ship_templates DROP COLUMN IF EXISTS l_weap;
ALTER TABLE ship_templates DROP COLUMN IF EXISTS s_weap;
ALTER TABLE ship_templates DROP COLUMN IF EXISTS hull_r;
ALTER TABLE ship_templates DROP COLUMN IF EXISTS bridge;
ALTER TABLE ship_templates DROP COLUMN IF EXISTS aux_helm;

DROP TABLE IF EXISTS ship_frames CASCADE;

-- --- Armor ------------------------------------------------------------------
ALTER TABLE ship_armors ADD COLUMN IF NOT EXISTS mass_pct numeric NOT NULL DEFAULT 0;
ALTER TABLE ship_armors ADD COLUMN IF NOT EXISTS hp_mult numeric NOT NULL DEFAULT 1;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'ship_armors' AND column_name = 'mass_factor'
  ) THEN
    UPDATE ship_armors SET mass_pct = mass_factor;
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'ship_armors' AND column_name = 'box_hp'
  ) THEN
    UPDATE ship_armors SET hp_mult = CASE WHEN id IN ('ceramic', 'stone') THEN 2 ELSE 1 END;
  END IF;
END $$;

ALTER TABLE ship_armors DROP COLUMN IF EXISTS mass_factor;
ALTER TABLE ship_armors DROP COLUMN IF EXISTS box_hp;
ALTER TABLE ship_armors DROP COLUMN IF EXISTS cost_mult;

INSERT INTO ship_armors (id, mass_pct, ac, hp_mult) VALUES
  ('wood',    0.00, 15, 1),
  ('ceramic', 0.05, 13, 2),
  ('plated',  0.10, 17, 1),
  ('metal',   0.20, 19, 1),
  ('stone',   0.30, 17, 2)
ON CONFLICT (id) DO UPDATE SET
  mass_pct = EXCLUDED.mass_pct,
  ac = EXCLUDED.ac,
  hp_mult = EXCLUDED.hp_mult;

-- --- Components / accessories ----------------------------------------------
ALTER TABLE ship_components DROP COLUMN IF EXISTS deck;
ALTER TABLE ship_components DROP COLUMN IF EXISTS reinforce_order;

DELETE FROM ship_components;
INSERT INTO ship_components (id, mass, crew, cost, hittable) VALUES
  ('helm',            1.0, 1.0, 0, true),
  ('command_bridge',  3.0, 5.0, 0, true),
  ('sail',            1.0, 0.5, 0, true),
  ('rudder',          1.5, 0.5, 0, true),
  ('reinforcement',   1.0, 0.0, 0, true),
  ('cargo',           1.0, 0.0, 0, true),
  ('crew_quarters',   1.0, 5.0, 0, true),
  ('weapon_large',    2.0, 2.0, 0, true),
  ('weapon_small',    1.0, 2.0, 0, true);

ALTER TABLE ship_accessories DROP COLUMN IF EXISTS deck;
ALTER TABLE ship_accessories DROP COLUMN IF EXISTS pool_type;
