-- Migration 013: Add turn tracking to scenarios
-- current_turn_alliance: which alliance group is currently active (null = free play)
-- turn_number: increments once per full cycle (friendly -> enemy -> neutral -> friendly)

ALTER TABLE scenarios ADD COLUMN current_turn_alliance TEXT;
ALTER TABLE scenarios ADD COLUMN turn_number INTEGER NOT NULL DEFAULT 0;

ALTER TABLE scenarios
  ADD CONSTRAINT scenarios_current_turn_alliance_check
  CHECK (current_turn_alliance IN ('friendly', 'enemy', 'neutral'));

-- Ensure clients can subscribe to scenario turn changes via realtime
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'scenarios'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.scenarios;
    END IF;
  END IF;
END $$;
