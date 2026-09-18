-- 089_map_walls.sql
-- Edge walls on reusable map boards. `walls` is jsonb keyed by the canonical edge
-- "q,r,dir" (dir 0..5), each value { a: WallFace, b: WallFace } where the two
-- faces belong to the two hexes sharing the edge. A face can carry a replacement
-- move cost (or block) and melee/ranged AC. Scenarios snapshot `walls` into
-- scenarios.map_data.walls on assign (see docs/dev/13).
ALTER TABLE maps ADD COLUMN IF NOT EXISTS walls jsonb NOT NULL DEFAULT '{}'::jsonb;
