-- 041: Tunable game-balance settings.
-- Values are data, not code: an admin edits a row (via a future Settings UI or SQL)
-- and the change applies without a rebuild. `value` is JSONB so any scalar, bool,
-- array, or nested object (bands/tables) fits without schema churn.
--
-- Read path (client): src/lib/settingsCache.ts caches all rows in memory and offers
-- a sync getSetting(key, fallback); the code default matches the seeded value, so
-- behavior is correct even before the cache is populated.

CREATE TABLE IF NOT EXISTS settings (
  key         TEXT PRIMARY KEY,
  value       JSONB NOT NULL,
  description TEXT,
  updated_at  TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE settings ENABLE ROW LEVEL SECURITY;

-- Everyone (authenticated) may read settings — balance constants aren't secret.
DROP POLICY IF EXISTS settings_select ON settings;
CREATE POLICY settings_select ON settings
  FOR SELECT TO authenticated USING (true);

-- Only admins may change settings. This policy is what the future Settings UI
-- will write through; no schema change needed to add one.
DROP POLICY IF EXISTS settings_admin_insert ON settings;
CREATE POLICY settings_admin_insert ON settings
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));

DROP POLICY IF EXISTS settings_admin_update ON settings;
CREATE POLICY settings_admin_update ON settings
  FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));

DROP POLICY IF EXISTS settings_admin_delete ON settings;
CREATE POLICY settings_admin_delete ON settings
  FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));

-- Seed. Code fallback in settingsCache / unitCombat matches these values.
INSERT INTO settings (key, value, description) VALUES
  ('hero_attack_split', '0.3'::jsonb, 'Fraction of a strike''s attacks directed at a front-attached hero')
ON CONFLICT (key) DO NOTHING;
