-- 085: Directional formation AC — melee vs ranged.
--
-- A formation's AC modifier now splits by attack type: `melee_ac_modifier`
-- (the old `ac_modifier`) applies to melee attacks, `range_ac_modifier` to
-- ranged attacks (including single-target magic weapons, which roll attack
-- rows like any weapon). Shield Wall is the only formation that differs for
-- now: +3 melee / +5 ranged. Every other formation defaults range to 0 until
-- tuned in test play. Values live in the DB — never hard-coded in the app.

ALTER TABLE formations RENAME COLUMN ac_modifier TO melee_ac_modifier;
ALTER TABLE formations ADD COLUMN IF NOT EXISTS range_ac_modifier INTEGER NOT NULL DEFAULT 0;

-- Shield Wall: +5 vs ranged (melee stays at its existing +3).
UPDATE formations SET range_ac_modifier = 5 WHERE name = 'Shield Wall';
