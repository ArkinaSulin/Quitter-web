-- 083: Effect "transparent background" — skip the zone hex tint so only the
-- artwork (and the small marker dot / unit pip) show on the map. Edited per
-- template and per placed instance.
alter table effect_templates
  add column if not exists transparent_background boolean not null default false;
