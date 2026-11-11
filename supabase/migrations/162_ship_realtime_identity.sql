-- 162: Ship instance realtime identity.
--
-- `ship_spelljammer.snapshot` is a large jsonb and is TOASTed. Realtime UPDATE
-- events can omit unchanged TOASTed columns, so `useShips` merges the payload
-- with the cached instance and re-reads the row over REST after SHIP commands.
-- REPLICA IDENTITY FULL additionally makes UPDATE/DELETE payloads carry the
-- whole old/new record where PostgreSQL exposes it.

ALTER TABLE ship_spelljammer REPLICA IDENTITY FULL;
