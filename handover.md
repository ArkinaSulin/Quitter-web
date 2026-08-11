# Handover — 2026-08-03

## Lobby "Room Open" badge now tracks live DM presence (2026-08-11)
**Files:** `src/hooks/useScenarios.ts`, `src/components/Lobby.tsx`

- The scenario card's Room Open/Closed badge was driven by the DB `room_open` toggle. It now reflects **live presence**: the lobby subscribes a read-only presence channel per scenario (`subscribeToLobbyPresence`) and flips `dmOnlineByScenario[scenarioId]` when a GM enters/leaves. Badge shows **Room Open** while the DM is in the scenario, else Room Closed.
- Cleanup on scenario-list change/unmount via `unsubscribeFromLobbyPresence`. `joinScenario`'s DM-online gate (`checkDMOnline`) is unchanged.
- 309 tests; `tsc --noEmit` clean.

## Unit Library: read-only access for players via can_view_unit_editor (2026-08-11)
**Files:** `supabase/migrations/050_access_view_unit_editor.sql` (new), `src/hooks/useProfile.ts`, `app/unit-editor/page.tsx`, `src/components/UnitEditor.tsx`, `src/components/Lobby.tsx`

- **Migration 050**: `access_roles.can_view_unit_editor` BOOLEAN (default false), seeded **true for admin/dm/player, false for pending**; `user_has_access` gains the `view_unit_editor` case. **Server-side enforcement**: `unit_templates` RLS enabled — SELECT requires `view_unit_editor`, INSERT/UPDATE/DELETE require `unit_editor` (so players can't write via the API despite the read-only UI). **Apply to the DB.**
- **`useProfile`**: `Access.canViewUnitEditor` added to the matrix (select/fallback/EMPTY_ACCESS).
- **`app/unit-editor/page.tsx`**: entry allowed when `canViewUnitEditor || canUseUnitEditor`; passes `readOnly={!canUseUnitEditor}`.
- **`UnitEditor`**: new `readOnly` prop — editable form wrapped in `<fieldset disabled>`; New/Clone and the sticky Save/Save As/Delete bar hidden; Change Image hidden; all write handlers (`updateFormData`, weapon add/edit/remove, new/clone/save/saveAs/delete, image picker) early-return in readOnly; header shows a "Read-only view — editing requires a DM or admin" badge. Browsing/searching/selecting templates stays active; preview test controls stay live.
- **`Lobby`**: button now reads **"Unit Library"** and shows for `canViewUnitEditor || canUseUnitEditor` (was edit-only).
- 309 tests; `tsc --noEmit` clean.

## Formation change cost: flat % of effective movement, not MP per step (2026-08-10)
**Files:** `src/lib/formationCost.ts` + test, `src/hooks/useGameEngine.ts`, `src/components/ScenarioMap/ScenarioMap.tsx`, `supabase/migrations/049_formation_cost_percent.sql` (new)

- **Old**: formation change cost `steps × 2` MP (`formation_change_cost_per_step = 2`). Fast units hopped formations cheaply in one turn; a Phalanx (effective max ~1–2) paid ~2 actions for a single change.
- **New**: a change costs a **flat fraction of the unit's current effective movement** (the full MP pool one action converts to): `getFormationChangeMpCost(oldMax) = Max(1, ceil(oldMax × getFormationChangeCost()))`. Default **50%**.
- **`formation_change_cost_per_step`** setting is now a fraction (0.5 = 50%); migration 049 updates it (key kept, semantic changed). **Apply to the DB.**
- Since the fraction ≤ 1, a change never costs more than one action and never less than 1 MP. Example (base move 3): Scattered eff 4 → Open = 2 MP; Open eff 3 → Close = 2 MP; Close eff 2 → Phalanx = 1 MP; Phalanx eff 1 → Scattered (any steps down) = 1 MP. Leftover rescales: `floor(leftover × newMax / oldMax)`.
- **`steps` parameter removed** from `applyFormationChange` / `isFormationChangeAffordable` and from `pendingFormation` state (cost no longer depends on org-level step count); `useGameEngine.changeFormation` and `ScenarioMap.handleChangeFormation` updated. Confirm modal + red notification now use `getFormationChangeMpCost(unitMaxMP(unit))` and read "1 action".
- 309 tests (formationCost rewritten for flat-% model + example-sequence cases); `tsc --noEmit` clean.

## Area-effect shapes (circle/cube/cone) + magicDimension rename + compact Add-Weapon modal (2026-08-10)
**Files:** `src/lib/weaponParser.ts` + test, `src/types/gameProtocol.ts`, `src/components/WeaponEditorModal.tsx`, `src/components/ScenarioMap/MagicCastModal.tsx`, `src/hooks/useMagicCast.ts`, `src/components/ScenarioMap/ScenarioMap.tsx`, `supabase/migrations/048_weapon_shape.sql` (new)

- **Migration 048**: `weapons.magic_radius` → `magic_dimension` (idempotent DO block) + `shape TEXT NOT NULL DEFAULT 'circle'`. **Apply to the DB.**
- **Weapon string is now 15 fields**: `...,onSaveHalfOrNeg,savingThrow,shape` — `shape` appended at the **end** (no shift), missing → `'circle'`. `AreaShape = 'circle' | 'cube' | 'cone'`; `isAreaWeapon`/`formatWeaponDisplay`/`getWeaponDisplayText` use `magicDimension`.
- **Shape semantics**: `circle` = dimension is the **radius**; `cube` = **side length** (square centered on click); `cone` = **equilateral-triangle side length** — 60° sector drawn with apex at the **north** point of the triangle's centroid (click point), south edge replaced by an arc centered on the apex (opens south).
- **`magicRadius`/`magic_radius` → `magicDimension`/`magic_dimension`** renamed across: `weaponParser`, `gameProtocol`, `WeaponEditorModal` (compact left form: Name / Damage Dice+Healing / #Attacks·Atk·Range·MaxRange / **Shape·Magic Dimension (ft)·Half-Neg·Saving throw** / 4 toggles), `UnitEditor`, `MagicCastModal`, `ScenarioMap`, `useMagicCast` (open casts carry `rotation: 0`).
- **`MagicCastModal`**: draws the placed shape via `drawAreaShape` (canvas `translate`+`rotate`, then `arc`/`rect`/sector-arc), and `countCovered` uses `pointInArea` (rotates each dot into shape-local coords). **Mouse wheel rotates cube/cone** 15° per notch (`onWheel` → `rotateArea(rotation)`; circle ignored) with a "Mouse wheel rotates the cube · 270°" hint; `MagicCastState.rotation` + `rotate` event ride the same broadcast channel as placement so all clients see the same orientation.
- 304 tests (weaponParser 15-field shape round-trip + old-string default); `tsc --noEmit` clean.

## UnitEditor: unsaved-changes modal, full-width name/saves, formation order, weapon fonts (2026-08-10)
- **Unsaved-changes guard**: a dirty tracker (JSON snapshot vs `formData`) triggers a styled in-app modal (**Save / Don't Save / Cancel**) when you select a different template, click New/Clone, or Main Menu while edited-but-unsaved; a `beforeunload` guard covers tab close. `handleSave` now returns a boolean and marks the snapshot on success.
- **Layout**: Unit Name + Hero is now a **full-width row** above the 2-column grid; **Saving throws** is a full-width row below it. Grid rebalanced: LEFT = Race & Level, Token, Hit Points; RIGHT = Defense, Mount & Charge, Combat & Morale.
- **Formation availability** sorted `Hero, Scattered, Open Order, Close Order, Shield Wall, Phalanx` (Routed stays as the separate always-checked label; Hero is a normal checkbox).
- **Weapons group** fonts/padding shrunk to match the compact fields.
- `tsc --noEmit` clean, 303 tests pass.

## UnitEditor: compact 2-column layout + sticky Save bar (2026-08-10)
- **UnitEditor** mid panel re-laid out into a compact 2-column grid (same UnitTemplate fields): LEFT = Identity (Name/Hero), Race & Level, Token (Size 5-step equal-distance slider + Visual scale), Hit Points; RIGHT = Defense (Base AC/Movement/Armor/Shield), Mount & Charge, Combat & Morale (Aggressiveness/Base morale/Fearless), Saving throws (narrow boxes). Full-width below: Formation availability chips, Unit-Type icon grid (**6→7 cols**), Weapons, calculated summary (compact).
- **Behavior**: toggling **Hero** ON also checks **Fearless**; when **Fearless** is checked the **Base morale** input is disabled.
- **Sticky Save bar** (Save / Save As / Delete) pinned below the form — always visible without scrolling.
- Inline form primitives (`Cell`/`NumInput`/`ReadBox`/`Toggle`) added locally to UnitEditor (UnitEditorModal untouched).
- `tsc --noEmit` clean, 303 tests pass.

## DM editor: editable maxTroopCount + tightened layout (2026-08-09)
- **`maxTroopCount`** is now editable in the DM stat editor (R2 HP row: Current HP | Troop HP | **Max troops** | {Max HP} | {Troops}). `{Max HP}` and `{Troops}` recompute live from the draft; on save, changing `troopHp`/`maxTroopCount` pushes a new `maxUnitHp`, and if capacity shrank, `currentUnitHp` clamps to the new max and `currentTroopCount` clamps to the new max.
- **Layout**: window narrowed `540 → 460px`; number + derived cells use uniform `w-16` boxes (read-only values now styled like inputs via `ReadBox` so columns line up); saving-throw boxes narrowed to `w-10`; selects sized (Formation `w-32`, Mount `w-28`, Size `w-24`); rows left-aligned (removed `flex-1` spacers); toggles sit after fields.
- `tsc --noEmit` clean, 303 tests pass.

## Game-wide undo_stack_size setting + Lobby admin Settings editor (2026-08-09)
- **Bug**: undo only reached ~50 commands (session start) and redo never worked. Causes: (1) client stack `maxSize` was a hard-coded 50, evicting pre-session history in busy play; (2) `GameEngine.removeEntry` filtered the **redo stack**, so the undoer's own realtime UPDATE (from the `undo_commands` RPC soft-delete) wiped its just-created redo entry.
- **Migration 047**: seeds `undo_stack_size = 2000` into the game-wide `settings` table. **Apply to the DB.**
- **`GameEngine`**: `maxSize` is now a lazy getter reading `getSetting('undo_stack_size', DEFAULT_UNDO_STACK_SIZE)` (fallback 2000); `removeEntry(id)` removes from `stack` only (redo survives); `execute(...)` clears `redoStack` (a new action invalidates redo, matching `pushExternal`).
- **`commandHistory.buildStackFromLog`** slices to the setting (2000 default).
- **`SettingsModal.tsx`** (new): admin-only Lobby editor for game-wide settings — each row is key + description + a generic **JSON-text** value input; Save upserts then `invalidateSettingsCache()` + `loadSettings()` so running clients apply changes immediately.
- **`Lobby.tsx`**: separate **"Settings"** button beside "Admin Panel" (`role === 'admin'`).
- 303 tests (updated trim/removeEntry/cap tests + `execute`-clears-redo); `tsc --noEmit` clean.

## Compact DM stat editor + Undo debug panel refresh (2026-08-09)
- **`UnitEditorModal`** (scenario DM editor) regrouped into a one-screen grid: Identity (name + team chip + **Image**), HP (Current/Troop/{Max}/{Troops}), Armor ({Eff AC}/Base + Shield), Movement (MP left/Max MP/{Eff move}), Combat (Actions/Aggressiveness), Morale ({Current morale full-effective}/Base + Fearless), Formation + **Mount** + Can charge, Availability checkboxes, saving throws Str…Cha (labels above), Rank & Token (Level/Size/Visual scale), Weapons. **Save/Cancel pinned** in the footer (no scrolling to save); scroll area is `overflow-y-auto`. Derived `{...}` values recompute live from the draft.
- **Shared `ImagePickerModal`** extracted from UnitEditor (race icons + `unit_images` + upload + remove custom) — used by both editors.
- Modal gains `units` + `alliances` props (for full-effective morale); ScenarioMap passes them.
- **`useSupabaseSync.updateUnit`** now maps `mountId` → `mount_id` and `customImageUrl` → `custom_image_url` (were missing, same bug class as the Max-MP fix).
- **`UndoDebugPanel`**: now displayed oldest→newest (most recent **last**, inline with the message window), highlights the **last active (non-undone)** step, refreshes via realtime + a **5s interval + window focus**, and auto-scrolls to the bottom.
- `tsc --noEmit` clean, 302 tests pass.

## Unit edits broadcast a red message to everyone (2026-08-09)
- `useGameEngine.execute` now sends **EDIT_UNIT** descriptions via `addError` (red) instead of `addMessage` — so when anyone (incl. a player editing their own unit) edits a unit in the scenario DM editor, every client sees a red message. `tsc --noEmit` clean, 302 tests pass.

## Undo debug panel tab (2026-08-09)
- New left-panel tab **"Undo debug"** (curved-arrow-left icon, visible to everyone — `requiresGM: false`), via `src/components/ScenarioMap/UndoDebugPanel.tsx`.
- Lists the scenario's `command_log` (the undo queue), most recent first (limit 200): **Description | Actor (player_name) | Status (`---` / `undid` from `deleted_at`) | Chained (Y/N)**. Latest step highlighted amber.
- Live via realtime INSERT/UPDATE on `command_log` (scenario filter). `tsc --noEmit` clean, 302 tests pass.

## DM stat editor: missing updateUnit mappings (Max MP etc. never persisted) (2026-08-09)
- **Bug**: editing "Movement (max MP)" in the scenario DM editor did nothing — `useSupabaseSync.updateUnit` never mapped `movementPoints` → `movement_points`, so the DB kept the old max; the row's realtime UPDATE then reverted the local value. Moving with MP-left 6 vs stale max 5 made `applyMoveCost` turn the leftover into actions (0 MP / 3 actions).
- **Fix**: `updateUnit` now maps the 7 missing DM-editable fields: `movementPoints`, `troopHp`, `level`, `sizeCategory`, `visualScale`, `formationAvailability`, `isShielded` (all to their `mapUnitToRow` column names).
- `tsc --noEmit` clean, 302 tests pass.

## Movement now triggers routing (morale ≤ 0) + formation-aware morale (2026-08-09)
- **Bug**: a unit that moved into a position that dropped its morale to ≤ 0 did not rout — it only routed once combat happened (even with no casualties). Two causes:
  1. The **Free Move path** (`moveUnitFree`) never ran the post-move morale check — only `performMove` (normal/charge) did.
  2. The routing checks computed threat with the **default heuristic** (rear = ×2), while the **tooltip** used the formation's `threat_arcs`/`double_threat_arcs` — so the displayed morale could disagree with what the checks subtracted.
- **Fix**:
  - New pure `shouldRout(unit, units, alliances, formation)` in `unitMorale.ts` (morale ≤ 0, respects fearless/already-routing).
  - `computeEffectiveMoraleModifier(unit, units, alliances, formation)` now takes the **formation object** (was just a number) and uses its `morale_modifier` **and** threat arcs via `calcEnemyThreats` — matching the tooltip. All 10 combat/cast/cascade/customDraw callers updated to pass `formationsMap[X] ?? null`.
  - New `maybeRoutAfterMove(unit, targetHex)` in ScenarioMap runs the post-move check (moved unit + units adjacent to landing) and is now called from **both** `performMove` and the **Free Move** path, so movement always routs a broken unit.
- 302 tests (4 new: 3 `shouldRout` + formation-threat-arc consistency); `tsc --noEmit` clean.

## Team/Alliance self-heal refresh for players (2026-08-09)
- **Bug**: a player already on the map kept seeing all tokens as **blue/friendly** (alliance ring + assignment) until they quit and rejoined, even after the DM assigned them a team and set alliances. Team control worked; the alliance coloring/data didn't refresh live.
- Root cause path: `scenario_participants.team` and `team_alliances` load on mount + realtime `postgres_changes` (`event:'*'`), but events weren't reaching players' clients → stale "all friendly" until a fresh fetch (rejoin).
- **Fix**: `useParticipants` and `useTeamAlliances` now also **re-fetch every 10s and on window focus/visibilitychange** (`refreshRoster` / `refreshAlliances`), so DM team/role/alliance changes catch up within seconds regardless of realtime delivery. No code elsewhere needed — `myTeam`/`alliances` already drive control + rendering.
- Optional live-DB check if realtime still matters: `SELECT tablename FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public';` — ensure `scenario_participants` and `team_alliances` are published (migrations 029/031).
- `tsc --noEmit` clean, 298 tests pass.

## Server-Authoritative Undo (2026-08-09)
**Files:** `supabase/migrations/046_undo_rpc.sql` (new), `src/game/GameEngine.ts` + `GameEngine.test.ts` (new), `src/hooks/useGameEngine.ts`

- **Bug**: undo was client-side per-player; stacks only synced via command_log INSERTs, so remote undos (soft-deletes = UPDATEs) were invisible to other clients. A stale stack let a player undo their own move even after another player moved (out of order).
- **Migration 046**: `undo_commands(p_scenario_id, p_target_ids)` SECURITY DEFINER RPC — recomputes the **live top chain** from the log (walk back from last `deleted_at IS NULL` row through consecutive `chained`), rejects unless `p_target_ids` is exactly that chain, rejects unless caller is the scenario GM or owns the chain, then soft-deletes (idempotent, `deleted_at IS NULL` guard). **Apply to the DB.**
- **`useGameEngine.undo`**: pops locally, calls the RPC; on success applies the inverse (existing code). On rejection → `hydrateFromLog()` to reconcile + message "Cannot undo — another player has moved since…".
- **`subscribeToCommandLog`**: added an UPDATE listener — `deleted_at` set → `GameEngine.removeEntry(id)` (stack + redo); cleared → `undeleteEntry` (re-add, idempotent). Keeps all clients' stacks in sync with remote undo/redo.
- **`GameEngine`**: `peekTopChain()` (non-destructive), `removeEntry`, `undeleteEntry`; `pushExternal` now clears the local redo stack (a remote action invalidates redo).
- 298 tests (6 new GameEngine tests); `tsc --noEmit` clean.

## isHealing weapon flag + heal resolution + reusable weapon editor (2026-08-08)
**Files:** `supabase/migrations/045_weapon_is_healing.sql` (new), `src/lib/weaponParser.ts` + test, `src/lib/spellDamage.ts` + test, `src/lib/unitStats.test.ts`, `src/components/WeaponEditorModal.tsx` (new), `src/components/UnitEditor.tsx`, `src/components/ScenarioMap/{UnitEditorModal,ScenarioMap,ContextMenu,UnitTooltip,MagicCastModal}.tsx`

- **Migration 045**: `weapons.is_healing` (BOOLEAN default false) + **weapon-string shift** — `false` inserted right after the damage-dice field in every entry (units + unit_templates), idempotent. New 14-field format: `name,attackBonus,damageDice,isHealing,range,maxRange,magicRadius,reach,noRetaliation,freeAction,isTwoHanded,numberOfAttacks,onSaveHalfOrNeg,savingThrow`.
- **`weaponParser`**: `Weapon.isHealing` (index 3, missing → false); `formatWeaponDisplay` → `{name} {N}x +{B} {dice}(h) {range}hex {magicRadius}ft`. Applied in UnitEditor list, DM editor list, ContextMenu rows, UnitTooltip (`(h)` hint).
- **Reusable `WeaponEditorModal`** (extracted from UnitEditor's inline modal; self-fetches the `weapons` library; all fields incl. **isHealing checkbox next to Damage dice** + half/save + freeAction/noRetaliation). UnitEditor refactored onto it (dropped ~15 inline state vars). **UnitEditorModal (DM editor)** replaced the raw `weaponString` text field with a full weapon editor (list + add/edit/remove), saving a `weaponString` change through EDIT_UNIT.
- **Healing resolution** (same mechanic as damage, capped at maxUnitHp):
  - **Single-target** (`isHealing && magicRadius <= 0`): `performHeal` rolls the dice, heals the attacked unit (`min(maxUnitHp, current+heal)`, troops derived), `HEAL` substep, action cost unless `freeAction`, no AGR/retaliation/morale/arc/alliance checks.
  - **Area** (`magicRadius > 0`): flows through the magic cast window; `resolveSpellDamage` gained `isHealing` (each troop heals base capped at troopHp, **no save**); `handleResolveCast` applies heal up to maxUnitHp, no rout cascade; MagicCastModal hides the save stat/DC/half controls for healing ("Healing spell — restores HP…").
- 292 tests (weapon parser 14-field + heal mode in spellDamage); `tsc --noEmit` clean. **Apply migration 045 to the DB** (shifts all existing weapon strings).

## Spell Save Stats — weapons fields + unit 6 stat bonuses (2026-08-08)
**Files:** `supabase/migrations/044_spell_save_stats.sql` (new), `src/lib/weaponParser.ts` + test, `src/types/gameProtocol.ts`, `src/lib/templateMappers.ts`, `src/hooks/useSupabaseSync.ts`, `src/components/UnitEditor.tsx`, `src/components/ScenarioMap/UnitEditorModal.tsx`, `src/hooks/useMagicCast.ts`, `src/components/ScenarioMap/MagicCastModal.tsx`, `src/components/ScenarioMap/ScenarioMap.tsx`

- **Migration 044**: `weapons` gains `on_save_half_or_neg` (BOOLEAN default true) + `saving_throw` (TEXT default 'Dex'); `unit_templates` and `units` each gain `str/dex/con/"int"/wis/cha` (INT default **0**). These columns store the **save bonus directly** (not scores) — default 0. **No weapon_string rewrite** (dev stage; existing content fixed manually — older 11-field strings parse with defaults `true`/`Dex`).
- **`weaponParser`**: `SaveStat` + `SAVE_STATS`; `Weapon` gains required `onSaveHalfOrNeg` + `savingThrow`; string format is now 13 fields (indices 11–12); missing → `true`/`Dex`.
- **Add Weapon modal** (UnitEditor): Half/Negate checkbox + Saving Throw select, pre-filled from the picked library row, saved into the weapon string. Template editor gains a 6-stat "save bonuses" row; DM stat editor (`UnitEditorModal`) gains the 6 stat fields.
- **Stats plumbing**: `UnitTemplate`/`Unit` types, `templateMappers`, `useSupabaseSync` (row↔unit, `updateUnit`, spawn copies template→unit) all carry the 6.
- **Magic cast**: `MagicCastState.saveBonus` → `saveStat: SaveStat` + `targetStats` (the target's 6 bonuses captured at `openCast`). Modal replaces the Save Bonus stepper with **6 stat buttons** (active highlighted, showing the target's bonus); Save DC stepper stays; Half/Negate checkbox stays (defaults from `weapon.onSaveHalfOrNeg`). `handleResolveCast` uses `targetStats[saveStat]` as the save bonus.
- 287 tests (weapon parser 13-field round-trip + old-string defaults); `tsc --noEmit` clean. **Apply migration 044 to the DB.**

## Storage listing — paginate past the 100-item page limit (2026-08-08)
- Supabase Storage `list()` returns at most **100 objects per request** by default. It is NOT a hard total cap — you loop `limit` + `offset` to get everything.
- **`UnitEditor.tsx` `loadUserImages`** (unit_images) used bare `.list()` → silently capped at 100. Now paginates (pageSize 100, `offset += data.length`, break on short page).
- **`MapEditorPanel.tsx` `loadImages`** (map_images) paginated with `pageSize 1000` and advanced `offset += pageSize` — brittle if the server clamps the limit (could break early or skip pages). Now uses `pageSize 100` and `offset += data.length` (robust regardless of server cap).
- `tsc --noEmit` clean, 286 tests pass.

## Weapons Library: free_action + no_retaliation (2026-08-08)
- **Migration 043**: `weapons` table gains `no_retaliation` / `free_action` (BOOLEAN, default false). Existing ranged rows backfilled `no_retaliation = true` (preserves the prior modal heuristic `range > 1`). Spells are weapons (`magicRadius > 0`) and need these flags.
- **UnitEditor** "Add Weapon" modal now pre-fills both toggles from the picked library row: `setWeaponNoRetaliation(weapon.no_retaliation ?? (nextRange > 1))` and `setWeaponFreeAction(weapon.free_action || false)` (`applyWeaponFromLibrary`; `weaponsLookup` type extended).
- `tsc --noEmit` clean, 286 tests pass. **Apply migration 043 to the DB.**
- Todo added (`.scratch/potential-improvements.md` → "Magic / Spells"): **effect list** (buffs/debuffs with durations) and **saving-throw list in unitTemplate**.

## Settings 2nd Pass — more constants moved to `settings` (2026-08-08)
**Files:** `supabase/migrations/042_settings_more.sql` (new), `src/lib/settingsCache.ts` (+`getBandSetting`), `src/lib/unitMorale.ts`, `src/lib/unitStats.ts`, `src/lib/unitCombat.ts`, `src/lib/formationCost.ts`, `src/hooks/useGameEngine.ts`, `src/hooks/useSupabaseSync.ts`, `src/components/ScenarioMap/{ScenarioMap,ContextMenu}.tsx`

- **Migration 042 seeds** (all `getSetting`/`getBandSetting` with matching code fallbacks): `actions_per_turn` (2), `turn_start_mp` (0), `formation_change_cost_per_step` (2 → `getFormationChangeCost()`), `charge_full_distance` (2), `hero_attach_max_size` (200), `wounds_morale_factor` (10), `isolation_penalty` (1), `charging_threat_multiplier` (2), `threat_increment_level` + `threat_increment_troop_count` (band JSONB), `row_capacity_by_size` (band JSONB).
- **Threat rating** now reads level + troop bands via the new `getBandSetting(key, fallbackBands, input)` helper; **size** component stays hard-coded `(sizeCategory/100)²` by design.
- **Row-capacity duplicate fixed**: `unitStats.getRowCapacityBase()` is the single base-by-size source (`row_capacity_by_size` setting); `getRowCapacity` (size_categories table, fallback → base) and `unitCombat.computeRowCapacity` (base × mult) both delegate to it. Removed the unused `computeRowCapacity` import from ScenarioMap.
- **Turn/spawn**: END_TURN resets to `turn_start_mp` / `actions_per_turn` (`useGameEngine`); unit spawn uses the same (`useSupabaseSync`).
- **Charge/attach**: `chargeDistance < charge_full_distance` (full-charge free attack + overlay) and `hero_attach_max_size` (attach eligibility) read settings.
- 286 tests (2 new settingsCache band tests); `tsc --noEmit` clean. **Apply migration 042 to the DB.**

## Settings Table + Hero Attack Split 30% (2026-08-08)
**Files:** `supabase/migrations/041_settings.sql` (new), `src/lib/settingsCache.ts` + `settingsCache.test.ts` (new), `src/lib/unitCombat.ts`, `src/lib/unitCombat.test.ts`, `src/components/ScenarioMap/ScenarioMap.tsx`

- **Migration 041**: `settings(key TEXT PK, value JSONB, description, updated_at)`. RLS: SELECT for `authenticated`; INSERT/UPDATE/DELETE only for `profiles.role = 'admin'` (ready for a future admin Settings UI — no schema change needed). Seed: `hero_attack_split = 0.3`.
- **`settingsCache.ts`**: in-memory module cache mirroring `formationCache` — `loadSettings()` (fetch once), `getSetting<T>(key, fallback)` sync read, `invalidateSettingsCache()`. The supabase client is **dynamically imported** inside `loadSettings()` so lib files that only *read* settings stay importable in test envs (no Supabase env vars).
- **`unitCombat.ts:189`**: hero split now `Math.ceil(totalCount * getSetting('hero_attack_split', 0.3))` — **30%** (was hard-coded 25%). Code fallback matches the seed, so behavior is correct even before the cache populates.
- **Combat messages now report the split**: `CombatOutcome` gained `firstStrikeHeroAttacks` / `retaliationHeroAttacks` (the hero's own roll subset). The log line breaks the volley into the unit's share (`— X strikes first — N attacks, H hits, C critical, A damage (T troops)`) followed by the hero's own share (`. {Hero} took N attacks, H hits, C critical, A damage (T troops)`) — resolved against the hero's AC/troop HP, not a flat damage %.
- `ScenarioMap` mount calls `loadSettings()` (combat only runs there).
- 284 tests (3 new settingsCache tests mock the supabase client); `tsc --noEmit` clean. **Apply migration 041 to the DB.**
- Note: editing settings straight in the table is a stopgap — a **GM/admin Settings UI is a planned follow-up** (RLS + `invalidateSettingsCache()` already support it).

### Future: settings 2nd-pass candidates (still parked)
- **Combat/turn**: `agr_die_sides` (10, `unitCombat.ts:228`), `attack_die_sides` (20, `unitCombat.ts:93`), `crit_roll` (20) / `crit_multiplier` (2, `unitCombat.ts:161,167`), `morale_break_threshold` (<= 0).
- **Movement/charge**: `charge_over_cost` (2, charge-over modal).
- **Infra**: `undo_stack_size` (50, `GameEngine.ts:34`).
(Moved already: actions_per_turn, turn_start_mp, formation_change_cost_per_step, charge_full_distance, hero_attach_max_size, wounds_morale_factor, isolation_penalty, charging_threat_multiplier, threat_increment_level, threat_increment_troop_count, row_capacity_by_size.)

## Charge-Over (Overrun) After a Full Charge Attack (2026-08-08)
**Files:** `src/lib/chargeOver.ts` + `chargeOver.test.ts` (new), `src/lib/formationRules.ts` (used `canChargeThrough`), `src/hooks/useGameEngine.ts`, `src/components/ScenarioMap/ScenarioMap.tsx`

- After a **full charge attack** (`chargeDistance >= 2`), if all hold the attacker is prompted to ride over the target and land on its far side:
  1. attacker did not rout / was killed in that combat
  2. target is charge-through-able from the charger's approach arc (post-combat formation — **Routed** if the attack broke/killed it, else `charge_through_arcs` from migration 027; dense fronts only over-run-able from the flank)
  3. target is in the charger's front arc
  4. charger can afford **2 MP** (capacity incl. action pools) — this IS the cost of the 2-hex overrun, no extra charge
  5. the landing hex behind the target (cube `t*2 − c`) is empty
- **`chargeOver.ts`**: pure `computeChargeOverLandingHex` + `isChargeOverEligible` (8 tests). `performAttack` now returns `{ attackerRouted, attackerKilled, defenderRouted, defenderKilled }`.
- **Prompt** (`pendingChargeThrough` modal): Yes → `performChargeEnd(attacker, true)` **then** a standalone `MOVE` (2 MP via `applyMoveCost`) so the overrun is a **separate undo entry** (CHARGE_END stays chained to ATTACK). Attached hero mirrors the combined charge: −2 hero MP, hero hex follows. No → normal `performChargeEnd`.
- `moveUnitRecorded` gained an optional `description` override (charge-over logs "charged over X and landed at ...").
- 281 tests; `tsc --noEmit` clean.

## Replay for Pending Users — suppress "GM has left" banner (2026-08-08)
- Pending users (role NULL, `can_view_replay` per migration 025 access matrix) open replays via Lobby → `onReplayScenario` → `ScenarioMap replayMode`. Replay playback (`ReplayOverlay`, `useReplay`) was never gated by `dmGone`/`controlsLocked` — but the **"GM has left — controls disabled"** banner (`ScenarioMap.tsx`) showed for them because presence sees no GM, implying replay was locked.
- Fix: banner condition now also excludes `inReplay` (`dmGone && !isGM && !inReplay`). Live controls are locked by replay mode anyway; the overlay's play/seek/step controls are self-contained. Pending viewers already had command_log SELECT via migration 024, so the timeline loads.
- `tsc --noEmit` clean, 273 tests pass.

## Attached Hero: Front/Back Swap + Combined-Move MP Sharing (2026-08-08)
**Files:** `src/game/GameEngine.ts`, `src/lib/moveCost.ts` + `moveCost.test.ts`, `src/hooks/useGameEngine.ts`, `src/components/ScenarioMap/ContextMenu.tsx`, `src/components/ScenarioMap/ScenarioMap.tsx`

- **Front/Back swap** (`SWAP_HERO_POSITION` action): a context-menu item flips an attached hero between front (Leader) and back (Protected), costing **1 hero MP** via `applyMpSpend` (refills from a hero action when MP is 0; free under Free Move). Shown on **both** menus: the host's menu (between Rotate Right and Charge → `Move Hero to {Front|Back}`) and the hero's own menu (after Switch to Unit → `Move to {Front|Back}`). Undoable + realtime via the command log. A back-attached hero is untouched by the host's damage sharing; front shares (existing `attachedPosition` semantics).
- **Combined move drains BOTH MPs**: dragging a host with an attached hero deducts the path cost from host *and* hero (`applyMoveCost` each), and the hero's hex follows the host. `moveUnitRecorded`/`moveUnitFree` take an optional `attachedHero` and emit a second MOVE sub-step (one command → one undo). Over-budget uses the existing **confirm modal** (soft enforcement) with combined names/actions shown; confirming moves anyway and can push either side negative (red notification). The hero being dragged away is still a detach + solo move.
- **Charge** with an attached hero also drains the hero's MP (affordability checked on both).
- **`computeMoveCapacity(unit, maxMP)`** added (true capacity = leftover MP + actions×pool, no `Math.max(1, actions)` fudge) — documents the "either side at 0 ⇒ no further move" rule; drag overlay caps the host's reach at `min(host pool, hero pool)`.
- 273 tests; `tsc --noEmit` clean.

## Formation Change 2 MP/Step + Current-Formation Marker (2026-08-07)
**Files:** `src/lib/formationCost.ts` + `formationCost.test.ts`, `src/hooks/useGameEngine.ts`, `src/components/ScenarioMap/ContextMenu.tsx`, `src/components/ScenarioMap/ScenarioMap.tsx`

- **Formation change now costs 2 MP per org-level step** (`FORMATION_CHANGE_COST = 2`). `applyFormationChange` now uses the "1 action = 1 full MP pool" refill accounting (same rule as `applyMpSpend`): materialized MP is spent first, then an action converts to a full pool and only the shortfall is deducted. Returns `{ movementPointsAvailable, actionsAvailable }`; the engine pushes the `actionsAvailable` change to the command log so undo restores it.
  - Accounting example: with 1 MP left + 1 action, a 2 MP change spends 1 from leftover + 1 from the freshly converted pool → 3 MP, 0 actions.
- **Soft enforcement**: an over-budget change opens a confirm modal (`pendingFormation` in ScenarioMap) + red error notification when forced — same pattern as moves/attacks. `isFormationChangeAffordable(unit, steps, oldMax)`.
- **Context menu**: current formation renders as `>Open Order<` in amber + semibold (`ContextMenu.tsx`).
- 15 tests; `tsc --noEmit` clean, full suite 270 passing.

## Org Levels — System Note
- `ORGANIZATION_LEVEL` in `src/types/gameProtocol.ts` is **hard-coded** (Routed 0, Scattered 0, **Hero 0**, Open Order 1, Close Order 2, Phalanx/Shield Wall 3). NOT a `formations` table column.
- The DB's `units.organization_level` column is **denormalized** and **recomputed client-side on load** via `getOrganizationLevel(row.current_formation)` (`useSupabaseSync.ts`), and written back on formation change. So editing the levels map needs **no migration** — existing units reflect new levels immediately. A renumbering experiment (Routed 0 / Scattered 1 / Open 2 / Close 3 / Phalanx+Shield Wall 4) was tried and reverted.

## Threat Formula in Tooltip + Map Image Upload
**Files:** `src/lib/unitMorale.ts`, `src/components/ScenarioMap/UnitTooltip.tsx`, `src/components/ScenarioMap/MapEditorPanel.tsx`, `app/api/map-images/route.ts`, `supabase/migrations/028_map_images_bucket.sql` (new)

- **Tooltip threat row** now shows the formula with raw sums: `-N = (f+fl <sum> + r <sum>) ÷ <myThreat>` — the rear sum already includes its ×2 doubling. `calcEnemyThreats` returns `frontSideSum`/`rearSum`/`myThreat` alongside the rounded values (unitMorale tests updated to `toMatchObject`).
- **Map tab upload** now uses **Supabase storage** (consistent with `unit_images`/`scenario_screenshots`), not the server filesystem:
  - Migration **028** creates the `map_images` bucket (public read, authenticated upload/update/delete).
  - `MapEditorPanel` Upload Image button uploads to `map_images` via `supabase.storage`, sets it as current, and refreshes the list.
  - The image list is read **directly from storage client-side** (paginated past storage's 100-item default) — same pattern as `unit_images`, so there's no Next.js route to cache. The `/api/map-images` route was removed.
- **Apply migration 028 to the DB** before the upload works.

## Synchronous Auth Hydration (fixes login flash + unit-editor redirect)
**Files:** `src/lib/supabaseClient.ts`, `src/hooks/useAuth.ts` (new), `src/hooks/useScenarios.ts`, `src/hooks/useProfile.ts`, `app/unit-editor/page.tsx`

Two symptoms shared one root cause: auth was hydrated via `supabase.auth.getUser()` — a **network round-trip**. During that gap `currentUser` was null (Lobby flashed the sign-in button) and `useProfile`'s `loading` lagged a render behind (the unit-editor guard redirected admins before their role resolved).

- **`useAuth`** (new): subscribes to `onAuthStateChange`, which in supabase-js v2 fires a **synchronous `INITIAL_SESSION`** event from the stored session (localStorage — effectively a cookie). `user`/`authLoading` settle on the first paint; `getSession()` fallback settles no-session users too.
- **`useScenarios`**: `currentUser` now comes from `useAuth` (no network `getCurrentUser()` effect).
- **`useProfile`**: `loading` is now **derived** from a `resolvedUserId` state (`loading = userId !== null && resolvedUserId !== userId`), so it's `true` on the exact render where `userId` appears — not one commit later via an effect. This was the stale-commit race that kicked admins out of the editor. Settles on error too (role stays null/pending, no infinite spinner).
- **`app/unit-editor/page.tsx`**: userId from `useAuth`; shows a Loading screen until `ready = !authLoading && !loading && !accessLoading && !!userId`, then renders the editor or redirects. No flash-redirect.
- Security: hydration only — DB RLS still validates the JWT on every query.

## Formation Combat-Rule Matrix (data-driven)
**Files:** `supabase/migrations/027_formation_combat_rules.sql` (new), `src/types/gameProtocol.ts`, `src/lib/formationCache.ts` (new), `src/lib/formationRules.ts` (new) + test, `src/lib/unitCombat.ts`, `src/lib/unitMorale.ts`, `src/lib/moveCost.ts` (unchanged logic), `src/components/ScenarioMap/ScenarioMap.tsx`, `src/components/ScenarioMap/ContextMenu.tsx`, `src/components/ScenarioMap/UnitTooltip.tsx`

Formation combat rules moved out of hard-coded branches into the `formations` table (11 new columns). Editing a row changes combat with no code change.

- **Migration 027**: `melee_target_arcs`, `ranged_target_arcs`, `threat_arcs`, `double_threat_arcs`, `retaliate_arcs` (jsonb front/flank/rear → full/rows/none), `retaliate_vs_ranged`, `can_charge`, `stop_enemy_movement_arcs`, `charge_through_arcs` (reserved), `be_attacked_melee_modifier`, `be_attacked_range_modifier`; `Routed.attack_capacity_multiplier` set to 0. Seeded per the rule matrix (Scattered melee all-arcs @ mult 1 + beAttackedMelee 1.5; Routed melee/ranged none + beAttackedMelee 2.0; ranged vs Open/Scattered/Routed = 0.5; Hero all-arcs front).
- **`formationRules.ts`**: pure helpers (`canMeleeTarget`, `canRangedTarget`, `getThreatMode`, `getRetaliationMode`, `canFormationCharge`, `canStopEnemyMovement`, `canChargeThrough`, `beAttackedModifier`, `getEffectivePosition`). `unitCombat.resolveCombatSequence` now takes optional `attackerForm`/`defenderForm`; applies `beAttackedModifier` to attack counts both directions (defender's modifier on attacker's count; attacker's on defender's retaliation), uses table-driven retaliation, and drops shield (−2 AC) on routed units.
- **`formationCache.ts`**: session-cached `getFormations()`; ScenarioMap loads through it.
- **`ScenarioMap.tsx`**: melee/ranged gates via `canMeleeTarget`/`canRangedTarget` (Scattered can now melee all directions; Routed cannot attack at all); `isRear` via `getEffectivePosition`; `computeThreatHexes` uses `canStopEnemyMovement` (Scattered/Routed no longer block movement); formations load via cache.
- **`unitMorale.ts`**: `calcEnemyThreats` takes the formation row and uses `threat_arcs`/`double_threat_arcs`.
- **`ContextMenu.tsx`**: Charge button uses `canFormationCharge` from the matrix (via `formationsMap` prop).
- **`UnitTooltip.tsx`**: passes formation to `calcEnemyThreats`.
- Tests: new `formationRules.test.ts` (9) + full suite 229 passing, tsc clean.

### Future passes (noted)
- **DM stat editor on ScenarioMap** — edit any unit stat, undoable (log only changed fields in the chain).
- **Map tab reads a map image** in the left panel.
- **Undo message** `(+2 more)` → `[n] items undid`.
- **Downed heroes interactable** (recovery mechanics).
- **Hero + host context menus side-by-side** when stacked.
- **`charge_through_arcs`** wiring (reserved; needs "target other side empty + 2 MP" check).

## Role → Capability Access Matrix
**Files:** `supabase/migrations/025_access_matrix.sql` (new), `src/hooks/useProfile.ts`, `src/components/Lobby.tsx`, `app/unit-editor/page.tsx`

Privileges are now **data, not code** — editing a row in the `access_roles` table changes what a role can do (server-side RLS **and** client button visibility) with no code change.

- **Migration 025**: `access_roles(role PK, can_use_unit_editor, can_create_scenario, can_join_game, can_view_replay)` seeded `admin`/`dm` = all true, `player` = join+replay, `pending` = replay only. RLS: read-open. `user_has_access(permission)` SECURITY DEFINER helper (NULL profile role → `'pending'`). The 016 RLS policies for `scenarios` INSERT (was `role IN ('admin','dm')`) and `scenario_participants` INSERT (was `role IS NOT NULL`) now call `user_has_access('create_scenario')` / `user_has_access('join_game')`.
- **`useProfile`**: loads the matrix once per session (module cache), exposes `access { canUseUnitEditor, canCreateScenario, canJoinGame, canViewReplay }` derived from the current role.
- **`Lobby.tsx`**: button flags (`canCreateScenario`, `canUseUnitEditor`, `canJoin`, `canReplay`) come from the matrix instead of hard-coded role checks.
- **`app/unit-editor/page.tsx`**: guard now checks `access.canUseUnitEditor`.
- Admin panel stays hard-coded to `role === 'admin'` (not a matrix capability); `set_player_role` RPC unchanged.

## Pending Users: Reliable Signup + Read-Only Lobby & Replay
**Files:** `supabase/migrations/023_profile_trigger.sql` (new), `supabase/migrations/024_replay_pending.sql` (new), `src/components/Lobby.tsx`, `app/unit-editor/page.tsx`

**Bug fixed — new signups never appeared as pending.** Profile rows were created lazily by the client (`useProfile` upsert on first load); if `getUser()` raced or the upsert failed, the user had NO profile row — they saw the awaiting-approval screen and could submit a request (an UPDATE matching 0 rows), but nothing persisted and the admin panel listed nothing. Live DB had only 2 profiles, both approved, 0 pending.

- **Migration 023**: `handle_new_user()` SECURITY DEFINER trigger on `auth.users` AFTER INSERT auto-creates the pending profile (`display_name` from `raw_user_meta_data.full_name → name → email`; `role` NULL = pending). Runs as owner → bypasses the client/RLS fragility. Client upsert stays as idempotent fallback.
- **Client profile creation no longer races (`useProfile.ts`)**: the old effect bailed early (`if (cancelled || !user) return`) when `supabase.auth.getUser()` returned null on first paint after an OAuth redirect — so an `auth.users` row existed but the `profiles` upsert never ran (and never retried, deps = `[userId]`). Now `getUser()` is best-effort only (name fallback); the profile is always upserted from `userId` alone. This is the real fix for "signup has no profile row" independent of migration 023.
- **Pending users now get a read-only lobby**: banner ("Your account is awaiting approval — you can browse scenarios and watch replays while your access is reviewed") + request-note form **and** the normal lobby (scenario cards + left panel). Replay button uses new `canReplay = !!currentUser` (was `canJoin`), so pending users can replay; Join stays `canJoin` (pending can't play). Create/UnitEditor/Admin still role-gated; Delete requires `isCreator`.
- **Migration 024**: `command_log` SELECT policy `select_log_pending` — any authenticated user with a `profiles` row (pending included) can read logs for replay (read-only).
- **Search bar** (all users): filters scenario cards by name **and** the creator's live `profiles.display_name` (fetched once per scenario list; falls back to `scenarios.creator_name`), so renames are honored.
- **Unit-editor auth guard**: `/unit-editor` now redirects to the Lobby unless the user's role is `admin`/`dm` (the URL was previously open to pending/players).

## Two-Handed Weapons & Shield Rules
**Files:** `src/lib/weaponParser.ts` (+tests), `src/lib/unitStats.ts` (+ `unitStats.test.ts` new), `src/types/gameProtocol.ts`, `src/game/GameEngine.ts`, `src/hooks/useGameEngine.ts`, `src/hooks/useSupabaseSync.ts`, `src/components/ScenarioMap/ScenarioMap.tsx`, `src/components/ScenarioMap/ContextMenu.tsx`, `src/components/ScenarioMap/UnitTooltip.tsx`, `src/components/UnitEditor.tsx`, `supabase/migrations/022_is_two_handed.sql`, `.scratch/two-handed-weapons/spec.md`

- **`Weapon.isTwoHanded`** added to the CSV weapon string as field #11 (`...IgnoreAttackMultiplier,IsTwoHanded`); older strings default to `false`. `WeaponLookup.is_two_handed`, `Unit.activeWeaponIndex`.
- **Active weapon is now a broadcast unit field** (`units.active_weapon_index`), replacing the old session-local `selectedWeapons` state in `ScenarioMap.tsx`. Switching weapons is a logged `WEAPON_SELECT` command (free move — no MP/action), so undo/redo + realtime sync work; defender retaliation now uses the defender's active weapon (was always weapon[0]).
- **Rules** (reversible/effective — `isShielded` never mutated):
  - `getShieldPenalty(unit)`: 2 when shielded + active weapon two-handed, else 0. `selectWeapon` rewrites `currentAc = baselineAc - shieldPenalty`; tooltip shows `baseline − 2 (two-handed)` and Shielded reads `Yes (dropped — two-handed)`.
  - Selecting a 2H weapon while in Shield Wall is **blocked** (error message); `changeFormation` to Shield Wall is blocked when the active weapon is two-handed; ContextMenu disables the Shield Wall option.
  - Placement: a shielded unit spawned with a two-handed first weapon starts at `currentAc = baselineAc - 2`.
- **UI**: ContextMenu `2H` badge; UnitTooltip `[2H]` marker; UnitEditor Add/Edit Weapon modal Two-Handed checkbox (from `weaponsLookup.is_two_handed`).
- **Migration 022**: `weapons.is_two_handed`, `units.active_weapon_index`. **Apply to DB.** User will set `is_two_handed = true` on real weapon rows manually.
- Tests: weaponParser + new unitStats `getShieldPenalty` suite; 203 passing, tsc clean.

## Centaur Race Fields Not Loading (HD / speed / canCharge)
**Files:** `src/types/gameProtocol.ts`, `src/components/UnitEditor.tsx`

The `Race` type declared `baseSpeed`/`defaultTroopScale`, but the DB column is `base_speed` (and `defaultTroopScale` doesn't exist) — so race speed was never read. The race `<select>` handler also never applied HD, speed, or canCharge.

- `Race.baseSpeed` → `base_speed` (removed the nonexistent `defaultTroopScale`).
- Race dropdown `onChange` now sets `level = base_hd`, `movementPoints = base_speed`, `canCharge = can_charge`.
- `createBlankTemplate` seeds the same from the first race.
- Templates saved *before* this fix keep stale values — reopen + re-save to pick up corrected defaults.

## Combat Retaliation — Reach Simultaneous vs Ordered
**Files:** `src/lib/unitCombat.ts`, `src/lib/unitCombat.test.ts`, `src/components/ScenarioMap/ScenarioMap.tsx`, `.scratch/combat-system/spec.md`

Reach now decides both strike order and retaliation suppression:
- `suppressDefenderRetaliation` replaced by **`suppressRetaliation(outcome, retaliatorKilled, retaliatorRouted, simultaneous)`**.
- **Equal reach = simultaneous**: both sides exchange regardless of killed/routed; morale evaluated after both strikes.
- **Mismatched reach = ordered**: the non-reach side is denied its counterattack if the first strike killed or routed it.
- `performAttack` derives the retaliator's killed/routed from first-strike damage only (no circularity — the retaliator never takes its own retaliation), then final HP/morale both ways. Denial message: `. X killed/routed by the first strike — no retaliation` for either side.
- Tests: 3 old swapped for 5 new. Combat spec marked `done`.

## Routing Units Exert No Threat + Tooltip Readout
**Files:** `src/lib/unitMorale.ts`, `src/lib/unitMorale.test.ts`, `src/components/ScenarioMap/UnitTooltip.tsx`

- `calcEnemyThreats` now skips `other.isRouting` — a routed enemy pressures no one's morale (matches `computeThreatHexes`). 2 tests added.
- Tooltip `Threat:` row reads `0 routed, was X.XX` for a routing unit.

## Map Editor Real-Time Preview + 10× Scale
**Files:** `src/components/ScenarioMap/MapEditorPanel.tsx`

- Image select, Offset X/Y, and Scale sliders now forward `onPreviewChange` immediately — the map reflects changes live; Save still persists to `map_data`.
- Scale range raised to `0.1–10` (was 0.1–3).

## Cross-Session Undo + Realtime Command Log Sync
**Files:** `src/lib/commandHistory.ts` (+ tests), `src/game/GameEngine.ts`, `src/hooks/useGameEngine.ts`, `src/hooks/useSupabaseSync.ts`, `src/components/ScenarioMap/ScenarioMap.tsx`, `vitest.config.ts`

- **`commandHistory.ts`** (new, pure): `buildStackFromLog(rows)` rebuilds the undo stack from `command_log` (created_at order, `chained` preserved, 50-cap, JSON `sub_steps`); `buildReplayTimeline(rows)` builds a net timeline (skips soft-deleted/undone rows) with full `ReplayState` snapshots per command group; `replayStateToUnits(state)` renders a step's units.
- **`GameEngine`**: `SubStep.payload` (JSONB-safe snapshot, ignored by live apply, read by replay); `loadStack()` + `pushExternal()` (dedupe append, 50-cap).
- **`useGameEngine`**: `hydrateFromLog(scenarioId)` rebuilds the stack on mount; `subscribeToCommandLog(scenarioId)` appends remote inserts in real time (postgres_changes, deduped). Because the log is scenario-scoped, every client sees the **same global timeline**, enforcing the sequential-LIFO undo rule across clients.
- **`useSupabaseSync`**: `addUnitFromTemplate` returns the **full spawned `Unit`** (not just id); `placeUnit(unit)` records the complete unit snapshot as a PLACE payload — replay never depends on live templates or unit rows.
- **`vitest.config.ts`** (new): declares the `@` → `./src` alias. Previously unset; tests only passed because libs imported *types* from `@/types/gameProtocol` (esbuild-elided). `formationCost.ts` imports a *value* (`getOrganizationLevel`), forcing the fix.
- Migration 018 (`baseline_snapshot`) was **created then dropped** — replay starts from the log head; no baseline needed.

## Replay (Read-Only Playback)
**Files:** `src/hooks/useReplay.ts` (new), `src/components/ScenarioMap/ReplayOverlay.tsx` (new), `src/hooks/useHexGrid.ts`, `src/components/ScenarioMap/ScenarioMap.tsx`, `src/components/Lobby.tsx`, `app/page.tsx`, `supabase/migrations/019_replay_watch.sql`

- **`useReplay`**: loads `command_log` → `buildReplayTimeline`; playback cursor/playing/speed (0.5/1/2/4), seek/play/pause/step; derives `replayUnits`/`replayAlliances`/`replayTurnNumber` at cursor (0 = empty world). Co-watch via shared-registry realtime broadcast channel `replay:${scenarioId}` — pass-the-clicker: anyone can grab control, viewers follow seeks but keep their own speed.
- **ReplayOverlay**: amber REPLAY frame + banner + playback bar (play/pause, scrubber, frame-step, speed). Distinct from live UI.
- **Mode 1** — Lobby "Replay Scenario" button → map opens with `replayMode` prop. **Mode 2** — GM-only "Replay scenario" toggle in the live top bar flips the whole session into replay; "Back to Play" returns.
- **`useHexGrid.readOnly`**: pan/zoom/hover preserved; unit drag-move, attack, context menu disabled (shared by replay and DM-gone lock).
- Migration 019: `select_log_any_approved` SELECT policy on `command_log` so any approved user can watch replays.

## Top Bar Restructure
**Files:** `src/components/ScenarioMap/ScenarioMap.tsx`

- Live play: `Scenario Map - [role] | Undo | Turn [n] | End Turn | Free Move | Replay scenario` + far right `Exit to Lobby`.
- In-session replay (GM): `... | Turn [n]` + far right `Back to Play`, `Exit to Lobby`. Standalone replay: `... | Turn [n]` + `Exit to Lobby`.
- **End Turn is GM-only** (disabled/greyed for players — fixes players incrementing the local counter without DM). **Free Move** is GM-only.

## New Scenario Starts With Free Move ON + End-Turn Reminder
**Files:** `src/hooks/useScenarios.ts`, `src/components/ScenarioMap/ScenarioMap.tsx`

- `createScenario` inserts `free_move: true`.
- DM clicking End Turn while Free Move is ON gets a yellow soft-reminder modal ("End Turn anyway" / "Cancel") — no enforcement.

## Context Menu — Formation Ordering + Click-Outside
**Files:** `src/components/ScenarioMap/ContextMenu.tsx`

- Formations shown **by org level descending** (higher on top), "Line - " prefixes removed, options more than +1 org level above current are disabled (recomputed each render).
- Closes on **any click outside** via `pointerdown` capture (covers mouse/touch/pen before other handlers) + Escape.

## DM-Leave Disables All Player Controls
**Files:** `src/hooks/useScenarios.ts`, `src/components/ScenarioMap/ScenarioMap.tsx`

- Every client now subscribes to presence (previously only the GM did); on DM-leave, non-GM clients set `dmGone` → `controlsLocked` (reuses the replay read-only path): no drag/attack/context menu, Undo/End Turn/Free Move hidden, LeftPanel hidden, keyboard gated, pending modals no-op. Red banner "GM has left — controls disabled". Pan/zoom/tooltip stay; `Exit to Lobby` remains.
- Note: presence `timeout` config is **not supported** client-side in `@supabase/realtime-js@2.109` (verified) — hard-disconnect detection is server-default (~20s); graceful exits are instant.

## Charge! Mechanic
**Files:** `src/lib/moveCost.ts` (+ tests), `src/lib/formationCost.ts` (+ tests), `src/lib/unitCombat.ts`, `src/lib/unitMorale.ts` (+ test), `src/types/gameProtocol.ts`, `src/hooks/useSupabaseSync.ts`, `src/game/GameEngine.ts`, `src/hooks/useGameEngine.ts`, `src/components/ScenarioMap/ScenarioMap.tsx`, `src/components/ScenarioMap/ContextMenu.tsx`, `src/components/ScenarioMap/UnitTooltip.tsx`, `supabase/migrations/020_charge.sql`, `.scratch/charge-mechanic/spec.md`

- **`computeChargeReachable`**: front-arc BFS wedge (no turning) bounded by one action's MP pool — 1→2 hexes, 2→3, 3→4 fan; occupied blocks.
- **`nextLowerFormation`**: Phalanx/Shield Wall → Close Order → Open Order → Scattered (floor; never Routed).
- **`resolveCombatSequence(..., isCharging)`**: threads the existing `executeAttacks` double-damage flag (was always `false`).
- **Charge flow**: Charge! (prereq ≥1 action, not Scattered) locks Rotate + Formation and sets `isCharging`/`chargeDistance` — **no MP/action deducted at initiation** (consumed normally during the charge move). Overlay: cost-1 amber (premature), cost-2+ white. Full charge (≥2 hexes) → drag onto enemy = free double-damage attack, then drop 1 org level. Premature → confirm modal (attack normally, costs an action, still drops org). End turn forfeits unused free attacks (org drop).
- **Threat doubling**: `computeThreatRating` returns 2× while charging (tooltip `X.XX (2× charging)`; feeds enemy morale + AGR).
- **Free Move also makes rotate/formation free**: `useGameEngine` gained a `freeMove` prop; rotate/formation skip MP accounting when on.
- Migration 020: `units.is_charging`, `units.charge_distance`.

## Changes by File (this session)

| File | What |
|---|---|
| `src/lib/unitCombat.ts` | `suppressRetaliation` (replaces `suppressDefenderRetaliation`); `resolveCombatSequence` `isCharging` param → 6 call sites |
| `src/lib/unitCombat.test.ts` | 5 new suppression tests; `makeUnit` gains `isCharging`/`chargeDistance` |
| `src/lib/unitMorale.ts` | `calcEnemyThreats` skips `isRouting`; `computeThreatRating` doubles when `isCharging` |
| `src/lib/unitMorale.test.ts` | routing-threat + charging-threat tests; `makeUnit` gains new fields |
| `src/lib/moveCost.ts` | `computeChargeReachable` front-arc wedge |
| `src/lib/moveCost.test.ts` | charge wedge tests (fan-out, occupied blocking, cap) |
| `src/lib/formationCost.ts` | `nextLowerFormation` |
| `src/lib/formationCost.test.ts` | descent + floor tests |
| `src/lib/commandHistory.ts` | **new** — `buildStackFromLog`, `buildReplayTimeline`, `replayStateToUnits` |
| `src/lib/commandHistory.test.ts` | **new** — stack order/cap/chaining, net timeline, PLACE seeding |
| `src/game/GameEngine.ts` | `SubStep.payload`; `loadStack`/`pushExternal`; `ActionType` += `CHARGE`, `CHARGE_END` |
| `src/hooks/useGameEngine.ts` | `hydrateFromLog`, `subscribeToCommandLog`, `charge`, `performChargeEnd` forfeit in `endTurn`, `freeMove` prop |
| `src/hooks/useSupabaseSync.ts` | `addUnitFromTemplate` returns `Unit`; `isCharging`/`chargeDistance` mapping; `placeUnit(unit)` payload |
| `src/hooks/useReplay.ts` | **new** — timeline, playback, co-watch, mode |
| `src/hooks/useScenarios.ts` | `free_move: true` on create; presence subscribe shared |
| `src/hooks/useHexGrid.ts` | `readOnly` mode (replay + DM-gone) |
| `src/components/ScenarioMap/ScenarioMap.tsx` | displayUnits switch, replay mode, DM-gone lock, charge overlay/move/attack, top bar, GM-only End Turn, free-move reminder modal |
| `src/components/ScenarioMap/ReplayOverlay.tsx` | **new** — replay frame + playback bar |
| `src/components/ScenarioMap/ContextMenu.tsx` | org-level ordering, Charge!, rotate/formation lock, pointerdown/Escape close |
| `src/components/ScenarioMap/UnitTooltip.tsx` | `0 routed, was X` + `(2× charging)` |
| `src/components/ScenarioMap/MapEditorPanel.tsx` | real-time preview, scale max 10 |
| `src/components/Lobby.tsx` | "Replay Scenario" button |
| `app/page.tsx` | `{ scenarioId, replay }` session state |
| `vitest.config.ts` | **new** — `@` alias |
| `supabase/migrations/019_replay_watch.sql` | **new** — approved-user SELECT on `command_log` |
| `supabase/migrations/020_charge.sql` | **new** — `is_charging`, `charge_distance` |
| `src/lib/weaponParser.ts` | `Weapon.isTwoHanded` — CSV field #11 (parse/stringify, old strings → false) |
| `src/lib/unitStats.ts` | **new** `getShieldPenalty(unit)` (2 when shielded + active 2H weapon) + `unitStats.test.ts` |
| `src/game/GameEngine.ts` | `ActionType` += `WEAPON_SELECT` |
| `src/hooks/useGameEngine.ts` | `selectWeapon` (free-move, blocks 2H in Shield Wall, rewrites `currentAc`); `changeFormation` Shield Wall block |
| `src/hooks/useSupabaseSync.ts` | maps/persists `active_weapon_index`; spawn shield-drop at `baselineAc - 2` for shielded 2H first weapon |
| `src/components/ScenarioMap/ScenarioMap.tsx` | removed `selectedWeapons`; uses `unit.activeWeaponIndex`; defender retaliation uses active weapon |
| `src/components/ScenarioMap/ContextMenu.tsx` | `2H` badge; Shield Wall disabled for active 2H |
| `src/components/ScenarioMap/UnitTooltip.tsx` | `[2H]` marker; AC breakdown `baseline − 2 (two-handed)`; Shielded `Yes (dropped — two-handed)` |
| `src/components/UnitEditor.tsx` | Two-Handed checkbox in weapon modal; race dropdown applies HD/speed/canCharge; `createBlankTemplate` seeds race fields |
| `src/types/gameProtocol.ts` | `WeaponLookup.is_two_handed`; `Unit.activeWeaponIndex`; `Race.baseSpeed` → `base_speed` (removed `defaultTroopScale`) |
| `supabase/migrations/022_is_two_handed.sql` | **new** — `weapons.is_two_handed`, `units.active_weapon_index` |
| `supabase/migrations/023_profile_trigger.sql` | **new** — `handle_new_user` trigger auto-creates pending profile on auth.users INSERT |
| `supabase/migrations/024_replay_pending.sql` | **new** — `command_log` SELECT policy for pending users (read-only replay) |
| `supabase/migrations/025_access_matrix.sql` | **new** — `access_roles` matrix + `user_has_access`; 016 RLS policies rewritten to read the matrix |
| `src/components/Lobby.tsx` | pending banner + read-only lobby, `canReplay`, scenario search bar (name + live creator alias) |
| `src/hooks/useProfile.ts` | loads `access_roles` matrix; exposes `access { canUseUnitEditor, canCreateScenario, canJoinGame, canViewReplay }` |
| `app/unit-editor/page.tsx` | role guard — redirect to Lobby unless `access.canUseUnitEditor` |
| `src/lib/formationRules.ts` + test | **new** — data-driven combat-rule helpers (melee/ranged arcs, threat, retaliation, charge, stop-movement, beAttacked modifiers) |
| `src/lib/formationCache.ts` | **new** — session-cached `getFormations()` |
| `src/lib/unitCombat.ts` | `resolveCombatSequence` takes optional forms; beAttacked modifiers both directions; table retaliation; shield-drop on rout |
| `src/lib/unitMorale.ts` | `calcEnemyThreats` uses formation threat arcs |
| `src/components/ScenarioMap/ScenarioMap.tsx` | melee/ranged arc gates, `isRear` via matrix, threat-hex ZOC via matrix, formations via cache |
| `src/components/ScenarioMap/ContextMenu.tsx` | Charge button via `canFormationCharge` |
| `src/components/ScenarioMap/UnitTooltip.tsx` | passes formation to `calcEnemyThreats` |
| `src/types/gameProtocol.ts` | `Formation` + 11 rule fields |
| `supabase/migrations/027_formation_combat_rules.sql` | **new** — matrix columns + seed; Routed attack mult 0 |

## Migrations
- **019** (`replay_watch`), **020** (`charge`), **022** (`is_two_handed`), **023** (`profile_trigger`), **024** (`replay_pending`), **025** (`access_matrix`), **027** (`formation_combat_rules`), **028** (`map_images_bucket`) — **written, apply to DB**.
- 018 (`baseline_snapshot`) — **created then dropped** (replay starts from log head). If previously applied, run `ALTER TABLE scenarios DROP COLUMN IF EXISTS baseline_snapshot;`.

## Pending
- Migrations 019, 020, 022, 023, 024, 025, 027, and **028** (`map_images_bucket`) — apply to the DB.
- Set `weapons.is_two_handed = true` on real two-handed weapon rows in the DB (user-managed).
- Reopen + re-save templates created before the race-field fix so they pick up corrected HD/speed/canCharge defaults.
- `UnitEditor.tsx`: `isHero` toggle should force `'Hero'` formation / disable other formation checkboxes — **postponed** until the consolidated interface update.
- Replay animation smoothing (currently step-through states, no smooth movement).
- Replay co-watch "pings" (ephemeral control-click attention rings) — deferred.

---

# Handover — 2026-07-30

## Bug Fixes

### `ignoreMoraleChecks` flag replaces `isHero` routing special case
**Files:** `src/types/gameProtocol.ts`, `supabase/migrations/012_ignore_morale_checks.sql`, `src/hooks/useSupabaseSync.ts`, `src/components/ScenarioMap/ScenarioMap.tsx`, `src/components/UnitEditor.tsx`, `src/lib/templateMappers.ts`, `src/lib/unitCombat.test.ts`

Added `ignoreMoraleChecks: boolean` to `Unit` and `UnitTemplate`. This replaces the `!unit.isHero` special-case routing guard:
- Routing checks now use `!unit.ignoreMoraleChecks` instead of `!unit.isHero`
- Heroes default to `ignoreMoraleChecks: true` when created via `addUnitFromTemplate`
- The UnitEditor has an editable "Ignore morale checks (fearless)" checkbox
- Existing heroes in the DB are set to `true` via the migration

### Bug: Routing units show front-arc threat hexes during drag

### Bug: `ignoreMoraleChecks` lost when unit created from template
**File:** `src/hooks/useSupabaseSync.ts`

`addUnitFromTemplate` set `ignoreMoraleChecks: template.isHero || false`, ignoring the template's own `ignoreMoraleChecks` value — so an undead or fearless-but-not-hero template never carried its flag to spawned units (you'd have to re-check the box on every battle-map unit).

**Fix (line 371):** `ignoreMoraleChecks: template.ignoreMoraleChecks || false`. The full pipeline already existed: `UnitTemplate.ignoreMoraleChecks` (`gameProtocol.ts:85`), `templateMappers.ts` (both directions), UnitEditor checkbox. This was the only missing link.

### Bug: Hero attach position teleport
**Files:** `src/hooks/useSupabaseSync.ts`

When attaching a hero in "Protected mode (rear)", the hero briefly appeared at the rear vertex then teleported to the front.

**Root cause:** The `attached_position` DB column doesn't exist (migration 010 pending). The realtime subscription returned the row without the column (null), overwriting the local `attachedPosition: 'back'`.

**Fixes:**
- Added `attachedPosition` → `attached_position` mapping in `updateUnit` `dbUpdates` (so it syncs once the column exists)
- Rollback path (line 439-449): preserves existing `attachedPosition` when DB row has null
- Realtime update handler (line 219-226): preserves existing `attachedPosition` when payload has null

### Bug: Routing units show front-arc threat hexes during drag
**File:** `src/components/ScenarioMap/ScenarioMap.tsx`

The drag-threat hex loop filtered `isDeleted`, `attachedToUnitId`, `isHero`, but not `isRouting`.

**Fix:** Added `unit.isRouting` to the skip condition at line 620.

### Bug: Hero damage not recorded in combat
**Files:** `src/lib/unitCombat.ts`, `src/components/ScenarioMap/ScenarioMap.tsx`, `src/lib/unitCombat.test.ts`

When a hero was attached to the defender, `resolveCombatSequence` correctly split 25% of attacks to the hero and computed `firstStrikeHeroDamage`, but `ScenarioMap.tsx` never read it — hero HP/troops were never reduced and no hero damage appeared in messages.

**Fixes (`unitCombat.ts`):**
- Added `attachedAttackerHero` parameter to `resolveCombatSequence`
- Fixed line 241: `attackCapacityMultiplier` → `defenderAttackCapacityMultiplier` (defender uses its own multiplier when striking first)
- Defender-first-strike split: now uses `attachedAttackerHero` (was incorrectly using `attachedDefenderHero`)
- Defender retaliation: added hero split (25% to attacker's hero)
- Attacker retaliation: added hero split (25% to defender's hero)

**Fixes (`ScenarioMap.tsx`):**
- Computes `attachedAttackerHero` and passes it to `resolveCombatSequence`
- After first strike: if `firstStrikeHeroDamage > 0`, adds a `DAMAGE` subStep for the defender's attached hero (HP + troop count reduction), appends hero damage to the combat description
- After retaliation: if `retaliationHeroDamage > 0`, adds a `DAMAGE` subStep for the attacker's attached hero

### Bug: Damage applied to wrong unit when defender strikes first
**File:** `src/components/ScenarioMap/ScenarioMap.tsx`

When defender strikes first (e.g. Phalanx hits first due to reach), `firstStrikeDamage` is the defender's damage to the attacker, but the code unconditionally applied it to `target` (the defender). Same swap for retaliation.

**Fix:** Added `damageToDefender`/`damageToAttacker` variables that swap based on `outcome.strikerFirst`. All subSteps, hero lookups, and message text now use the correct unit. Message format changed to show who actually struck first.

## New Features

### Attach position modal
**File:** `src/components/ScenarioMap/ScenarioMap.tsx`

Replaced `confirm("Attach X to Y?")` with a 3-button modal:
- **Leader mode (Front)** — hero at front vertex, `attachedPosition: 'front'`
- **Protected mode (rear)** — hero at rear vertex, `attachedPosition: 'back'`
- **Cancel**

### Dynamic threat rating system
**Files:** `src/lib/unitMorale.ts`, `src/lib/unitCombat.ts`

Replaced the old `threatFromLevel` (fixed 1-5 by level only) with a data-driven threat rating and ratio-based morale/AGR interaction.

**`computeThreatRating(unit)`** (exported from `unitMorale.ts`) — additive sum, no floor/cap:
- Level component: 1→0, 2→1, 3-4→2, 5-7→3, 8-12→4, 13-18→5, 19-20→6
- Size component: `(sizeCategory / 100)²`
- Count component: 1-4→0, 5-9→1, 10-19→2, 20-49→3, 50+→4

Examples: Soldier (L3/100/80) = 7, goblin (L1/75/80) ≈ 4.6, dragon (L19/300/1) = 15. A lone hero has count component 0 — can't scare whole formations on its own. Tiny units naturally exert ~0 threat (fly ≈ nothing).

**Morale (`calcEnemyThreats`):** per adjacent enemy, `threat = round(theirThreat / myThreat)`; front/side add `threat`, rear adds `threat + 1` (rear bonus kept). Weak vs strong inverts correctly: goblin next to dragon feels `round(15/4.6)` = 3; dragon next to goblin feels `round(4.6/15)` = 0.

**AGR (`resolveCombatSequence`):** initiation penalty `max(0, round(defenderThreat / attackerThreat) - 1)` subtracted from `attacker.aggressiveness`. Equal or weaker targets: 0 penalty. 2x stronger: -1. goblin charging dragon: -2 (≈ never frontal-charges). Skips unchanged (hero/ranged/rear/routed). Retaliation stays automatic.

**Tests:** all `unitCombat.test.ts` units are L5/100/20 (threat 7 vs 7 → penalty 0), so the 55 tests pass unchanged. `tsc --noEmit` clean.

### Hero visual position
**File:** `src/components/ScenarioMap/ScenarioMap.tsx`

`getAttachedHeroPos` now takes `attachedPosition`. Back uses `(facing + 2) % 6` (rear vertex), front uses `(facing + 5) % 6` (front vertex).

### Hero overlay skip
**File:** `src/components/ScenarioMap/ScenarioMap.tsx`

- `getOverlayForUnit` returns empty for `isHero` (no front-arc red overlay)
- Drag threat hex loop skips `isHero` units

### UI: effective threat display + AGR penalty in message
**Files:** `src/components/ScenarioMap/UnitTooltip.tsx`, `src/lib/unitMorale.ts`, `src/components/ScenarioMap/ScenarioMap.tsx`

- Tooltip `Threat:` row now shows `computeThreatRating(unit)` (effective rating) instead of the old fixed `threatFromLevel(level)`
- Morale Factors section: the `enemies` row renamed to `threat`, still showing the MOR penalty breakdown `(front/side: X, rear: Y)`, now computed via the ratio-based `calcEnemyThreats`
- AGR failure message includes the threat penalty: `AGR 5 - 2 threat → need ≤3, rolled 6 — failed, no attack`
- `unitMorale.ts` now exports `calcWounds`, `calcIsolation`, `calcEnemyThreats`; the tooltip's duplicated copies of these + `threatFromLevel`/`HEX_DIRS` were removed

### Bug: fearless units show numeric MOR in tooltip
**File:** `src/components/ScenarioMap/UnitTooltip.tsx`

Units with `ignoreMoraleChecks` still displayed the numeric MOR formula and the full Morale Factors breakdown.

**Fix:** when `unit.ignoreMoraleChecks`, the MOR row shows `fearless` (yellow) instead of the formula, and the Morale Factors section is hidden entirely. The MOR row now renders for fearless units even when `showTroops` is false (heroes).

### Unconscious hero grayscale
**File:** `src/components/TokenRenderer/drawToken.ts`

**Fix:** in the hero branch, `ctx.filter = 'grayscale(100%)'` is set when `unit.currentUnitHp <= 0`, so a downed hero renders grayscale. The function's outer `ctx.save()`/`ctx.restore()` resets the filter. Hero HP is already clamped to ≥ 0 in both hero-damage subSteps (`ScenarioMap.tsx:486,518`). No separate "unconscious" state flag needed.

### Movement/actions spec — about-turn rule dropped
**File:** `.scratch/movement-actions-tracking/spec.md`

The about-turn (180° reversal = 1 MP + −1 organizational level) rule was removed per decision. Movement cost is now simply 1 MP/front-arc hex + 1 MP/60° turn (existing BFS rule). The proposed `units.organization_level_modifier` column and `effectiveOrganizationLevel` helper were dropped. Turn order is **alliance-group based** (friendly → enemy → neutral, skip empty boxes), not per-team.

### Alliance-based End Turn + persisted turn counter
**Files:** `supabase/migrations/013_turn_tracking.sql`, `src/lib/turnState.ts` (+ tests), `src/types/gameProtocol.ts`, `src/hooks/useScenarios.ts`, `src/game/GameEngine.ts`, `src/hooks/useGameEngine.ts`, `src/components/ScenarioMap/ScenarioMap.tsx`

Implemented the first slice of the turn system:

- **Cycle order:** friendly → enemy → neutral, skipping any group with no team assigned in `team_alliances` (teams default to `friendly`, so friendly is always active). A fresh scenario cycles friendly→friendly.
- **Button:** visible to **everyone** in the session (was GM-only). Label shows the active group: `End Turn (friendly)` blue (`#0072B2`), `End Turn (enemy)` red (`#D55E00`), `End Turn (neutral)` light gray (`#E0E0E0`, dark text). The old `Turn {n}` counter display is retained and now driven by the persisted `turn_number`.
- **Turn counter:** `scenarios.turn_number` increments **only** when a full cycle completes (advance returns to the first active group). Migration 013 adds `current_turn_alliance` (CHECK in the 3 groups) + `turn_number` default 0.
- **Reset:** on a group's turn, every non-deleted unit whose team is in that group resets `movementPointsAvailable = computeEffectiveMovement(unit, formation.movement_multiplier)` and `actionsAvailable = 2`.
- **Atomic + undoable:** `END_TURN` is one command; a new `SCENARIO` sub-step type applies scenario-row changes. Undo reverts `current_turn_alliance`/`turn_number` and restores each unit's previous MP/actions. `execute`/`undo`/`redo` in `useGameEngine.ts` gained the `SCENARIO` branch (wired to `updateScenarioField`).
- **Sync:** ScenarioMap fetches the scenario row on mount and subscribes to `postgres_changes` on `scenarios` (filter `id=eq`) so all clients track the active group + turn number. The scatter seed (`turnNumber` prop into `drawToken`) now uses the persisted turn number.
- **Helpers:** `src/lib/turnState.ts` — `ALLIANCE_ORDER`, `getActiveGroups(alliances)`, `advanceTurn(current, activeGroups) → { next, wrapped }` (pure, tested in `turnState.test.ts`: 11 cases).

### Movement & action tracking — full turn economy
**Files:** `src/lib/moveCost.ts` (+ test), `src/lib/formationCost.ts` (+ test), `src/hooks/useGameEngine.ts`, `src/components/ScenarioMap/ScenarioMap.tsx`, `src/components/ScenarioMap/UnitTooltip.tsx`, `src/components/ScenarioMap/MessagesPanel.tsx`, `src/contexts/MessageContext.tsx`, `src/hooks/useSupabaseSync.ts`, `.scratch/movement-actions-tracking/spec.md`

Implemented the MP/action spend so `movement_points_available` / `actions_available` are actually consumed and reset each turn:

- **Move cost** (`moveCost.ts`): pure `computeReachableMap(unit, maxMP, occupied, threatHexes) → Map<"q,r", { cost, path, finalFacing }>` over state space `(hex, facing)` — 1 MP per front-arc step, 1 MP per 60° turn. Threat hexes are reachable destinations but never passed through; occupied hexes excluded; Routed/Scattered/**Hero** move any direction at 1 MP/hex (heroes = loose like Scattered, matching their threat/flank treatment). Replaces the old `getReachableHexes` in `ScenarioMap.tsx` so the drag overlay and the executed move cost share one source. Executed-move reach = leftover MP + action pools; **overlay = `computeMovePool`** (a full pool when actions ≥ 1, else leftover MP).
- **Action-refill model** (`moveCost.ts`): **one action = one full MP pool.** Units start/reset at **2 actions / 0 MP** — MP is materialized when a move converts an action, and the cost is spent from **already-materialized MP first** (an action converts a fresh pool only when MP is exhausted, so leftover MP is never wasted). `computeMoveBudget` → `movementPointsAvailable + maxMP × max(1, actions)`; `applyMoveCost` → final MP = last pool's remainder (0 on exact pool), final actions = unconverted pools left; `applyMpSpend` → single-MP spends convert a remaining action into a full pool when MP is insufficient; `computeMovePool` → full pool when actions ≥ 1 (used for overlay + tooltip), else leftover MP; `isMoveAffordable` → true iff actions stay ≥ 0. Heroes **ignore** rotate/formation MP; attach/detach cost the **hero's** MP.
- **Formation rescale** (`formationCost.ts`): pure `applyFormationChange(currentMP, steps, oldMax, newMax)` — 1 MP per org-level step, then proportional rescale `× newMax/oldMax`, `floor`ed and clamped to `[0, newMax]`. Replaces the old `Math.round` proportional-only logic. MP stays **integer** (dry-run verdict: fractions don't matter).
- **Deltas** (undoable via existing field-replay): `MOVE` via `applyMoveCost` (path MP spent first, action converts a fresh pool only when MP exhausted); `ROTATE` −1 MP via `applyMpSpend` (non-hero only, action only on refill); `FORMATION` via `applyFormationChange` (hero skips MP); `ATTACH_HERO`/`DETACH_HERO` −1 hero MP via `applyMpSpend`; `ATTACK` adds an `ATTACK` sub-step deducting 1 action (spent even on AGR failure). `END_TURN` resets to **2 actions / 0 MP**.
- **Soft enforcement (never hard-blocks):** `handleUnitMove` rejects only hexes unreachable within leftover MP + action pools; a move that is **not affordable** (`isMoveAffordable` — cost exceeds leftover MP + action pools) shows a **confirm modal**, and confirming deducts fully (may go negative) and pushes a **red error notification**. Same confirm modal for an attack with 0 actions (covers haste double-attack, detach-reposition edge cases).
- **Message channel:** `MessageContext` messages are now `GameMessage { text, tone }` with a new `addError()`; `MessagesPanel` renders error-tone rows red.
- **Tooltip:** `Move: {floor(movementPointsAvailable)}/{max}` (actual materialized MP, drains 3→2→1→0 per pool) + `Actions: {n}/2` with a `(1 = full move)` hint (red when ≤ 0).
- **Spawn:** `addUnitFromTemplate` starts units at **2 actions / 0 MP** (`movementPointsAvailable: 0`).
- **Tests:** `moveCost.test.ts` (28) + `formationCost.test.ts` (6); full suite 145 passing; `tsc --noEmit` clean.

### Tabbed left panel + Map editor as a tab
**Files:** `src/components/ScenarioMap/LeftPanel.tsx`, `src/components/ScenarioMap/PanelsContainer.tsx`, `src/components/ScenarioMap/PanelSection.tsx`, `src/components/ScenarioMap/ScenarioMap.tsx`, `src/components/Lobby.tsx`, `src/components/MapEditorView.tsx` (deleted)

Redesigned the left panel from collapsible sections into a **tabbed panel**:

- **Tab bar** on top (always visible), fixed order: Map · Alliances · Unit Selector · Messages. Clicking a tab toggles that panel open/closed; multiple can be open at once and stack **vertically in fixed order**, sharing height equally.
- **Default state:** first *available* tab open, rest closed (GM → Map; Player → Messages). `userTouched` ref means the default only applies before the user interacts.
- `PanelsContainer` now takes a `tabs` prop and renders the tab bar + stacked open panels; auto-sizes and hides resize handles when all tabs are closed. `PanelSection` is now just a scrollable content region.
- **Icons:** Map (map glyph) · Alliances (handshake) · Unit Selector (crossed swords) · Messages (word bubble).
- **Bug fix:** `PanelsContainer` shell is `flex flex-col` with tab bar `flex-none` and body `flex-1 min-h-0` — the previous fixed height + `h-full` body + in-flow tab bar overflowed the container, clipping the bottommost panel (Messages) and causing the panel to jump when that tab was opened. Default width raised 320 → 400 so all four labeled tabs fit.
- **Dock toggle:** a large *hollow* triangle moves the panel between the top-left and top-right edges. When docked left it sits at the **right end** of the tab bar (pointing `>`); when docked right at the **left end** (pointing `<`) — it always hangs at the leading end, pointing toward the destination. State (`panelSide`) lives in ScenarioMap, in-memory. When docked right the width-resize handles mirror: right-edge → left-edge and bottom-right corner → bottom-left corner, with inverted drag math (`newWidth = startSize.width - dx`) and `nesw-resize` cursor, so the panel stays resizable off the screen edge; bottom handle unchanged.
- **Map editor moved in:** the previously-unused `MapEditorPanel.tsx` is wired into a GM-only **Map** tab (leftmost). ScenarioMap passes `backgroundConfig` + `onSaveBackground` (sets `backgroundConfig` live + persists via `updateScenarioMapData`), so alignment is WYSIWYG on the real map.
- **Lobby cleanup:** the Map Editor button, `mapEditorScenarioId` state, and the full-screen `MapEditorView.tsx` overlay were removed; the file was deleted.

## Changes by File

| File | What |
|---|---|
| `src/types/gameProtocol.ts` | Added `ignoreMoraleChecks` to `Unit` and `UnitTemplate` |
| `supabase/migrations/012_ignore_morale_checks.sql` | New migration: add column, set `true` for existing heroes |
| `src/hooks/useSupabaseSync.ts` | `ignoreMoraleChecks` in `mapRowToUnit`/`mapUnitToRow`/`updateUnit`/defaults; `addUnitFromTemplate` carries `template.ignoreMoraleChecks` (was `isHero`) |
| `src/components/ScenarioMap/ScenarioMap.tsx` | `ignoreMoraleChecks` routing guards; attach modal; `isRouting` threat skip; `attachedAttackerHero`; hero damage subSteps; hero overlay skip; `getAttachedHeroPos` position param; damage direction fix for defender-first-strike; AGR failure message shows threat penalty |
| `src/lib/unitCombat.ts` | `attachedAttackerHero` param; defender-first-strike fix; hero split in both retaliation paths; AGR penalty `max(0, round(defenderThreat/attackerThreat) - 1)` |
| `src/lib/unitMorale.ts` | Added & exported `computeThreatRating` (level + size² + count, additive); exported `calcWounds`/`calcIsolation`/`calcEnemyThreats`; `calcEnemyThreats` uses `round(theirThreat/myThreat)`; `threatFromLevel` deleted |
| `src/components/ScenarioMap/UnitTooltip.tsx` | Imports morale helpers from `unitMorale` (duplicates removed); Threat row shows `computeThreatRating`; Morale Factors `threat` row; fearless MOR display + hidden Morale Factors for `ignoreMoraleChecks` units |
| `src/components/TokenRenderer/drawToken.ts` | `ignoreMoraleChecks` param on `drawBottomInfo`; heart rendering skips immune units; unconscious hero grayscale at `currentUnitHp <= 0` |
| `src/lib/templateMappers.ts` | `ignoreMoraleChecks` in `mapTemplate`/`mapTemplateToRow` |
| `src/lib/unitCombat.test.ts` | Updated `makeUnit` and `callCombat` for new fields |
| `src/components/TokenRenderer/drawToken.ts` | Action badge: small square above the bottom info band (non-hero, right edge) / above the HP bar (hero, bottom-right) showing remaining `actionsAvailable` — white (≥2) / yellow (1) / red (0); `getActionColor` + `drawActionBadge` helpers; skips attached heroes and units without `actionsAvailable` |
| `src/components/TokenRenderer/TokenRenderer.tsx` | Preview fake unit gains `actionsAvailable: 2` so the badge shows in token previews |
| `src/components/UnitEditor.tsx` | "Ignore morale checks (fearless)" checkbox; `ignoreMoraleChecks` default in blank template |
| `supabase/migrations/013_turn_tracking.sql` | New migration: `scenarios.current_turn_alliance` (CHECK), `scenarios.turn_number` default 0 |
| `src/lib/turnState.ts` | New pure module: `ALLIANCE_ORDER`, `getActiveGroups`, `advanceTurn` |
| `src/lib/turnState.test.ts` | New tests for active-group derivation + advance/skip/wrap |
| `src/types/gameProtocol.ts` | `Scenario.currentTurnAlliance: AllianceGroup \| null`, `Scenario.turnNumber: number` |
| `src/hooks/useScenarios.ts` | `mapScenario` maps the two new fields; new `updateScenarioField(scenarioId, fields)` |
| `src/game/GameEngine.ts` | `ActionType` += `'END_TURN'`, `'SCENARIO'` |
| `src/hooks/useGameEngine.ts` | `updateScenarioField` prop; `SCENARIO` branch in execute/undo/redo; new `endTurn()` building the atomic command |
| `src/components/ScenarioMap/ScenarioMap.tsx` | Scenario turn fetch + realtime subscription; `currentTurnAlliance`/`turnNumber` state replace local `turn`; alliance-colored End Turn button visible to all; scatter seed uses persisted turn number; `handleSaveBackground` + `backgroundConfig`/`onSaveBackground` props to LeftPanel; `panelSide` state + wrapper `left-2`/`right-2` positioning for the dock toggle |
| `src/components/ScenarioMap/PanelsContainer.tsx` | Refactored to tabbed shell: `tabs` prop renders a tab bar above stacked open panels; `flex flex-col` layout (tab bar `flex-none`, body `flex-1 min-h-0`) fixes overflow that clipped the bottommost panel; auto-sizes + hides resize handles when all tabs closed; `side`/`onToggleSide` large hollow dock-toggle triangle at the leading end of the tab bar; width-handle + corner mirror when docked right |
| `src/components/ScenarioMap/PanelSection.tsx` | Simplified to a scrollable content region (`flex-1 min-h-0 overflow-y-auto`); collapsed-icon-button mode removed |
| `src/components/ScenarioMap/LeftPanel.tsx` | Rewritten around tabs (Map · Alliances · Unit Selector · Messages); GM-only Map tab (leftmost) hosts `MapEditorPanel`; handshake/crossed-swords icons; first-available-tab-open default (GM → Map); forwards `side`/`onToggleSide` to PanelsContainer |
| `src/components/Lobby.tsx` | Removed Map Editor button + `mapEditorScenarioId` state + `MapEditorView` overlay/import |
| `src/components/MapEditorView.tsx` | Deleted (full-screen overlay replaced by the Map tab editor) |
