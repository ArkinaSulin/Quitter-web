-- Migration 010: Add attached_position to units table
-- Tracks whether a hero attached to a unit is positioned in front or back.

ALTER TABLE units ADD COLUMN attached_position TEXT DEFAULT NULL;
