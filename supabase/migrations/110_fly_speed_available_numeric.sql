-- 110: fly_speed_available → NUMERIC, mirroring movement_points_available (060).
--
-- Heroes carry fractional fly MP (each converted action grants flySpeed/5, 1
-- decimal; the fraction carries and the display floors) — e.g. a flyer with
-- flySpeed 3 gets 0.6 per action. The column was added as integer in 108, so the
-- fractional write failed ("invalid input syntax for type integer: \"0.6\"").
ALTER TABLE units ALTER COLUMN fly_speed_available TYPE NUMERIC;
