-- Migration 021: Seed size_categories
-- The size_categories lookup table was empty (or RLS-hidden), so row_capacity fell
-- back to the hardcoded 10 in drawToken. Large (200) tokens rendered 10 troops per
-- row in Open Order (and 20 in Close Order) instead of 5 (and 10).
-- This version: (1) adds a primary key if none exists under any name, (2) opens RLS
-- reads for anon/authenticated (needed if the table was created via the dashboard),
-- and (3) inserts the missing rows idempotently. Safe to run more than once.

-- 1. Ensure size_category has a primary key (any constraint name).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    WHERE t.relname = 'size_categories' AND c.contype = 'p'
  ) THEN
    ALTER TABLE size_categories ADD PRIMARY KEY (size_category);
  END IF;
END $$;

-- 2. RLS: make the lookup table readable by the app (anon + authenticated).
ALTER TABLE size_categories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS size_categories_select ON size_categories;
CREATE POLICY size_categories_select ON size_categories
  FOR SELECT USING (true);

-- 3. Insert only the rows that are missing.
INSERT INTO size_categories (size_category, name, row_capacity, max_troops, max_troops_mounted)
SELECT v.size_category, v.name, v.row_capacity, v.max_troops, v.max_troops_mounted
FROM (VALUES
  (75,  'Small',      10, 80, 40),
  (100, 'Medium',     10, 80, 40),
  (200, 'Large',       5, 20, 20),
  (300, 'Huge',        2,  6,  6),
  (400, 'Gargantuan',  1,  1,  1)
) AS v(size_category, name, row_capacity, max_troops, max_troops_mounted)
WHERE NOT EXISTS (
  SELECT 1 FROM size_categories c WHERE c.size_category = v.size_category
);