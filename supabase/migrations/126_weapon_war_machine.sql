-- 126: war-machine weapon fields on the `unit_weapons` library.
--
-- A WAR MACHINE is a crew-served weapon: the whole unit operates ONE machine, so
-- it makes `number_of_attacks` attacks per UNIT instead of per troop/row (see
-- `combat/unitCombat.computeAttackCount(..., perUnit)`). Two extra authored fields
-- ride along:
--   * `min_range` — a target closer than this is out of range (0 = none).
--   * `min_crew`  — crew needed to operate it; stored for later use (e.g. ships),
--                   no rule consumes it yet.
-- All three are embedded in the unit/template weapon_string CSV (fields 17–19),
-- so this only adds the library columns the Weapon Editor writes.
ALTER TABLE unit_weapons ADD COLUMN IF NOT EXISTS war_machine boolean NOT NULL DEFAULT false;
ALTER TABLE unit_weapons ADD COLUMN IF NOT EXISTS min_range integer NOT NULL DEFAULT 0;
ALTER TABLE unit_weapons ADD COLUMN IF NOT EXISTS min_crew integer NOT NULL DEFAULT 0;
