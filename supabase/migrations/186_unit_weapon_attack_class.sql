-- 186_unit_weapon_attack_class.sql
-- Library weapon classification + deployed war-machine reload steps.
ALTER TABLE unit_weapons
  ADD COLUMN IF NOT EXISTS attack_class text
    CHECK (attack_class IS NULL OR attack_class IN ('personal', 'magic', 'siege')),
  ADD COLUMN IF NOT EXISTS reload_steps integer NOT NULL DEFAULT 1;
