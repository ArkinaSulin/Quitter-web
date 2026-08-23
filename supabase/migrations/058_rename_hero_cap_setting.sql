-- 058: Rename hero_combat_capacity -> unit_melee_hero_cap.
--
-- The old key read like the cap applied TO a hero ("hero combat capacity").
-- It actually caps a UNIT's troops striking a hero, and only in MELEE —
-- ranged attacks against a hero are uncapped. New key + description reflect that.

UPDATE settings
SET key = 'unit_melee_hero_cap',
    description = 'Fraction of a unit''s troops able to strike a hero in MELEE (0.5 = 50%); ranged attacks are uncapped',
    updated_at = now()
WHERE key = 'hero_combat_capacity';
