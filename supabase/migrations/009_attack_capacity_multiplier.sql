-- Migration 009: Add attack_capacity_multiplier to formations
-- Separates attack capacity multiplier (attack_capacity_multiplier) from visual row capacity (row_capacity_multiplier).

ALTER TABLE formations ADD COLUMN attack_capacity_multiplier INTEGER NOT NULL DEFAULT 1;

-- Seed values: Phalanx gets 3 (allows 10 * 3 = 30 attack capacity for Medium);
-- Close Order and Shield Wall stay at 2 (match row_capacity_multiplier by default);
-- Open Order, Scattered, Routed stay at 1.
UPDATE formations SET attack_capacity_multiplier = 3 WHERE name = 'Phalanx';
UPDATE formations SET attack_capacity_multiplier = 2 WHERE name IN ('Close Order', 'Shield Wall');
UPDATE formations SET attack_capacity_multiplier = 1 WHERE name IN ('Open Order', 'Scattered', 'Routed');
