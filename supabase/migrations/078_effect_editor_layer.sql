-- 078: Effect editor — drop the obsolete magnitude mode and add a draw layer.
-- magnitude_mode was authored-only (nothing consumed it); the per-modifier
-- amount field covers both fixed and caster-entered values. `layer` decides
-- whether the effect's image renders below or above unit tokens on the map.
alter table effect_templates
  drop column if exists magnitude_mode;

alter table effect_templates
  add column if not exists layer text not null default 'below'
    check (layer in ('above', 'below'));
