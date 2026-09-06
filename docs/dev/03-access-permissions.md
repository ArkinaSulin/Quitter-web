# 03 — Access, Roles & Permissions

There are two independent permission layers:

1. **Global app access** (`profiles` role + `access_roles` matrix) — decides
   which pages/buttons exist (Unit Library, Shipyard, Map Library, Create/Join/
   Replay, Admin Panel, Settings).
2. **Per-scenario play control** (`scenario_participants.role` +
   `scenario_role_capabilities` + team/alliance + turn) — decides who may
   move/attack/edit which units on a given battle map, and when.

## Layer 1 — Global app access

- `auth.users` is reserved; the app-facing identity row is `public.profiles`
  (`id` PK→`auth.users`, `display_name`, `role`). A DB trigger
  (`handle_new_user`, migration 023) auto-creates a profile on signup; the
  client upsert in `useProfile.ts` is an idempotent fallback.
- **Role** is `profiles.role` — `admin`/`dm`/`player`/`NULL`(= pending) —
  changed only by the admin-only `set_player_role` RPC (never by direct
  UPDATE). The `access_roles` **matrix** (migration 025) maps each role to
  boolean capabilities, read by the `user_has_access(permission)` helper for
  RLS. `useProfile` exposes `Access { canUseUnitEditor,
  canCreateScenario, canJoinGame, canViewReplay, canViewShipEditor,
  canUseShipEditor, canViewMapEditor, canUseMapEditor, canUseAdminPanel }`.
- **RLS pattern:** policies call `user_has_access('view_unit_editor')` etc.
  (SECURITY DEFINER). Editing a row in `access_roles` changes what a role can
  do everywhere — code (button visibility) and DB (policies) — with no code
  change.
- Unknown/no profile → `'pending'` role: may browse and watch replays only.
- Admin panel: `set_player_role` RPC (approve pending → player/dm/admin) with
  audit columns; admin is hard-coded (`role === 'admin'`), not a matrix cap.

## Layer 2 — Per-scenario play control

### The capability matrix

`scenario_role_capabilities` (migration 030) rows for `Player`,
`SuperPlayer`, `AssistGM` (GM bypasses everything). Capability flags:

`move_*` (own_team / own_alliance / any_team), `adjust_*_stats`,
`view_*` (same three scopes), `assign_unit_team`, `change_unit_visibility`,
`add_unit`, `choose_map`, `change_user_role`, `kick_player`, `close_room`.

Type + helpers: `src/types/gameProtocol.ts`, `src/lib/scenarioPermissions.ts`.

### Scope resolution

`scopeContainsTeam(scope, playerTeam, unitTeam, alliances)`:
- `any_team`: always true (breadth is in the capability).
- `own_team`: `unitTeam === playerTeam`.
- `own_alliance`: unit's alliance group == player's team's alliance group.
- An unassigned player (team null) only ever gets `any_team`.

### The action gates (used by ScenarioMap)

| Gate | Rule (implemented) | Where |
|---|---|---|
| `canControlUnit(u)` | GM bypass · else role move-scope contains team · else if `freeMove || turn===null` allow · else require `turn === myAlliance` AND unit alliance === turn | `canActOnUnit` in `scenarioPermissions.ts`, plus team/turn wiring in `ScenarioMap.tsx` |
| `canEditUnit(u)` | GM · else capability `adjust_*` scope contains the unit's team | `canAdjustUnit` |
| `canViewDetail` | GM · else `view_*` scope | `canViewDetail` |
| `canReactToUnit` | `isGM ∨ same team` — **no turn gate** (an archer reacts to hostile movement even off-turn) | ScenarioMap reaction logic + `useReactionActions` |
| `controlsLocked` | `inReplay ∨ dmGone` — drags/clicks/context/undo/keyboard/modals all disabled | `useHexGrid.readOnly` + ScenarioMap guards |

Move capability implies attack capability (one check covers both).

### Turn gating (the important nuance)

From **Turn 1 on**, a non-GM player may only act:
- during their own alliance's turn, and
- on units that belong to that same alliance.

This applies to every role including `move_any_team` (AssistGM). During
**free play** (turn null / free_move ON, the default state of a fresh
scenario) the role scope is the only gate — everyone can set up freely.
The GM always bypasses (via `permRef`/`canActOnUnit`).

### Participant plumbing

- `scenario_participants.team` defaults… teams are picked by the GM
  (`Players` tab). Unassigned player = spectator (read-only unless `any_team`).
- Teams → alliances via `team_alliances`. Teams with no row default to
  `friendly` (migration 054 seeds friendly rows for all six teams).
- Roster/alliance changes reach players through realtime **and** a 10s +
  window-focus poll (realtime `postgres_changes` events were found unreliable
  for these tables). See `05`.

### Hidden units

Only the GM sees hidden tokens. Hidden units: no hover/tooltip, no context
menu, no double-click edit (for non-GM), **cannot be attached to**, cannot be
attack targets, cannot be reaction targets/movers. They still block movement
(they occupy their hex). Non-GM players can't select them as targets at all
(guards across `useCombatActions`/`useReactionActions`).

### Access capability (page-level) quick table

| Page/cap | admin | dm | player | pending |
|---|---|---|---|---|
| Unit Editor view (`can_view_unit_editor`) | ✓ | ✓ | ✓ | ✗ |
| Unit Editor edit (`can_use_unit_editor`) | ✓ | ✓ | ✗ | ✗ |
| Map Editor (view/edit) | ✓ | ✓ | ✗ | ✗ |
| Ship Editor (view/edit) | ✓ | ✗ | ✗ | ✗ |
| Create scenario | ✓ | ✓ | ✗ | ✗ |
| Join game | ✓ | ✓ | ✓ | ✗ |
| Replay | ✓ | ✓ | ✓ | ✓ |
| Admin panel / Settings | ✓ | ✗ | ✗ | ✗ |

Seeded by migrations 025/050/059/074 — the seed is the authority, not this
table, if they drift.
