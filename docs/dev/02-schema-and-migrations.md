# 02 — Schema & Migrations

## Layout

All state lives in a single Supabase Postgres project. **Migrations in this
repo are deltas only** — the base schema (tables like `units`,
`unit_formations`, `unit_races`, … plus their initial seed rows) was created
outside the migration folder and is already in the live DB. Migrations numbered
`001`…`097` then evolved it. Migration `098` renamed tables onto a consistent
subsystem-prefixed scheme (see below). Some numbering gaps are intentional:
`006`/`064` have two files each, and there is no `018`/`039` (dropped/renumbered).

## Naming convention (migration 098)

Every table is prefixed by the subsystem it belongs to. The root noun of a
subsystem stays unprefixed (`units`, `scenarios`, `maps`, `profiles` became
`user_profile`):

| Prefix | Subsystem |
|---|---|
| `user_*` | Identity (`user_profile`, view `user_profile_last_change`) |
| `admin_*` | Global-role access matrix, audit log, game settings |
| `scenario_*` | Per-scenario runtime (roster, alliances, history, replay, rights) |
| `unit_*` | Land-unit system + its lookup libraries |
| `map_*` | Reusable maps + authored features/effects |
| `ship_*` | Spelljammer |

Renames applied by `098_table_renames.sql`:

| Old | New |
|---|---|
| `profiles` | `user_profile` |
| `profile_access` (view) | `user_profile_last_change` |
| `settings` | `admin_game_settings` |
| `access_roles` | `admin_role_access_rights` |
| `role_changes` | `admin_role_changes` |
| `scenario_role_capabilities` | `scenario_role_access_rights` |
| `team_alliances` | `scenario_team_alliance` |
| `replay_state` | `scenario_replay_state` |
| `command_log` | `scenario_command_log` |
| `races` | `unit_races` |
| `mounts` | `unit_mounts` |
| `weapons` | `unit_weapons` |
| `armors` | `unit_armors` |
| `formations` | `unit_formations` |
| `size_categories` | `unit_size_categories` |
| `effect_templates` | `map_effect_templates` |
| `spelljammer_ships` | `ship_spelljammer` |

Unchanged: `scenarios`, `scenario_participants`, `units`, `unit_templates`,
`unit_types`, `maps`, `map_structure_templates`, and all `ship_*` library
tables.

## Tables

| Table | Purpose | Notes |
|---|---|---|
| `user_profile` | Global user row: `id` → `auth.users`, `display_name`, `role` (`admin`/`dm`/`player`/NULL = pending), `request_note`, `last_active_at` | role changed only via the `set_player_role` RPC; capability matrix in `admin_role_access_rights` |
| `admin_role_access_rights` | Global role → capability matrix (`can_*` flags) | one row per role (admin/dm/player/pending); used by `user_has_access` |
| `admin_role_changes` | Audit log of every role change (target, changer, old/new role, timestamp) | written by `set_player_role` |
| `user_profile_last_change` (view) | Admin-panel read model: profile + latest `admin_role_changes` row + changer name | see `03` |
| `user_has_access(permission)` | SECURITY DEFINER helper returning whether the caller's role grants `permission` | used inside RLS policies |
| `admin_game_settings` | Game-wide JSONB key/value balance constants | RLS: select authenticated, write admin |
| `scenarios` | One battle. `name`, creator, password_hash, `map_data` jsonb, screenshot, `turn_number`, `current_turn_alliance`, `free_move`, `room_open`, deletion-request columns, `dm_heartbeat_at`, `halloween_siege` jsonb | creator is the GM |
| `scenario_participants` | user ↔ scenario: `role` (GM/AssistGM/SuperPlayer/Player), `team` | team drives control |
| `scenario_team_alliance` | team → alliance group (`friendly`/`enemy`/`neutral`) per scenario | realtime-published |
| `scenario_role_access_rights` | Per-scenario-role permission matrix (Player…AssistGM) | see `03` |
| `scenario_command_log` | Append-only command history; `seq BIGSERIAL`, `sub_steps jsonb`, `chained`, `deleted_at` | the timeline; see `04` |
| `scenario_replay_state` | Persisted replay mode/cursor/playing per scenario | see `12` |
| `units` | Live battlefield instances (a copy of the template + dynamic state) | key columns below |
| `unit_templates` | Authorable blueprints (the Unit Library) | RLS: read = `view_unit_editor`, write = `unit_editor` |
| `unit_races` / `unit_mounts` / `unit_weapons` / `unit_armors` / `unit_formations` / `unit_size_categories` / `unit_types` | Unit lookup tables | `unit_formations` carries the full combat-rule matrix (migration 027) |
| `map_effect_templates` | Effect library (unit buffs/debuffs/DoT + ground zones) | RLS: read = `view_effect_editor`, write = `effect_editor` |
| `map_images` (bucket) / `maps` | Reusable authored maps (`image_url`, `offset_x/y`, `scale`, `grid_radius`, `terrain_costs jsonb`, `hex_effects`, `structures`) | see `13`, `18` |
| `map_structure_templates` | Authored map-feature library (walls, spikes, gates, towers) | see `18` |
| `ship_armors`, `ship_components`, `ship_weapons`, `ship_crews`, `ship_templates` (+ join tables) | Archfar's Shipyard catalogs (UUID id + unique `name`; optional components are `ship_components` rows) and template data | see `16` |
| `ship_spelljammer` | Placed ship instances (engine pending) | reserved |
| `units.effects` | jsonb `UnitEffect[]` on the units row (not a table) | migration 073 |
| Storage buckets | `scenario_screenshots`, `unit_images`, `map_images`, `effect_images`, `structure_images`, `ship_images` | public read |

> The migration inventory below refers to tables by the names they had **at the
> time of that migration**; see the rename table above for current names.

## The units table (battlefield state, key columns)

Full column list is in `src/types/gameProtocol.ts` (`Unit`) and the
row↔unit mappers (`useSupabaseSync`). The columns that drive the rule system:

- Stats: `level`, `troop_hp`, `max_unit_hp`/`current_unit_hp`,
  `max_troop_count`/`current_troop_count`, `number_of_attacks`, ability scores
  `str..cha` and save bonuses `str_sav..cha_sav`
- Defense: `baseline_ac`, `current_ac`, `is_shielded`, `armor_name`
- Movement: `movement_points` (max), `movement_points_available` (**NUMERIC**
  since 060 — heroes carry 1-decimal fractions), `actions_available`,
  `attacks_used`
- Combat/morale: `aggressiveness`, `base_morale`, `current_morale_modifier`,
  `ignore_morale_checks`
- Position/team: `hex_q/r/s`, `facing`, `team`, `hidden`, `is_deleted`,
  `current_formation`, `organization_level` (denormalized, recomputed on load)
- Hero/economy: `is_hero`, `attached_to_unit_id`, `attached_position`,
  `active_weapon_index`, `is_charging`, `charge_distance`,
  `archer_reaction_used`, `darkvision`
- Bookkeeping: `weapon_string`, `command_seq`, `effects`, `created_at/updated_at`

`unit_field_to_column()` (defined in `051`, extended in `060`+ later) is the
camelCase→snake_case **allowlist** that `apply_substeps` uses. Any sub-step
field not on the list makes the server `RAISE` — never silently skip.

**Ability scores vs saving throws (151).** `str..cha` are ability scores
(default 10); `str_sav..cha_sav` are the save bonuses (default 0). They are
separate fields. Example: a hero with Str 14 has a +2 Strength modifier, but its
Strength save bonus is still whatever is stored in `str_sav` (e.g. +5); reading
`str` as a save is a bug. The same split exists on `unit_templates` and `units`.

## Migration inventory & status

Legend: ✅ **applied** (confirmed in AGENTS/handover), ⏳ **awaiting apply**
(confirmed pending), ❓ **unverified** (older; written in the repo, not tracked
as applied in the notes — check the live DB before relying on it).

| Mig | Purpose | Status |
|---|---|---|
| 001–009 | command_log, org levels, team_alliances, is_deleted, cascades, chained, loose→tight rename, attached hero, size categories/formations, attack-capacity mult | ❓ |
| 010 | hero attach position | ✅ applied |
| 011 | Hero formation row | ✅ applied |
| 012 | `ignore_morale_checks` | ✅ applied |
| 013 | turn tracking (`current_turn_alliance`, `turn_number`) | ✅ applied |
| 014 | free_move | ❓ |
| 015 | profiles | ❓ |
| 016–017 | access_roles, admin panel | ❓ |
| 019–028 | replay watch, charge, size seed, two-handed, profile trigger, replay pending, access matrix, backfill, formation combat rules (027), map_images bucket | ❓ |
| 029–040 | participant teams/room, capability matrix, publish team_alliances, weapon fields, icons | ❓ |
| 041–058 | settings + settings cache keys, weapon save/spell fields, undo RPC/redo, server-authoritative commands (051), alliance end-turn + replay (052), about-turn/hero settings, team seed, deletion request, command_seq, DM heartbeat, hero-cap rename | ❓ (most referenced as applied by later code) |
| 059 | ship editor access caps | ✅ applied |
| 060 | attack cap + hero actions (`attacks_used`, NUMERIC mp) | ✅ applied |
| 061–065 | drop is_routing, archer reaction, apply_substeps coalesce fix, mounted charge, verbose combat | ❓ |
| 066 | ship schema (`ship_*` template tables + `spelljammer_ships`) | ❓ (code is canonical for ship data) |
| 067 | *(removed)* ship seed — dropped; ships to be redesigned | n/a |
| 068 | ship RLS | ✅ applied (verified 2026-09-06) |
| 069 | ship_crews | ✅ applied (verified 2026-09-06) |
| 070 | extra_crew → crew_count | ✅ applied (verified 2026-09-06) |
| 071 | fog of war columns + settings | ✅ applied (verified 2026-09-06) |
| 072 | `night_vision` → `darkvision` rename (guarded) | ✅ applied (verified 2026-09-06) |
| 073 | `units.effects` + apply_substeps branch | ✅ applied (verified 2026-09-06) |
| 074 | map entities + access caps (`maps` table) | ✅ applied (verified 2026-09-06) |
| 075 | restore `archerReactionUsed` allowlist entry | ✅ applied (verified 2026-09-06) |
| 076 | AI assist toggle (`ai_assist_enabled`) | ✅ applied (verified 2026-09-06) |
| 077 | effects library (`effect_templates` + access caps) | ✅ applied (verified 2026-09-06) |
| 078 | effect editor: drop `magnitude_mode`, add `layer` (above/below) | ✅ applied |
| 079 | `effect_images` storage bucket + policies | ✅ applied |
| 080 | zone ops via command log (`apply_substeps` ZONE branch) + array-safe unit writes | ✅ applied (2026-09-06) |
| 081 | Weapon Editor: access caps + RLS on `weapons` | ⏳ run in Supabase |
| 082 | effect image scale (`effect_templates.image_scale`) | ⏳ run in Supabase |
| 083 | effect transparent background (`effect_templates.transparent_background`) | ⏳ run in Supabase |
| 084 | parting shot (`units.parting_shot_used` + allowlist) — renamed by 087 | ⏳ run in Supabase |
| 085 | formation AC split: `ac_modifier`→`melee_ac_modifier` + `range_ac_modifier` | ⏳ run in Supabase |
| 086 | hero morale boost: `units`/`unit_templates.morale_boost`, `units.heroic_inspiration_active`, `scenarios.hero_morale_boost_enabled`, `settings.heroic_capacity_multiplier` | ⏳ run in Supabase |
| 087 | rename `parting_shot_used` → `opportunity_attack_used` + allowlist | ⏳ run in Supabase |
| 088 | seed attack-roll effects (`effect_templates` Advantage/Disadvantage/Grant*) | ⏳ run in Supabase |
| 089 | edge walls (`maps.walls` jsonb) | ⏳ run in Supabase |
| 090 | ZoC pursue + Withdraw: `scenarios.zoc_pursuit_enabled`, rename `opportunity_attack_used`→`pursuit_used`, `units`/`unit_templates.command_pursuit_permit` + allowlist | ⏳ run in Supabase |
| 091 | archer rules: formed formations front-only ranged arc (`formations.ranged_target_arcs`) | ⏳ run in Supabase |
| 092 | wall command log: `apply_substeps` WALL branch (`scenarios.map_data.walls`) | ⏳ run in Supabase |
| 093 | map structure templates: caps + `map_structure_templates` + 9 seed templates | ⏳ run in Supabase |
| 094 | map structures: `maps.structures` jsonb (drops `maps.walls`) | ⏳ run in Supabase |
| 095 | structure command log: `apply_substeps` `STRUCTURE` per-key branch (`scenarios.map_data.structures`) | ⏳ run in Supabase |
| 096 | structure `spikes` flag + rename "Archer Spikes" → "Archer's Stake" | ⏳ run in Supabase |
| 097 | `structure_images` storage bucket + policies | ⏳ run in Supabase |
| 098 | consistent table renames + function/view rebind (see convention above) | ✅ applied (2026-09-21) |
| 099 | structure template rework: `mp_climb_up/out`+`mp_mounted_up/out` replace the A/B faces + `hex_move_cost`; `door_hp` gates passage, `max_hp` gates modifiers; one mode-scoped `modifiers` list; wipe instances + reseed 9 presets | ✅ applied |
| 100 | structure `hex_border` toggle (draw the thick hex outline or not) | ✅ applied |
| 101 | remove standalone terrain-cost layer (`maps.terrain_costs` + `map_data.terrainCosts`); MP folds into structures/zones | ✅ applied |
| 102 | edge decorations: `spikes`→`barricade`, add `sin_wave`; rename "Archer's Stake"→"Barricade" | ✅ applied |
| 103 | `unit_templates.effects` (design-time inherited effects) | ✅ applied |
| 104 | `unit_weapons.save_dc` (area-weapon save DC, default 10) | ✅ applied |
| 105 | seed `map_pan_step` setting | ✅ applied |
| 106 | seed `mount_main_attack_split` setting | ✅ applied |
| 107 | `units.mount_split` (per-pair mount volley split) + `unit_field_to_column` | ✅ applied |
| 108 | `units.elevation` / `fly_speed` / `fly_speed_available` + `unit_field_to_column` | ✅ applied |
| 109 | `unit_templates.fly_speed` (authored source) | ✅ applied |
| 110 | `units.fly_speed_available` → NUMERIC (fractional hero fly MP) | ✅ applied |
| 111 | structure `elevation`+`stairs`; `map_effect_templates.elevation` | ✅ applied |
| 112 | `units.climb_to` + `unit_field_to_column` | ✅ applied |
| 113 | retire `stairs` → `ignore_climb` modifier; drop `map_structure_templates.stairs` | ✅ applied |
| 114 | edge structure `ladder` decoration + backfill from `ignore_climb` | ✅ applied |
| 115 | `map_effect_templates.permanent` (effect-template never-ticks flag) | ✅ applied (2026-10-04) |
| 116 | re-assert `units.movement_points_available` + `fly_speed_available` as NUMERIC (idempotent; fixes "invalid input syntax for type integer" if 060/110 were skipped) | ⏳ run in Supabase |
| 117-118 | `unit_formations.organization_level` + the RPC reads it | ✅ applied |
| 119 | `unit_images` storage delete policy | ✅ applied |
| 120 | strip structure `ignore_climb` → `mp_climb_* = 0` | ✅ applied |
| 121 | rename structure climb columns `mp_foot_in/out`, `mp_mounted_in/out` → `mp_climb_up/down`, `mp_mounted_up/down`; `NOT NULL DEFAULT 4` | ⏳ run in Supabase |
| 123 | seed `protected_hero_range_split` setting (back-attached hero's ranged volley share) | ⏳ run in Supabase |
| 124 | drop the vestigial `undo_stack_size` game setting (undo is server-side) | ⏳ run in Supabase |
| 125 | drop the `heroic_capacity_multiplier` setting (hero aura is now authored effect modifiers) | ⏳ run in Supabase |
| 126 | war-machine weapon fields: `unit_weapons.war_machine` / `min_range` / `min_crew` | ⏳ run in Supabase |
| 127 | structure Armor Class: `map_structure_templates.ac` (default 10) | ⏳ run in Supabase |
| 128 | `units.base_ac` (unarmoured base AC, copied from the template; war-machine to-hit) | ⏳ run in Supabase |
| 129 | `unit_field_to_column`: add `baseAc → base_ac` (on-map modal "Natural AC") | ⏳ run in Supabase |
| 130 | AI assist flags (`scenarios.ai_assist_enabled` / `ai_assist_players`; legacy `ai_assist_advanced` retained) | ⏳ run in Supabase |
| 131 | AI role markers (advanced AI, later removed) | ⏳ run in Supabase |
| 132 | drop the AI role marker column | ⏳ run in Supabase |
| 133 | Halloween Siege: `scenarios.halloween_siege` jsonb (wave config + arming/marker) | ⏳ run in Supabase |
| 134 | Ship mass-first overhaul: drop `ship_frames`, reshape `ship_armors` (`mass_pct`/`hp_mult`), reseed `ship_components`, add `total_mass`/`helm`/`command_bridge`/`reinforcement` to `ship_templates` | applied |
| 135 | Authored ship crew quarters + passengers (`ship_templates.crew_quarters`, `passengers`) | applied (schema verified 2026-11-14) |
| 136 | Ship Editor v2: template image/weapon capacity/atmospheric speed/damage threshold; catalog `image_url` + `ac`; `hull` component; `ship_images` bucket | applied (schema verified 2026-11-14) |
| 137 | Ship catalog UUID id + unique `name` for armors/components/accessories/weapons; migrate template/join FKs | applied (schema verified 2026-11-14) |
| 138 | Component Workshop fields: `ship_components.effect`; `ship_weapons` mass/min_range/range/max_range/fire_cycle_step (mount dropped); component-editor access + catalog RLS | applied (schema verified 2026-11-14) |
| 139 | Merge accessories into components: `ship_components.built_in`, move `ship_accessories` rows, rename join table to `ship_template_components`, drop `ship_accessories` | applied (schema verified 2026-11-14) |
| 140 | Component/weapon catalog deletes cascade to template selections; usage RPCs for the delete confirmation | applied (logic; not anon-verifiable) |
| 141 | Normalize `ship_components.name` / `ship_weapons.name`: underscores to spaces, first word capitalized, unique names enforced | applied (data; not anon-verifiable) |
| 142 | Ship card stats: `ship_components.dt` / `ship_weapons.dt` (default 15); `ship_templates.card_placements` + `reinforcements` jsonb | applied (schema verified 2026-11-14) |
| 143 | Region-container deck: `ship_templates.deck_layout` jsonb; drop `card_placements`; stable `ship_template_weapons.id` UUID PK; drop `mount_slot` | applied (schema verified 2026-11-14) |
| 144 | Ship master templates: remove old templates/joins; drop derived `crew_count`/`passengers`; Sail crew 0; seed 24 templates (no component/weapon rows) | applied (schema verified 2026-11-14) |
| 145 | Ship crew: `ship_crews.hp` (authored, default 10); weekly `cost` required; new stat defaults 12-14-14-10-14-10 | applied (schema verified 2026-11-14) |
| 146 | Ship component cards: `ship_components.can_combine` (default true; Helm/Command bridge false); weapons always per-unit | applied (schema verified 2026-11-14) |
| 147 | Ship weapon row order: `ship_template_weapons.sort_order` | applied (schema verified 2026-11-14) |
| 148 | Ship image frame: `ship_templates.keel_length` (default 100 ft) + `image_offset_y` (default 0 ft) | applied (schema verified 2026-11-14) |
| 149 | Mass-scaled ship weapon damage: `ship_weapons.damage_formula` (e.g. `{mass/10}d10`) | applied (schema verified 2026-11-14) |
| 150 | Ship weapon firing arcs: `ship_templates.weapon_arcs` jsonb (per-card added/removed arcs) | applied (schema verified 2026-11-14) |
| 151 | Ability scores split from saving throws: `str..cha` = abilities, `str_sav..cha_sav` = save bonuses (also on `unit_templates`; `unit_field_to_column` updated) | applied (schema verified 2026-11-14) |
| 152 | Scenario Spelljammer mode: `ship_mode`, `ship_firing_arcs`, `ship_step` | applied (schema verified 2026-11-14) |
| 153 | Ship weapon reload/area fields: `reload_steps`, `magic_dimension`, `shape`, `saving_throw`, `save_dc`, `on_save_half_or_neg` | applied (schema verified 2026-11-14) |
| 154 | `ship_components.is_ram` + hull repair station | applied (schema verified 2026-11-14) |
| 155 | `ship_spelljammer` runtime columns (`snapshot`, `stations`, `crew_state`, `reload`, `card_state` (renamed by 169), movement fields) | applied (schema verified 2026-11-14) |
| 156 | `ship_spelljammer` RLS (participant read, GM write) | applied (logic; not anon-verifiable) |
| 157 | `SHIP` command sub-steps + `ship_step` scenario field | applied (logic; not anon-verifiable) |
| 158 | `SHIP` placement insert fix (NOT NULL `name`) | applied (logic; not anon-verifiable) |
| 159 | Ship realtime publication + atmosphere default + `declared_round` | applied (`declared_round` schema verified; publication not anon-verifiable) |
| 160 | Unit ship boarding: `attached_to_ship_id`, `ship_station_key` | applied (schema verified 2026-11-14) |
| 161 | `ship_spelljammer.crew_team` | applied (schema verified 2026-11-14) |
| 162 | `ship_spelljammer` replica identity (realtime snapshot merge) | applied (logic; not anon-verifiable) |
| 163 | Mandatory Deck card + hull/deck split + legacy snapshot rewrite | applied (data rewrite; not anon-verifiable) |
| 164 | Per-card box state + hittable hull | applied (data rewrite; not anon-verifiable) |
| 165 | New generic-crew defaults + station state (`mc_reduction`, `sail_max_step`, `sail_trim_step`, `ram_used_turn`) | applied (schema verified 2026-11-14) |
| 165 | Halloween Siege saved sequences: `halloween_siege_presets` (name + plan jsonb; global DM library RLS via `create_scenario`) | applied (schema verified 2026-11-14) |
| 166 | Cargo manifest: `ship_templates.manifest` jsonb (array of `{name, category, mass}`) | pending |
| 167 | Remove crew quarters: seed Food & water manifest, drop `ship_templates.crew_quarters` + the built-in catalog row | pending |
| 168 | Cargo manifest units: convert `{name,category,mass}` → `{name,category,quantity}` on templates + placed-ship snapshots | pending |
| 169 | Ship card-state naming + universal card-step ledger: rename `ship_spelljammer.weapon_state` → `card_state`; keep `weaponState` as a legacy command-log alias | pending |
| 170 | DM-hidden ships: `ship_spelljammer.hidden` boolean (default false) | pending |
| 171 | Persistent player ships: `player_ships`, `player_ship_versions`, shared serial counter, ship links + dry-dock lease RPCs (renamed by 174) | applied |
| 172 | Claim an ordinary placed ship as a player ship (`convert_ship_to_player`) + initial v1 version | applied |
| 173 | Claim with confirmation name (`convert_ship_to_player(p_ship_id, p_name)`) | pending |
| 174 | Rename `player_ships` → `ship_player` and `player_ship_versions` → `ship_player_versions`; RPC bodies + policies/indexes updated | applied |
| 175 | Dry-dock refit: `ship_armors.cost_per_ton`, `min_hp_attained` (player/instance/version), version `snapshot_before`/`invoice`/`total_cost`, `ship_spelljammer.dry_dock_revision`, `ship_cargo` price catalog, public catalog read policies | applied |
| 176 | Campaign ships: drop `ship_player*`, create `ship_campaign` versions, `ship_spelljammer.campaign_id`/`campaign_carrier`, per-scenario slot index, carrier mirror + promotion triggers, scenario-label bake trigger, declare/convert/rename/fork/delete RPCs, `CAMPAIGN` sub-step | applied |
| 177 | Content ownership: `owner_id` on the authoring tables, `is_admin_user`/`owns_content`/`enforce_content_owner` trigger (creator-locked edits, NULL = admin-only), normalises the old `created_by` columns | applied |
| 178 | Campaign numbering: server-authoritative `fork_campaign_version` (family max + 1, rename resets to 1), `roman_numeral`, owner-only `renumber_campaign_family` repair | applied |
| 179 | Fix ambiguous `numeral` in `fork_campaign_version` (rename the PL/pgSQL variable and CTE column) | pending |
| 180 | Ship weapon `max_targets` (default 1, `>= 1`; Mangonel rows seeded to 3) | pending |
| 181 | Drop `ship_weapons.damage_formula` (ship weapons use authored `damage`; ram uses a derived formula) | pending |
| 182 | Ground movement + atmosphere pools + claw threat: `ship_components.is_terrain_legs`/`ground_mp`, `ship_weapons.threat`, `ship_spelljammer.mp_spent`/`fp_spent`, ship field mapping | pending |
| 183 | Drop unused catalog `image_url` plus free-form `ship_components.effect` and `ship_weapons.special` notes | pending |

### Verify what's actually applied

Authoritative check (service role / Supabase SQL editor). The anon REST key
cannot read `supabase_migrations`, so use this to confirm the order:

```sql
SELECT version
FROM supabase_migrations.schema_migrations
WHERE version >= '134'
ORDER BY version;
```

Structural spot-checks (work with the anon REST key too — a missing column
returns 400/404, an existing one returns 200 even when RLS hides the rows):

```sql
-- column present?
SELECT column_name FROM information_schema.columns
WHERE table_name='units' AND column_name IN ('attacks_used','effects','darkvision');
-- Phase-2 aerial/effect columns (108, 110–112, 115)?
SELECT table_name, column_name FROM information_schema.columns
WHERE table_name IN ('units','map_effect_templates')
  AND column_name IN ('elevation','fly_speed','fly_speed_available','climb_to','permanent')
ORDER BY table_name, column_name;
-- table present?
SELECT to_regclass('public.maps'), to_regclass('public.ship_templates');
-- realtime publish?
SELECT tablename FROM pg_publication_tables
WHERE pubname='supabase_realtime' AND schemaname='public';
```

Anon REST probe example: `GET /rest/v1/units?select=str_sav,str&limit=0`.
`200` proves both columns exist; `400` means one is missing. RLS may return an
empty array, so this verifies schema presence, not data presence.

## RPC inventory (SECURITY DEFINER, `SET search_path = public`)

| RPC | Writes | Notes |
|---|---|---|
| `execute_command` | scenario_command_log + units/scenario_team_alliance/scenarios via `apply_substeps` | caller must be a participant; ALLIANCE/SCENARIO sub-steps GM-only |
| `undo_commands` / `redo_commands` | soft-delete/restore scenario_command_log rows + inverse deltas | owner-or-GM; redo invalidated by any newer live seq |
| `undo_state` | none (reads) | returns `{undo:{ids,count,description,playerName,canUndo}, redo}` |
| `set_player_role` | user_profile role | admin panel |
| DM heartbeat | scenarios.dm_heartbeat_at | GM every ~5s |
| `user_has_access(permission)` | none | matrix check for RLS |

## Realtime publications

Published tables (target): `scenario_command_log`, `scenarios`, `units`,
`scenario_team_alliance`, `scenario_participants`, `scenario_replay_state`
(postgres_changes). Broadcast channels (ephemeral, per scenario):
`messages:{id}`, `replay:{id}`, magic-cast placement + rotation, ping/lock.
Details in `05`.

## Migrating (adding a migration)

1. Number it above the highest applied (current ceiling: 098).
2. If it writes a unit field through sub-steps, extend `unit_field_to_column`
   in the same migration (see 060/075 for the pattern) — the server allowlist
   is the guard.
3. Keep it idempotent where practical (`ADD COLUMN IF NOT EXISTS`,
   guarded `DO` blocks) — the project has re-run migrations manually.
4. Update the status table above and the AGENTS.md work summary once applied.
