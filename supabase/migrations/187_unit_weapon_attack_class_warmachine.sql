-- 187_unit_weapon_attack_class_warmachine.sql
-- WQC: the stored attack class value 'siege' is renamed to 'warmachine'. The
-- war-machine flag is now derived from the class, so no separate authoring.
-- Self-contained: works whether or not 186 ran first.
ALTER TABLE unit_weapons
  ADD COLUMN IF NOT EXISTS attack_class text,
  ADD COLUMN IF NOT EXISTS reload_steps integer NOT NULL DEFAULT 1;

ALTER TABLE unit_weapons
  DROP CONSTRAINT IF EXISTS unit_weapons_attack_class_check;

UPDATE unit_weapons
  SET attack_class = 'warmachine'
  WHERE attack_class = 'siege';

ALTER TABLE unit_weapons
  ADD CONSTRAINT unit_weapons_attack_class_check
    CHECK (attack_class IS NULL OR attack_class IN ('personal', 'magic', 'warmachine'));
