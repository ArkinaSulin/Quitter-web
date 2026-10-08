-- 117: `unit_formations.organization_level` — the formation matrix becomes the
-- single source of truth for the formation's organization level (previously a
-- hard-coded name->level map in the client and the command RPC).
--
-- Levels: Routed/Scattered/Hero 0, Open Order 1, Close Order 2, Phalanx/Shield
-- Wall 3. Movement rules then READ this column: a formation is LOOSE at level 0
-- (no facing) and may PASS THROUGH friends at level <= 1 (never stacking).
ALTER TABLE unit_formations ADD COLUMN IF NOT EXISTS organization_level integer NOT NULL DEFAULT 0;

UPDATE unit_formations SET organization_level = 0 WHERE name IN ('Routed', 'Scattered', 'Hero');
UPDATE unit_formations SET organization_level = 1 WHERE name = 'Open Order';
UPDATE unit_formations SET organization_level = 2 WHERE name = 'Close Order';
UPDATE unit_formations SET organization_level = 3 WHERE name IN ('Phalanx', 'Shield Wall');
