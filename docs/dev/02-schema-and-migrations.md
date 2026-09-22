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
| `scenarios` | One battle. `name`, creator, password_hash, `map_data` jsonb, screenshot, `turn_number`, `current_turn_alliance`, `free_move`, `room_open`, deletion-request columns, `dm_heartbeat_at` | creator is the GM |
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
| `ship_frames` … `ship_crews`, `ship_templates` (+ join tables) | Archfar's Shipyard template data | see `16` |
| `ship_spelljammer` | Placed ship instances (engine pending) | reserved |
| `units.effects` | jsonb `UnitEffect[]` on the units row (not a table) | migration 073 |
| Storage buckets | `scenario_screenshots`, `unit_images`, `map_images`, `effect_images`, `structure_images` | public read |

> The migration inventory below refers to tables by the names they had **at the
> time of that migration**; see the rename table above for current names.

## The units table (battlefield state, key columns)

Full column list is in `src/types/gameProtocol.ts` (`Unit`) and the
row↔unit mappers (`useSupabaseSync`). The columns that drive the rule system:

- Stats: `level`, `troop_hp`, `max_unit_hp`/`current_unit_hp`,
  `max_troop_count`/`current_troop_count`, `number_of_attacks`, `str..cha`
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
| 066–067 | ship schema + seed | ❓ (code is canonical for ship data) |
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
| 098 | consistent table renames + function/view rebind (see convention above) | ⏳ run in Supabase (apply 081/093/095 first) |

### Verify what's actually applied

```sql
-- column present?
SELECT column_name FROM information_schema.columns
WHERE table_name='units' AND column_name IN ('attacks_used','effects','darkvision');
-- table present?
SELECT to_regclass('public.maps'), to_regclass('public.ship_templates');
-- realtime publish?
SELECT tablename FROM pg_publication_tables
WHERE pubname='supabase_realtime' AND schemaname='public';
```

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
