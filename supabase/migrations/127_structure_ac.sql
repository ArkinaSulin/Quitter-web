-- 127: structure Armor Class.
--
-- A structure (edge wall or hex gate/tower) gains an AC: an attacker must beat it
-- with each attack (`d20 + attackBonus >= ac`; nat 1 misses, nat 20 hits) for the
-- blow to land — a miss deals no damage. Authored per template (default 10) and
-- edited in the Structure Editor's Durability area (before Max HP). Carried into
-- the runtime `Wall` (edge) and read directly from the template (hex).
ALTER TABLE map_structure_templates ADD COLUMN IF NOT EXISTS ac integer NOT NULL DEFAULT 10;
