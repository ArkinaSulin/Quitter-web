-- 047: undo history depth as a game-wide setting.
-- The client undo/redo stack cap was a hard-coded 50, which evicted pre-session
-- history during busy play (undo stopped at session start). Now tunable via the
-- Lobby admin Settings editor without touching the DB.
INSERT INTO settings (key, value, description) VALUES
  ('undo_stack_size', '2000'::jsonb, 'How many recent commands each client keeps for undo/redo')
ON CONFLICT (key) DO NOTHING;
