-- 020: Charge! mechanic
-- is_charging: unit is mid-charge (rotate + formation locked, corridor-only move,
--              free double-damage attack on full charge).
-- charge_distance: hexes moved during the current charge (2 = full charge).
ALTER TABLE units ADD COLUMN IF NOT EXISTS is_charging BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE units ADD COLUMN IF NOT EXISTS charge_distance INT NOT NULL DEFAULT 0;
