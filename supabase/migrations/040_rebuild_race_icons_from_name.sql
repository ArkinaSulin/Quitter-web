-- 040: Rebuild every local race icon URL from the race NAME (no per-race
-- exceptions). The committed files are public/images/races/<lowercase,
-- non-alphanumerics-stripped name>.png, so a correctly named race always
-- resolves. Also fixes already-spawned units via the race join. Storage /
-- external URLs are preserved.

UPDATE races
SET icon_url = '/images/races/' || lower(regexp_replace(name, '[^a-zA-Z0-9]', '', 'g')) || '.png'
WHERE icon_url IS NULL OR icon_url LIKE '/images/%';

UPDATE units
SET race_icon_url = '/images/races/' || lower(regexp_replace(r.name, '[^a-zA-Z0-9]', '', 'g')) || '.png'
FROM races r
WHERE r.id = units.race_id
  AND (units.race_icon_url IS NULL OR units.race_icon_url LIKE '/images/%');
