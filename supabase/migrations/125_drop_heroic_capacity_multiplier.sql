-- 125: drop the `heroic_capacity_multiplier` game setting.
--
-- The hero aura no longer boosts attack CAPACITY (a flat multiplier). Each hero
-- now carries authored AURA effect modifiers (attack +1, AC +1, damage +1,
-- save bonus…) with a per-modifier radius, applied to same-alliance non-hero
-- allies while the hero is Leading (front-attached) or Inspired — see
-- `packages/units/lib/unitStats.ts#heroAuraBonus`. This tunable is dead; deleting
-- the row drops it from the admin Settings editor (no code reads it).
DELETE FROM admin_game_settings WHERE key = 'heroic_capacity_multiplier';
