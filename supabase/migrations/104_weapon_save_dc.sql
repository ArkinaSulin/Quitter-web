-- 104: Weapon save DC — per-weapon spell save DC.
--
-- An area-effect weapon's saving throw is now resolved against a DC authored on
-- the weapon (defined at character/weapon creation) instead of a hardcoded 10.
-- The magic targeting modal still shows the DC and initializes it from the weapon.

ALTER TABLE unit_weapons ADD COLUMN IF NOT EXISTS save_dc integer NOT NULL DEFAULT 10;
