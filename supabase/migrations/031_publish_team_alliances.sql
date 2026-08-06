-- 031: Publish team_alliances to realtime so alliance changes reach every client
-- live. Fixes stale alliance data on already-connected clients (which broke
-- SuperPlayer/AssistGM own-alliance move gating when the GM changed alliances
-- after a player had loaded the scenario).

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'team_alliances'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.team_alliances;
    END IF;
  END IF;
END $$;
