-- 101: Remove the standalone per-hex terrain MP-cost layer.
--
-- Terrain costs are folded into the two authored sources that already carry MP:
-- a hex structure's entry MP (`mp_foot_in` / `mp_mounted_in`, permanent) and a
-- `mp_cost` ground zone (timed). The effective hex MP is the HIGHER of the two
-- per locomotion, with a negative structure MP as a hard block. No backward
-- compatibility: the `maps.terrain_costs` column and the `terrainCosts` key in
-- `scenarios.map_data` are dropped.

ALTER TABLE maps DROP COLUMN IF EXISTS terrain_costs;

UPDATE scenarios
SET map_data = map_data - 'terrainCosts'
WHERE map_data ? 'terrainCosts';
