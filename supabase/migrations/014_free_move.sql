-- Migration 014: Add free-move toggle to scenarios
-- free_move: when true, any player can move any unit without spending MP/actions (GM setup / special moves).
-- The scenarios table is already in the supabase_realtime publication (added in 013).

ALTER TABLE scenarios ADD COLUMN free_move BOOLEAN NOT NULL DEFAULT false;
