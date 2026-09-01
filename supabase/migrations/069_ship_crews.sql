-- 069: ship_crews — per-template crew roster (named + unnamed crew with their 6 stats).
-- One row per crew member. RLS mirrors the other ship template join tables
-- (read `view_ship_editor`, write `ship_editor`).

CREATE TABLE IF NOT EXISTS ship_crews (
  id          text PRIMARY KEY,
  template_id text NOT NULL REFERENCES ship_templates(id) ON DELETE CASCADE,
  name        text,
  level       integer NOT NULL DEFAULT 1,
  str         integer NOT NULL DEFAULT 10,
  dex         integer NOT NULL DEFAULT 10,
  con         integer NOT NULL DEFAULT 10,
  int         integer NOT NULL DEFAULT 10,
  wis         integer NOT NULL DEFAULT 10,
  cha         integer NOT NULL DEFAULT 10,
  cost        integer,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ship_crews_template ON ship_crews(template_id);

ALTER TABLE ship_crews ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ship_crews_select ON ship_crews;
CREATE POLICY ship_crews_select ON ship_crews FOR SELECT TO authenticated USING (shipyard_read());
DROP POLICY IF EXISTS ship_crews_insert ON ship_crews;
CREATE POLICY ship_crews_insert ON ship_crews FOR INSERT TO authenticated WITH CHECK (shipyard_write());
DROP POLICY IF EXISTS ship_crews_update ON ship_crews;
CREATE POLICY ship_crews_update ON ship_crews FOR UPDATE TO authenticated USING (shipyard_write());
DROP POLICY IF EXISTS ship_crews_delete ON ship_crews;
CREATE POLICY ship_crews_delete ON ship_crews FOR DELETE TO authenticated USING (shipyard_write());
