-- 070: rename ship_templates.extra_crew -> crew_count.
-- Semantics: crew_count is the ship's crew complement (current crew on board), set in
-- the Components box ("Crew"). It is independent of the component crew requirements
-- (which define the ship's MINIMUM crew to operate). The ship_crews roster is capped
-- at crew_count.

ALTER TABLE ship_templates RENAME COLUMN extra_crew TO crew_count;

-- RENAME COLUMN doesn't always invalidate the PostgREST schema cache, which would
-- make the app fail with "Could not find the 'crew_count' column ... in the schema
-- cache". Force a reload so the new column is visible immediately.
NOTIFY pgrst, 'reload schema';
