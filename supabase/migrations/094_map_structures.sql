-- 094: Map structures on library boards.
--
-- Replaces the edge-only `maps.walls` jsonb with `maps.structures`: a keyed map of
-- placed structure instances (see src/types/structure.ts). Keys are the anchor:
--   "q,r,dir"  edge structure (dir 0..5)  -> walls / spikes
--   "q,r"      hex structure              -> gates / towers
-- Each value is { templateId, hp?, maxHp?, dt?, doorHp?, outside? } referencing a
-- map_structure_templates row.
--
-- The old wall system is unified into this model (owner decision: wipe existing
-- walls, no backfill), so `maps.walls` is dropped. Scenario instances are
-- snapshotted into scenarios.map_data.structures on assign; edge structures are
-- still converted to the runtime `Walls` shape so wall gameplay is unchanged until
-- the scenario is fully migrated.

ALTER TABLE maps ADD COLUMN IF NOT EXISTS structures jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE maps DROP COLUMN IF EXISTS walls;
