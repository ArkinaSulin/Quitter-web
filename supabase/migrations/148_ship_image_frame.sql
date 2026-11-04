-- 148: Ship image frame for the 7-hex preview.
--
-- The ship image is scaled by keel length (feet) with aspect ratio preserved.
-- Vertical offset is in feet; positive moves the image up from the centre hex.

ALTER TABLE ship_templates
  ADD COLUMN IF NOT EXISTS keel_length integer NOT NULL DEFAULT 100;

ALTER TABLE ship_templates
  ADD COLUMN IF NOT EXISTS image_offset_y integer NOT NULL DEFAULT 0;
