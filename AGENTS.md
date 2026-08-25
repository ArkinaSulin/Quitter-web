## Work Summary (Anchored)

The last conversation reworked movement into the **"1 action = 1 full MP pool"** economy (auto-refill on MP depletion, soft enforcement) on top of the full turn economy (movement cost + action spending, confirm modals + red notifications). Building on earlier work (combat system, data-driven size caps, multiplicative formation movement, tabbed panel + dock toggle + action badge). Here's the state:

### Completed

- `src/lib/moveCost.ts` + `moveCost.test.ts` (28 tests): `computeReachableMap(unit, maxMP, occupied, threatHexes)` over state space `(hex, facing)` — 1 MP per front-arc step, 1 MP per 60° turn; threat hexes reachable but never passed through; occupied excluded; Routed/Scattered/**Hero** move any direction at 1 MP/hex (loose). Plus the action-refill helpers: `computeMoveBudget` (leftover MP + `maxMP × max(1, actions)`), `applyMoveCost` (spends materialized MP first, converts an action to a full pool only when MP is exhausted; final MP = last pool's remainder, leftover stays usable), `applyMpSpend` (single-MP spend converts an action into a full pool when MP insufficient), `isMoveAffordable`, `computeMovePool` (full pool when actions ≥ 1, else leftover MP). Replaced `getReachableHexes` in ScenarioMap so the drag overlay and executed move cost share one source.
- `src/lib/formationCost.ts` + `formationCost.test.ts` (6 tests): `applyFormationChange(currentMP, steps, oldMax, newMax)` — 1 MP per org-level step + proportional floor rescale, clamped to `[0, newMax]`. MP stays integer.
- `src/hooks/useGameEngine.ts`: `MOVE` via `applyMoveCost` (path MP spent first, action converts a fresh pool only when MP exhausted); `ROTATE` −1 MP via `applyMpSpend`, **non-hero only**; `FORMATION` via `applyFormationChange`, hero skips MP; `ATTACH_HERO`/`DETACH_HERO` −1 **hero** MP via `applyMpSpend` (action only on refill); `ATTACK` adds an action-deduction sub-step (spent even on AGR failure); `END_TURN` resets to **2 actions / 0 MP**. All deltas ride the command log so undo restores them.
- `src/components/ScenarioMap/ScenarioMap.tsx`: `handleUnitMove` reachability uses `computeMoveBudget` (leftover MP + action pools) and gates with `isMoveAffordable` (confirm modal when the move exceeds leftover MP + action pools); drag overlay = `computeMovePool` (one full pool when actions ≥ 1, else leftover MP); `handleDetachHero` uses `applyMpSpend`; shared `computeOccupiedHexes`/`computeThreatHexes` helpers.
- **Units start/reset at 2 actions / 0 MP**; MP is materialized when a move converts an action, and the move cost is spent from leftover MP first (so leftover MP is never wasted — it's the "still have 2mp" fix). `useSupabaseSync.ts` spawn sets `movementPointsAvailable: 0`, `actionsAvailable: 2`.
- Soft enforcement (never hard-blocks): a move exceeding leftover MP + action pools or an attack with 0 actions shows a confirm modal; confirming deducts fully (may go negative) and pushes a red notification.
- `src/contexts/MessageContext.tsx`: `GameMessage { text, tone: 'default' | 'error' }`, new `addError()`; `MessagesPanel.tsx` renders error-tone rows red.
- `src/components/ScenarioMap/UnitTooltip.tsx`: `Move: {floor(movementPointsAvailable)}/{max}` (actual materialized MP, drains per pool) + `Actions: {n}/2` (red when ≤ 0) with a `(1 = full move)` hint.
- `src/hooks/useSupabaseSync.ts`: spawn `movementPointsAvailable: 0`, `actionsAvailable: 2`.
- Earlier completed: combat system (`unitCombat.ts`, 55 tests), size_categories data-driven row caps, `movement_multiplier`/`row_capacity_multiplier` on formations, tabbed left panel (Map → Alliances → Unit Selector → Messages, defaultWidth 400), dock toggle (hollow triangle, mirrored handles docked right), action badge on tokens (`drawActionBadge`/`getActionColor`), brace removed (optional rule in HANDBOOK §7.3).
- Docs: HANDBOOK §6.7/§6.10/§7.9/§7.10, `.scratch/movement-actions-tracking/spec.md` (status done), handover.md. `tsc --noEmit` clean, 145 tests pass.
- Bug fixes: `checkDMOnline` (useScenarios.ts:199) watched an empty `presence_check:` channel — reverted to `presence:${scenarioId}` so non-creators can join when the GM is online; `endTurn`/`handleEndTurn` double-incremented `turn_number` when the realtime event landed before the functional `setTurnNumber(t => t + 1)` — `endTurn` now returns the absolute `newTurnNumber` and `handleEndTurn` sets it explicitly (idempotent, race-free). Migration 013 applied to the DB.
- **Message sync**: `src/hooks/useMessageSync.ts` bridges the local `MessageContext` to a Supabase Realtime **broadcast** channel `messages:${scenarioId}` (`self: false`, event `game-message`) via a **per-scenario shared registry** — ScenarioMap + useGameEngine share one channel so received broadcasts dispatch exactly once; pre-subscribe messages buffer and flush on SUBSCRIBED. Every message producer now routes through it (`useGameEngine` uses the sync hook too), so combat/rout/move/undo messages broadcast, not just ScenarioMap-direct ones.
- **Rear-attack fix**: `unitCombat.ts` — a rear attack now forces `strikerFirst='attacker'` and skips retaliation (was only the AGR skip), so a defender hit from behind can't strike first even with reach.
- **Global display name**: `supabase/migrations/015_profiles.sql` adds `public.profiles` (`id` → `auth.users(id)`, `display_name`, timestamps; RLS: select-all, insert/update own). `src/hooks/useProfile.ts` loads/creates the row from `user_metadata` fallback (`full_name → name → email`) with a module-level cache across mounts; Lobby header name is now a clickable chip opening a Change/Cancel modal; ScenarioMap `playerName` prefers `profiles.display_name` so command-log/message senders use it.
- **Spelljammer module design docs**: `.scratch/spelljammer-mod/spec.md` (new) + HANDBOOK §17 (self-contained rules chapter) + §14.2/§14.3 status. Locked design: ships are hero-like (full actions, full movement, no retaliation/morale/rout, no 5-attack cap — RoF = weapons × loading × crew); sub-turn toggle (OFF = ships as ground combatants; ON = space scenario, turn = 5 segments, 1 action/hero/segment, per-action undo, reloads tick segment-end); on-the-fly movement (Helm action ≤ current speed, Propulsion Surplus gates step changes, cap Speed 10/12, min-straight `speed/3`); stations + crew reserve automation; damage = subsystem units with own HP, uniform-random pick from alive component list, double-wound to Ship HP, ship-wide damage threshold spills to manning hero, Ship HP 0 = destroyed regardless of stations, heroes never auto-die (VTT handoff); crits = targeted subsystem (Helm/Bridge protected) or 2× random; Captain's Int commands; boarding out of scope.
- **Archfar's Shipyard entry point**: migration `059_ship_editor_access.sql` adds `access_roles.can_view_ship_editor` + `can_use_ship_editor` (admin-only, extends `user_has_access` with `view_ship_editor`/`ship_editor`); `useProfile` exposes `canViewShipEditor`/`canUseShipEditor`; Lobby left panel shows an admin-only **Archfar's Shipyard** button opening a placeholder modal (builder gated later by `canUseShipEditor`).
- **Unit 5-attack cap + hero 5-action economy**: migration `060_attack_cap_hero_actions.sql` (`units.attacks_used`, `movement_points_available` → NUMERIC, settings `unit_attack_cap`/`hero_actions_per_turn`, allowlist `attacksUsed`). `src/lib/attackCap.ts` (soft cap: every ATTACK command counts +1 incl. free/charge/AGR-failed; attacker-at-cap pause+modal+red msg; retaliator-at-cap pause+modal, declined = suppressed via `suppressRetaliation(..., atCap)`, stashed-resume keeps the same dice). `src/lib/moveCost.ts` hero variants: heroes start each turn at **FULL MP + 5 actions** (units 0 MP / 2 actions); each further action converts `maxMP/5` MP (1 decimal, fraction carries, display floors), `applyHeroMoveCost`/`applyHeroMpSpend`/`computeHeroMoveBudget/Pool`/`isHeroMoveAffordable`; attach/detach/swap ask "convert [#] actions to 1 MP?" when MP < 1; `endTurn`/spawn reset heroes to full MP + 5 actions, units 0 MP/2 actions + `attacksUsed 0`; tooltip `Actions: n/5` hero + `Attacks: n/5` units. 334 tests, `tsc --noEmit` clean. Migrations 059/060 applied to the DB.

### Active

- (none)

### Blocked

- (none)

### Pending

- **Spelljammer module implementation** (docs + access caps done; no engine code yet): ship entity + subsystem tables (`ships`, `ship_subsystems`, `ship_weapons`, `ship_crew`, `ship_stations`), `src/lib/shipMoveCost.ts`/`shipCombat.ts`/`shipStats.ts` + tests, `src/types/ship.ts` + `shipMappers.ts`, `src/hooks/useShipEngine.ts`, `src/components/ScenarioMap/ShipPanel.tsx`, sub-turn toggle engine setting, ship token rendering. Migration 059 needs applying to the DB.
- **Archfar's Shipyard builder** (button + placeholder modal shipped; builder gated by `canUseShipEditor`).
- **Player→Team assignment tab** (deferred, blocked on auth decision): new GM-only LeftPanel tab between Map and Alliances. Mirrors `AlliancePanel` drag-drop — player chips (non-DM `scenario_participants` rows) dragged into one drop box per team (blue/yellow/violet/black/orange/green). Persist via `scenario_participants.team` + optimistic upsert, same pattern as `team_alliances`. Player label: read the player's global `profiles.display_name` — the host cannot read `auth.users` client-side, so names are written by the player's own client (`useProfile` creates the row from `user_metadata` fallback on first load).
- **Auth/provider decision** (blocking the above): switching login to email/Google/Discord, or Discord-only. Provider-agnostic for the tab (option 1 above works for all); only affects which metadata key populates `display_name`.
- **End Turn GM-only** (decided Option A, not yet implemented): hide the End Turn button for non-GM players in `ScenarioMap.tsx` (~lines 1151-1162); `Turn {n}` counter stays visible. Matches the creator-only UPDATE RLS on `scenarios` so the write always succeeds when the button shows.
- Migration `013_turn_tracking.sql` — applied to the DB (done).
- Migrations 010/011/012 — user applied to the DB.
- `UnitEditor.tsx`: `isHero` toggle should force `'Hero'` formation — postponed until the consolidated interface update.

## Agent skills

### Issue tracker

Issues live as local markdown files under `.scratch/`. See `docs/agents/issue-tracker.md`.

### Triage labels

The five canonical roles map to their default names (e.g. `ready-for-agent`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context repo — one `CONTEXT.md` + `docs/adr/` at the root. See `docs/agents/domain.md`.
