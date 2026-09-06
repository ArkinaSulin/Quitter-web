-- 076: AI Assist mode (GM tool). When enabled, the GM's left panel shows an
-- "AI" tab where teams can be handed to a plotted (preview -> execute) enemy AI.
-- Pure GM QoL; no server-side logic. Units gated out of AI control client-side:
-- deleted, killed (HP <= 0), hidden, hero-hosted/attached.
ALTER TABLE scenarios ADD COLUMN IF NOT EXISTS ai_assist_enabled BOOLEAN NOT NULL DEFAULT false;
