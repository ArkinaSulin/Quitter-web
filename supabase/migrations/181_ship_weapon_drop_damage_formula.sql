-- 181_ship_weapon_drop_damage_formula.sql
-- Ship weapons always use their authored `damage` string; ram damage is derived
-- at runtime from effective mass and distance travelled without turning.
ALTER TABLE ship_weapons
  DROP COLUMN IF EXISTS damage_formula;
