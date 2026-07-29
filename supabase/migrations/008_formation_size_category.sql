-- Migration 008: Add size_categories lookup table and update formations
-- Replaces hardcoded unitCaps.ts and additive movement_modifier with data-driven columns.

-- 1. Create size_categories lookup table
CREATE TABLE IF NOT EXISTS size_categories (
  size_category INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  row_capacity INTEGER NOT NULL,
  max_troops INTEGER NOT NULL,
  max_troops_mounted INTEGER NOT NULL
);

INSERT INTO size_categories (size_category, name, row_capacity, max_troops, max_troops_mounted) VALUES
  (75,  'Small',      10, 80, 40),
  (100, 'Medium',     10, 80, 40),
  (200, 'Large',       5, 20, 20),
  (300, 'Huge',        2,  6,  6),
  (400, 'Gargantuan',  1,  1,  1)
ON CONFLICT (size_category) DO NOTHING;

-- 2. Replace formation movement_modifier (integer additive) with movement_multiplier (real multiplicative)
ALTER TABLE formations DROP COLUMN IF EXISTS movement_modifier;
ALTER TABLE formations ADD COLUMN movement_multiplier REAL NOT NULL DEFAULT 1.0;

-- 3. Add row_capacity_multiplier to formations (tight formations fight in 2 ranks)
ALTER TABLE formations ADD COLUMN row_capacity_multiplier INTEGER NOT NULL DEFAULT 1;

-- 4. Update existing formation values
UPDATE formations SET movement_multiplier = 0.5, row_capacity_multiplier = 2 WHERE name IN ('Shield Wall', 'Phalanx');
UPDATE formations SET movement_multiplier = 1.5 WHERE name IN ('Scattered', 'Routed');
