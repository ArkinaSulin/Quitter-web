-- 164: Per-card box state + hittable hull.
--
-- Damage boxes are now keyed by deck card key (`boxState[cardKey]`), so old
-- aggregate group keys are discarded. Hull and Deck are both hittable cards and
-- appear in the layout.

UPDATE ship_spelljammer SET box_state = '{}'::jsonb;

UPDATE ship_components SET hittable = true WHERE name IN ('Hull', 'Deck');
