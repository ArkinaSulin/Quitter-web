-- 091: Archer rules — front-only ranged arc for formed formations.
--
-- Formed units (Phalanx, Shield Wall, Close Order, Open Order) may only make
-- ranged attacks into their FRONT arc, mirroring the wedge a charge projects.
-- Range / maxRange bands are unaffected: a target must still be within range,
-- but it must also lie in the 120° front cone. Loose formations (Scattered,
-- Hero) keep their all-round ranged arc; Routed already cannot shoot.
--
-- The bearing-based arc check lives in src/lib/attackDirection.ts
-- (arcOfTarget); the adjacency-only determineCombatPosition cannot classify
-- targets at range >= 2.

UPDATE formations SET ranged_target_arcs = '{front}'
WHERE name IN ('Open Order', 'Close Order', 'Phalanx', 'Shield Wall');
