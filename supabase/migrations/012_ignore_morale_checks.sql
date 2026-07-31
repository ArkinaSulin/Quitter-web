-- Migration 012: Add ignore_morale_checks to units table
-- Units with this flag set to true never route (undead, heroes, etc.)

ALTER TABLE units ADD COLUMN ignore_morale_checks BOOLEAN NOT NULL DEFAULT false;

-- Existing heroes should default to ignoring morale checks
UPDATE units SET ignore_morale_checks = true WHERE is_hero = true;
