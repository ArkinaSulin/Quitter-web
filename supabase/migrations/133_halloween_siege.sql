-- 133: Halloween Siege minigame config (DM-authored scenario column).
-- Kept out of map_data so map/background writes can never drop it. The client
-- writes this outside the command log (like the other scenario settings); unit
-- spawns are still logged individually as PLACE commands.
ALTER TABLE scenarios ADD COLUMN IF NOT EXISTS halloween_siege jsonb;

COMMENT ON COLUMN scenarios.halloween_siege IS
  'Halloween Siege config: { enabled, turnsPerWave, waves[], nextSpawnAtTurn, lastSpawnedTurn }';
