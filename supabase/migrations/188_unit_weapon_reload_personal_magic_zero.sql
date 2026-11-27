-- 188_unit_weapon_reload_personal_magic_zero.sql
-- Personal and magic unit weapons never load. War machines keep their authored
-- reload count; everything else is 0.
UPDATE unit_weapons
  SET reload_steps = 0
  WHERE attack_class IN ('personal', 'magic')
    OR (attack_class IS NULL AND COALESCE(war_machine, false) = false);

ALTER TABLE unit_weapons
  ALTER COLUMN reload_steps SET DEFAULT 0;
