-- 100: Per-template "thick hex border" toggle for hex structures.
--
-- Hex structures (gates/towers) draw a thick black hex outline by default. For
-- purely decorative hex effects a DM may not want that outline, so it becomes an
-- authored per-template flag. Existing rows keep the outline (default true).

ALTER TABLE map_structure_templates
  ADD COLUMN IF NOT EXISTS hex_border boolean NOT NULL DEFAULT true;
