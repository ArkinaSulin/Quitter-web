-- 082: Effect image scale — a per-template size multiplier (percent) for the
-- effect artwork drawn on the map, edited with the Effect Editor's resize slider
-- and previewed against a 7-hex grid. 100 = the default (image height = 1.2 hexes,
-- matching the token footprint).
alter table effect_templates
  add column if not exists image_scale integer not null default 100;
