-- 037: Normalize race icon URLs to the exact committed file paths.
-- Vercel (Linux) serves static files case-sensitively, so any case/spelling
-- mismatch between races.icon_url and the public/images/races/* files 404s there
-- (local Windows dev is case-insensitive, which is why it worked locally).
-- Rebuilds local/missing icon URLs from the race name (matching the TitleCase
-- files in the repo); external/storage URLs are left untouched.

UPDATE races
SET icon_url = '/images/races/' || name || '.png'
WHERE icon_url IS NULL OR icon_url LIKE '/images/%';

-- Existing spawned units already copied the (possibly wrong) race_icon_url; fix
-- them too via the race join so tokens render without respawning.
UPDATE units
SET race_icon_url = '/images/races/' || r.name || '.png'
FROM races r
WHERE r.id = units.race_id
  AND (units.race_icon_url IS NULL OR units.race_icon_url LIKE '/images/%');
