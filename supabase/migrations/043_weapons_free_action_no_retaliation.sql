-- 043: weapons library gains free_action and no_retaliation columns.
-- Spells are represented as weapons (magicRadius > 0), and all spells need the
-- ability to be a free action and/or provoke no retaliation — flags that already
-- live in each unit's weapon_string but were missing from the library table, so
-- the Add Weapon modal could not pre-fill them from a library pick.

ALTER TABLE weapons ADD COLUMN IF NOT EXISTS no_retaliation BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE weapons ADD COLUMN IF NOT EXISTS free_action BOOLEAN NOT NULL DEFAULT false;

-- Preserve prior modal behavior: ranged weapons were pre-filled with
-- "No Retaliation" (heuristic `range > 1`). Existing library rows keep that.
UPDATE weapons SET no_retaliation = true WHERE range > 1 AND NOT no_retaliation;
