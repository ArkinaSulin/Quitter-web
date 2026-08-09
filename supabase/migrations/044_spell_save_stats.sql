-- 044: Spell save stats.
-- 1. Weapons library gains the two spell-save fields so the Add Weapon modal can
--    pre-fill them and the magic area-effect modal can read them (via the weapon
--    string).
-- 2. unit_templates and units each gain the six ability "save bonuses"
--    (Str/Dex/Con/Int/Wis/Cha). These store the BONUS directly (default 0); the
--    magic modal's stat buttons read the target unit's value.
-- No weapon_string rewrite: this is dev-stage, existing content is fixed manually.
-- (Older 11-field strings parse with defaults: half-on-save true, saving throw Dex.)

ALTER TABLE weapons ADD COLUMN IF NOT EXISTS on_save_half_or_neg BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE weapons ADD COLUMN IF NOT EXISTS saving_throw TEXT NOT NULL DEFAULT 'Dex';

ALTER TABLE unit_templates ADD COLUMN IF NOT EXISTS str INT NOT NULL DEFAULT 0;
ALTER TABLE unit_templates ADD COLUMN IF NOT EXISTS dex INT NOT NULL DEFAULT 0;
ALTER TABLE unit_templates ADD COLUMN IF NOT EXISTS con INT NOT NULL DEFAULT 0;
ALTER TABLE unit_templates ADD COLUMN IF NOT EXISTS "int" INT NOT NULL DEFAULT 0;
ALTER TABLE unit_templates ADD COLUMN IF NOT EXISTS wis INT NOT NULL DEFAULT 0;
ALTER TABLE unit_templates ADD COLUMN IF NOT EXISTS cha INT NOT NULL DEFAULT 0;

ALTER TABLE units ADD COLUMN IF NOT EXISTS str INT NOT NULL DEFAULT 0;
ALTER TABLE units ADD COLUMN IF NOT EXISTS dex INT NOT NULL DEFAULT 0;
ALTER TABLE units ADD COLUMN IF NOT EXISTS con INT NOT NULL DEFAULT 0;
ALTER TABLE units ADD COLUMN IF NOT EXISTS "int" INT NOT NULL DEFAULT 0;
ALTER TABLE units ADD COLUMN IF NOT EXISTS wis INT NOT NULL DEFAULT 0;
ALTER TABLE units ADD COLUMN IF NOT EXISTS cha INT NOT NULL DEFAULT 0;
