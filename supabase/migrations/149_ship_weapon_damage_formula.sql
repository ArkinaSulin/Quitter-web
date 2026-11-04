-- 149: Optional mass-scaled damage formula for ship weapons.
--
-- Example: {mass/10}d10 resolves against the carrying ship's total mass,
-- rounded up (70t -> 7d10, 75t -> 8d10). Literal damage remains the fallback.

ALTER TABLE ship_weapons
  ADD COLUMN IF NOT EXISTS damage_formula text;
