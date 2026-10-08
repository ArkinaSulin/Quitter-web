-- 116: ensure the fractional hero-MP pools are NUMERIC.
--
-- 060 made `movement_points_available` NUMERIC and 110 did the same for
-- `fly_speed_available`, but a skipped or out-of-order application can leave one
-- of them as `integer`. A fractional hero write then fails:
--   "invalid input syntax for type integer: \"1.2\""
-- (a hero converts actions at maxMP/5 — e.g. 6/5 = 1.2, or 3/5 = 0.6).
--
-- Re-assert BOTH columns as NUMERIC. This is a no-op when a column is already
-- numeric, so it is safe to run even if 060/110 were applied.
ALTER TABLE units ALTER COLUMN movement_points_available TYPE NUMERIC;
ALTER TABLE units ALTER COLUMN fly_speed_available TYPE NUMERIC;
