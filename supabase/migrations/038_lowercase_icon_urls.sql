-- 038: Lowercase local asset URLs in the DB to match the committed lowercase files.
-- 037 derived icon_url from the race name; this folds those (and any other local
-- /images/ paths) to lowercase so they match the renamed public/images/races/*
-- files on case-sensitive Linux (Vercel). External/storage URLs are untouched.

UPDATE races
SET icon_url = lower(icon_url)
WHERE icon_url LIKE '/images/%';

UPDATE units
SET race_icon_url = lower(race_icon_url)
WHERE race_icon_url LIKE '/images/%';
