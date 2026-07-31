-- Migration 011: Add Hero formation
INSERT INTO formations (name, movement_multiplier, row_capacity_multiplier, attack_capacity_multiplier, ac_modifier, attack_modifier, morale_modifier)
VALUES ('Hero', 1, 1, 1, 0, 0, 0);
