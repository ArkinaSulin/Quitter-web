# QuiTTER Changelog

## Range auras apply immediately + central modifier labels (2026-09-21)
**Files:** src/lib/{effectTemplates,unitEffects}.ts (+ tests), src/components/ScenarioMap/{useCombatActions,useReactionActions,useOverlay,MapInfoTooltip,StructurePaintPanel}.ts(x), src/components/{StructureEditor/StructureEditor,EffectEditor/EffectEditor,MapEditor/MapEditor}.tsx, docs/dev/changelog.md

- **Range auras apply before a move.** Structure `range` reaches combat via a zone membership, which is only materialized on move / END_TURN — so a unit standing on a watch tower (or a structure edited to add `range`) showed no bonus until it moved. New `unitEffects.rangeBonusAt(unit, zones)` = persisted `effectRangeBonus` **plus** any `range` zone underfoot not yet materialized (deduped by zone key, so no double-count). Used in `useCombatActions` (attacker/defender bonus + hard range cap, ranged-only), `useReactionActions` (eligibility/reach/gates), and — the visible bug — **`useOverlay`**: range rings, the hovered-target colour and the reaction-mode archer rings now include the bonus.
- **Central `modifierSummary`** (`effectTemplates.ts`): one label implementation for every list/tooltip/summary — `(mode)` only for mode-honouring kinds (so `range` never prints `(melee)`), `/in`·`/out` for `block_attacks`, signed flat amounts (`range +2`, `ac -1`), dice strings kept as-is (`dot 1d6`), `enter_org_max ≤1`, `heal` suffix. Replaced the ad-hoc formatters in `MapInfoTooltip` (modifier line + zone `EffectInfo`), `StructurePaintPanel` hover tooltip, `MapEditor` structure tooltip, and the Structure/Effect editor summaries.
- `tsc` clean; 734 tests pass; `next build` clean. No migration.

## Map Editor: panels fill to bottom, notes as hover tooltips, Shift+double-click structure edit (2026-09-21)
**Files:** src/components/StructureEditModal.tsx (moved), src/components/ScenarioMap/ScenarioMap.tsx, src/components/MapEditor/{MapEditor,MapCanvas}.tsx, docs/dev/changelog.md

- **Moved** `StructureEditModal` from `ScenarioMap/` to the shared **`src/components/`** so the Scenario Map and Map Editor always use the same instance editor.
- **Map Editor panels fill to the bottom**: the tab body is now `flex-1 min-h-0 flex flex-col`; the Structures and Effects lists are `flex-1 min-h-0 overflow-y-auto` (dropped `max-h-56`/`max-h-72`); Image/Movement scroll normally. Top Maps list stays capped.
- **Notes → hover tooltips**: the static instruction/legend paragraphs are gone (movement legend, `Armed: …`, effect notes). Hovering a Structures/Effects row shows an info tooltip with the tab's **instruction note appended at the bottom**; hovering the Movement panel shows the note. Mirrors the scenario-map hover pattern.
- **Edit placed structures via Shift + double-click** (like the scenario map): the Structures tab's lower selected-instance editor is removed; `MapCanvas` gained an `onDoubleClick` that (with Shift) resolves the hex/edge structure and opens the shared `StructureEditModal` (keyed `patchStructureAt` → autosave). Painting is suppressed while Shift is held so the gesture is purely edit/inspect.
- `tsc` clean; 728 tests pass; `next build` clean. No migration.

## Fix: save reverted values in Effect Editor; shared refresh+reselect (2026-09-21)
**Files:** src/lib/librarySelection.ts (new) + test, src/components/EffectEditor/EffectEditor.tsx, src/components/StructureEditor/StructureEditor.tsx, src/components/WeaponEditor/WeaponEditor.tsx, docs/dev/changelog.md

- **Effect Editor save bug.** `save()` did `await load()` (which only `setList`), then `list.find(id)` — but `list` was the stale render-closure value, so `select(found)` re-selected the **pre-edit** row and reverted the draft (all fields: name/color/scope/layer/image/duration/modifiers). The DB write was correct; a second Save then persisted the reverted draft. Insert path was unaffected (id absent from the stale list → fetched fresh).
- **Shared helper** `refreshAndReselect(load, id, idOf)` (`src/lib/librarySelection.ts`): `load()` now returns the freshly mapped list (and still sets state) and the editor reselects by id from that fresh list — never from stale state. Applied to **EffectEditor, StructureEditor, WeaponEditor**. `UnitEditor`/`ShipEditor` already reselected from the save response (`mapTemplate(result[0])` / `mapShipTemplateRow(fresh)`) so they had no stale-list bug and were left unchanged.
- `tsc` clean; 728 tests pass; `next build` clean.

## Scenario "Map Feature" tab: no arm toggle, pan-safe, preview border (2026-09-21)
**Files:** src/components/ScenarioMap/{LeftPanel,StructurePaintPanel,ScenarioMap}.tsx, src/hooks/useHexGrid.ts, src/components/StructureEditor/{StructurePreview,StructureEditor}.tsx, docs/dev/changelog.md

- Renamed the tab **id + label to `map-feature` / "Map Feature"**.
- **Middle-mouse pan no longer drops a feature.** `useHexGrid.handleMouseDown` set `mouseDownTarget = 'hex'` for button 1, so the release fired `onHexClick` and painted the armed MP-cost pen / structure. Button 1 now sets `'none'`, plus a `panMovedRef` guard suppresses the click after a real pan.
- **Removed the "enable structure tools" arm.** Selecting a structure palette arms painting directly (like the terrain pen / effects); **terrain pen and structure palette are now mutually exclusive** (picking one clears the other).
- **Structure Editor preview honours `hexBorder`**: the centre hex's thick outline is skipped in `StructurePreview` when the template has it off.
- `tsc` clean; 725 tests pass; `next build` clean.

## Structure door-badge fix + hex-border toggle (migration 100) (2026-09-21)
**Files:** supabase/migrations/100_structure_hex_border.sql (new), src/types/structure.ts, src/lib/structureTemplates.ts (+ test), src/components/ScenarioMap/{useCanvasDraw,MapInfoTooltip,StructureEditModal}.ts(x), src/components/MapEditor/{MapCanvas,MapEditor}.tsx, src/components/StructureEditor/StructureEditor.tsx, docs/dev/{02,changelog}.md

- **No "door" badge when the door isn't a distinct pool.** `structureHasDoor(t)` is true only for `0 < door_hp < max_hp`; a door equal to `max_hp` (or null) means "no separate door", so the map badge, `MapInfoTooltip`, `StructureEditModal` door field/open toggle and the Map Editor structure panel all hide it. (A wall's `door_hp == max_hp` now reads as no door on the board.)
- **Per-template `hex_border` toggle** (migration **100**, default true): hex structures can skip the thick black hex outline for decorative hexes. Drawn in `useCanvasDraw` + `MapCanvas`, authored via a checkbox in the Structure Editor. **Apply 100 in Supabase.**
- `tsc` clean; 725 tests pass; `next build` clean.

## Scenario left panel: Features tab + hover tooltips (2026-09-21)
**Files:** src/components/ScenarioMap/{LeftPanel,StructurePaintPanel,EffectsPanel}.tsx, docs/dev/changelog.md

- Renamed the left-panel **"Movement" tab to "Features"** (terrain MP pen + structure brush).
- Removed the selected-structure editor from the lower half of that tab (the only split list+editor panel, unlike the other single-list tabs). Editing a placed structure stays on the canvas via **Shift + double-click** (`StructureEditModal`); right-click removes, clicking a placed edge flips its battlement.
- **Hover tooltips** in the Unit-Selector style now carry the info instead: structure templates show anchor, in/out foot+mounted MP (block), HP/DT/door, cover AC and other modifiers; effect cards show scope, duration and the full modifier list.
- `tsc` clean; 723 tests pass; `next build` clean.

## block_attacks + hex-structure→zone unification; ranged-only range; editor action bar (2026-09-21)
**Files:** src/lib/{effectTemplates,unitEffects,mapStructures,mapEffects,attackBlock(new)}.ts (+ tests), src/types/gameProtocol.ts, src/hooks/useSupabaseSync.ts, src/components/EffectEditor/{EffectEditor,EffectModifierFields}.tsx, src/components/{StructureEditor/StructureEditor,UnitEditor,ShipEditor/ShipEditor,WeaponEditor/WeaponEditor}.tsx, src/components/ScenarioMap/{ScenarioMap,useCombatActions,useReactionActions}.ts(x), docs/dev/changelog.md, AGENTS.md

- **New `block_attacks` modifier** (amount-less; two sub-states `mode: melee|ranged` and `direction: in|out|both`). A **hard** block: blocked attacks can't be selected and an attempt errors; the DM lifts it by removing the effect. Blocks attacks **into and/or out of** a unit, a hex (ground zone or hex structure), and, on an **edge wall/gate, attacks *through* the edge only** (destroyed structure → block gone). Healing exempt; AoE magic casts (`useCastActions`) are **not** blocked. Gate lives in `src/lib/attackBlock.ts` (`attacksBlocked`), wired into `useCombatActions.handleAttackRequest` and `useReactionActions.handleReactionAttack` (AI not wired — it lacks structures).
- **Hex structures now run through the one ground-effect engine**: `mapStructures.structureZones` expands every hex structure's `modifiers` into permanent `GroundEffect`s; ScenarioMap derives `effectiveZones = painted zones + structureZones` and feeds it to `syncZoneEffects`, the movement/combat/reaction hooks and the overlay. Edge structures stay on the edge path (their effects are per-crossing). The bespoke `structureRangeBonus` consumers were removed to avoid double-counting range (now via zone membership).
- **`range` modifier applies to RANGED weapons only** (`maxRange > 1`); a melee weapon gains no reach (`useCombatActions` attack + hard-cap + hero profile).
- **Library editors unified to Save / Clone / Delete** in a persistent bottom-of-middle action bar (`UnitEditor`, `ShipEditor`, `EffectEditor`, `StructureEditor`, `WeaponEditor`); left-panel **New** stays; `Save As`/`Cancel` removed. Map Editor out of scope.
- `tsc` clean; 723 tests pass; `next build` clean. No DB migration (all inside existing jsonb `modifiers`).

## Effects/modifiers: one canonical `dice` amount (delta removed) (2026-09-21)
**Files:** src/lib/{effectTemplates,unitEffects,mapStructures,mapEffects}.ts (+ tests), src/types/gameProtocol.ts, src/hooks/{useGameEngine,useSupabaseSync}.ts, src/components/ScenarioMap/{ScenarioMap,MapInfoTooltip,UnitTooltip,AddEffectModal,EffectFormModal,StructureEditModal,useMoveActions,useCombatActions}.tsx, src/components/EffectEditor/{EffectEditor,EffectModifierFields}.tsx, src/components/StructureEditor/StructureEditor.tsx, supabase/migrations/099_structure_template_rework.sql, docs/dev/changelog.md

- **`delta` is gone.** `EffectModifier`, `UnitEffect` and `GroundEffect` now carry the amount in a single string `dice` — a plain number (`"2"`, `"-1"`) for flat stat/aura amounts or dice (`"2d6+2"`) for rolled damage/heal. Absent for amount-less flag kinds. This removes the dual `dice`/`delta` representation that left the effect/structure editor amount box blank and that `useSupabaseSync.parseEffects` silently dropped on reload (dice lost → fell back to 0).
- **Helpers**: `modifierAmount(dice)` = the flat/signed value (stat + aura consumers), `isDiceAmount(dice)` = has ≥1 die (per-troop rolls vs a flat once), `effectAmount`/`rollDice` unchanged.
- **Backward compatible**: `parseModifiers` and `parseEffects` normalize a legacy numeric `delta` into `dice` on read, so existing `effect_templates` rows and `units.effects`/`ground_data` jsonb keep working with no data migration.
- **Editors**: `+ Add modifier` seeds `dice: "1"`; the shared `EffectModifierFields` amount box reads/writes `dice` (dice or a flat number). Summaries/tooltips read `dice`.
- Migration 099 presets now store `dice` (e.g. `{"kind":"ac","dice":"2","mode":"melee"}`). `tsc` clean; 708 tests pass; `next build` clean.

## Structure template rework + movement pooling (migration 099) (2026-09-21)
**Files:** supabase/migrations/099_structure_template_rework.sql (new), src/types/structure.ts, src/lib/{effectTemplates,structureTemplates,mapStructures,walls,wallCombat,structureCombat,moveCost}.ts (+ tests), src/components/ScenarioMap/{mapGeometry,useOverlay,useMoveActions,useReactionActions,ScenarioMap,StructurePaintPanel,StructureEditModal(new),MapInfoTooltip,LeftPanel,useCanvasDraw,useHexGrid}.ts(x), src/components/{MapEditor/MapEditor,MapEditor/MapCanvas,StructureEditor/StructureEditor,StructureEditor/StructurePreview,EffectEditor/EffectModifierFields}.tsx, docs/dev/{02,07,18,changelog}.md, AGENTS.md

- **Migration 099 reworks `map_structure_templates`**: the authored A/B faces and `hex_move_cost` are replaced by direction-relative, locomotion-aware `mp_foot_in/out` + `mp_mounted_in/out` (MP REPLACES terrain; `_in` = outside→inside, `_out` = inside→outside; hex uses `_in`; `NULL` = terrain; **negative = hard block**, bypassed by free move and the DM). Durability is **two pools damaged simultaneously**: `door_hp` gates passage (`0` = passable) and `max_hp` gates modifiers (`<= 0` = instance removed); `door_hp` defaults to `max_hp`, `0 <= door_hp <= max_hp`; `open` waives the door gate.
- **One modifier list** with an optional `mode: 'melee' | 'ranged'` (absent = both) on `ac` / `advantage` / `disadvantage` / `grant_advantage` / `grant_disadvantage` — cover AC is now `ac` modifiers. `range` and `enter_org_max` ignore `mode`. The shared `EffectModifierFields` row shows a compact `Both / Melee / Ranged` dropdown (Effect + Structure editors).
- **Charge rule**: *"any hex with MP cost 2+ will disable charge"* (`makeChargeBlockedEdge` — edges and hex entry).
- **In-scenario instance editor**: **Shift + double-click** a placed structure opens `StructureEditModal` (HP, door HP, gate open, outside side, and the instance's modifier override, seeded from the template).
- **Movement Option 2**: evaluation pools every remaining action as the MP budget while the hex-step cap stays at one pool (`computeReachableMap` gained a `hopCap` argument) — an expensive single step is selectable without extending normal one-move reach; the overlay/reaction/AI share the rule. Execution already pooled (`applyMoveCost`).
- **Data**: 099 wipes every placed instance (`maps.structures`, `scenarios.map_data.structures`) and reseeds the 9 presets in the new shape. `tsc --noEmit` clean; 707 tests pass; `next build` clean. **Apply 099 in Supabase.**

## Consistent table naming — subsystem prefixes (migration 098) (2026-09-21)
**Files:** supabase/migrations/098_table_renames.sql (new), src/lib/{templateMappers,templateMappers.test,settingsCache,formationCache,weaponMappers,unitStats,mapEffects,scenarioPermissions,turnState,commandLog}.ts, src/components/{UnitEditor,WeaponEditorModal,SettingsModal,Lobby,ImagePickerModal}.tsx, src/components/EffectEditor/EffectEditor.tsx, src/components/MapEditor/MapEditor.tsx, src/components/WeaponEditor/WeaponEditor.tsx, src/components/ScenarioMap/{ScenarioMap,UnitSelector,UnitEditorModal,AiPanel,UndoDebugPanel,PlayerPanel,AddEffectModal,EffectsPanel,routeUnit}.tsx, src/hooks/{useProfile,useScenarioCapabilities,useTeamAlliances,useReplay,useCommandLogRows,useGameEngine,useSupabaseSync}.ts, src/types/gameProtocol.ts, docs/dev/{README,01,02,03,04,05,06,08,10,11,12,13,14,16,17,outstanding,changelog}.md, AGENTS.md

- **Migration 098 renames tables onto a subsystem-prefixed scheme** (zero data/behaviour change): `user_*` identity, `admin_*` global access/audit/settings, `scenario_*` per-scenario runtime, `unit_*` land-unit system + lookups, `map_*` maps/effects, `ship_*` Spelljammer. The four formerly-confusing names become: `user_profile` (identity), `admin_role_access_rights` (global role→capability matrix), `admin_role_changes` (audit), `user_profile_last_change` (admin view). Full old→new mapping in `docs/dev/02`.
- **Rebinds**: PostgreSQL stores function bodies as text, so every function bound to a renamed table is recreated with new names (`handle_new_user`, `set_player_role`, `user_has_access`, `scenario_role_has_access`, `apply_substeps`, `execute_command`, `undo_commands`, `redo_commands`, `undo_state`, `live_top_chain`, `newest_deleted_batch`, `seed_friendly_team_alliances`, `request_scenario_deletion`, `clear_scenario_deletion_request`). Views bind by OID, so `profile_access` is merely `ALTER VIEW … RENAME`. Ends with `NOTIFY pgrst, 'reload schema'`.
- **Client sweep**: every `.from()`, realtime `table:` filter, embedded select key (`races`/`armors`/`mounts` → `unit_*`) and mapper row key updated. `templateMappers` reads `row.unit_races`/`row.unit_armors`/`row.unit_mounts`.
- **Ordering**: apply pending migrations **081, 093, 095 before 098**, since they name old tables (`weapons`, `access_roles`, `command_log`, `team_alliances`). Noted at the top of `098`.
- `tsc --noEmit` clean; 703 tests pass. **Apply 098 in Supabase after 081/093/095.**

## Shift inspect mode + Shift-drop structure attacks; free-move withdraw fix (2026-09-20)
**Files:** src/components/ScenarioMap/{ScenarioMap,MapInfoTooltip(new),useCanvasDraw}.tsx, src/hooks/useHexGrid.ts, docs/players/player-manual.md, docs/dev/changelog.md

- **Withdraw in free-move**: the withdraw interception in `onUnitMove` is now guarded by `!freeMove`, so a rear-hex drag under free-move is a plain free move (no confirm, no cost).
- **Shift = inspect map**: holding Shift hides all unit/hero tokens and corpse piles (`useCanvasDraw` `hideUnits`), keeping terrain/structures/effects visible; unit grab/hover is disabled while Shift is held. Pressing Shift mid-drag keeps working because the drop reads `event.shiftKey`.
- **Shift + drop = attack a structure** (edge walls/spikes and hex gates/towers): `useHexGrid.handleMouseUp` routes to the attack only when Shift is held; a plain drop moves. The old "attack vs move" target-picker modal is removed (reach gates `canAttackWallEdge`/`canAttackStructure` stay).
- **Hex/edge info tooltips** (new `MapInfoTooltip`): hovering a hex shows its effects and hex structure (priority effect → structure), each edge structure has its own tooltip, and the edge hit-box is enlarged while Shift is held. With Shift, the hex tooltip shows effect + structure side by side. A "Shift + drop a unit here to attack" hint is shown on structure tooltips.
- Docs: player manual (free-move withdraw; Shift inspect; Shift-drop attack). `tsc` clean; 703 tests pass; `next build` clean. No DB change.

## Fix: authored map effects didn't repaint until a structure changed (2026-09-20)
**Files:** src/components/MapEditor/MapCanvas.tsx, docs/dev/changelog.md

- **Bug**: `MapCanvas`'s redraw effect's dependency array omitted `hexEffects`/`effectTemplates`, so painting an authored map effect only became visible when an unrelated prop it *did* track (`structures`, `terrainCosts`, …) changed.
- **Fix**: added `hexEffects` and `effectTemplates` to the redraw deps.
- `tsc` clean; `next build` clean.

## Map Editor Effects tab + permanent authored effects (2026-09-20)
**Files:** src/lib/{mapEffects,mapEffects.test,mapEntities,unitEffects,unitEffects.test}.ts, src/types/gameProtocol.ts, src/components/MapEditor/{MapEditor,MapCanvas}.tsx, src/components/ScenarioMap/ScenarioMap.tsx, docs/dev/{13-map-entities-terrain,changelog}.md

- **Map Editor "Effects" tab** (next to Structures): loads the zone-capable `effect_templates` as a palette, then click/drag hexes to paint a per-hex effect (one per hex) into `maps.hex_effects`; clicking a hex's own effect clears it, right-click clears. `MapCanvas` renders authored effects (tint + colour marker + artwork).
- **Authored board effects are permanent.** New `GroundEffect.permanent`; `unitEffects.computeEndTurnEffects` **skips tick/expiry** for permanent zones (stat membership reconcile still runs, so entering/leaving still applies buffs). Map-authored effects are always permanent.
- **Assign snapshot**: `ScenarioMap.assignMap` runs `mapEffects.expandHexEffects` (one zone per template modifier) into `scenarios.map_data.groundEffects` (and `clearMap` resets them), so the whole ground-effect runtime — memberships, `range`, `mp_cost`, `enter_org_max`, DoT/entry — works on authored boards.
- No DB migration (`maps.hex_effects` already existed). Tests: `mapEffects.test.ts` + a permanent-zone engine test. `tsc` clean; 703 tests pass; `next build` clean.

## Structure images bucket + gate-tower badge swap (migration 097) (2026-09-20)
**Files:** supabase/migrations/097_structure_images_bucket.sql (new), src/components/StructureEditor/StructureEditor.tsx, src/components/ScenarioMap/useCanvasDraw.ts, src/components/MapEditor/MapCanvas.tsx, docs/dev/02-schema-and-migrations.md

- **`structure_images` bucket** (migration **097**, public read + authenticated write, same pattern as `effect_images`). The Structure Editor's image picker now defaults to it (`bucket="structure_images"`).
- **Gate-tower badges swapped**: on a hex structure the tower **HP** badge now sits **above** the hex and the **door / open** badge **below** (was the other way around) in both the scenario canvas and the Map Editor canvas.
- `tsc` clean; 697 tests pass; `next build` clean. **Apply 097 in Supabase.**

## Structure battlements square + Archer's Stake spikes (migration 096) (2026-09-20)
**Files:** src/lib/{structureDraw,structureTemplates,structureCombat,mapStructures}.ts (+ tests), src/types/{structure,gameProtocol}.ts, src/components/StructureEditor/{StructureEditor,StructurePreview}.tsx, src/components/ScenarioMap/useCanvasDraw.ts, src/components/MapEditor/MapCanvas.tsx, supabase/migrations/096_structure_spikes.sql (new), supabase/migrations/093_map_structure_templates.sql, docs/dev/{02-schema-and-migrations,changelog}.md

- **Battlements now read as squares**: the crenellation amplitude is derived from the tooth width (`battlementDepth = edgeLen / (2·teeth − 1)`) instead of a fixed ratio, so teeth are as tall as they are wide at any zoom (new `battlementDepth` helper, used by both canvases + the editor preview).
- **Archer's Stake**: migration **096** adds a per-template `spikes` flag and renames the seeded "Archer Spikes" → **"Archer's Stake"** with `spikes = true`. Spike edges render a **triangle (sawtooth) wave** — minima on the hex edge, peaks pointing outward, using the same amplitude as the battlement so the two decorations read at the same size — in the scenario canvas, the Map Editor canvas and the Structure Editor preview. The Structure Editor gained a "Draw small stakes (triangles)…" checkbox for edge structures.
- `tsc` clean; 697 tests pass; `next build` clean. **Apply 096 in Supabase.**

## Map structures polish: battlement, black outline, wall-cover display (2026-09-20)
**Files:** src/lib/{unitCombat,structureDraw(new),mapStructures.test}.ts, src/components/ScenarioMap/{useCombatActions,useCanvasDraw,StructurePaintPanel}.tsx, src/components/MapEditor/{MapCanvas,MapEditor}.tsx, src/components/StructureEditor/{StructureEditor,StructurePreview}.tsx, docs/dev/changelog.md

- **Rename**: "Arm structure tool" → **"Enable structure tools"** (and the place/enable hints).
- **Battlement square-wave now draws on the scenario map too** (`useCanvasDraw` previously only drew plain segments). Shared `src/lib/structureDraw.ts` `battlementPath` used by `useCanvasDraw`, `MapCanvas` and `StructurePreview`; stroke matches the wall colour and is much **smaller** (depth `HEX_SIZE*0.12`, 8 teeth).
- **Structures render as a thick black outline on a transparent background**: the `colour` control is removed from the Structure Editor (and the list dots), and both canvases + the preview drop the colour tint / block-vs-cost styling in favour of a uniform thick black outline (hex = black hex outline, edge = black segment + black battlement). The `StructureTemplate.color` column is left in the DB, now unused (no migration).
- **Wood-wall cover now shows in the verbose combat message.** The roll always used the wall AC (`wallCoverAgainst`, exported from `unitCombat`), but the displayed AC was recomputed from `effectiveAc` only. The verbose roll detail now adds the per-direction cover (`targetAcCovered` / `attackerAcCovered`) so each strike line shows the exact AC used. Unit AC stats and the tooltip are deliberately unchanged — cover is a per-attack modifier, not a unit stat.
- Regression test: seeded wood-wall template → `structuresToWalls` → `meleeWallAc`/`rangedWallAc` = 2. `tsc` clean; 697 tests pass; `next build` clean. No DB change.

## Effect Editor: `range` + `enter_org_max` usable on units and zones (2026-09-20)
**Files:** src/lib/{unitEffects,unitEffects.test}.ts, src/components/ScenarioMap/{ScenarioMap,useCombatActions,useReactionActions}.tsx/.ts

- Both kinds were already selectable in the Effect Editor (and Structure Editor), but the apply-time allowlists skipped them. Added **`range`** to `UNIT_KINDS` and **`range` + `enter_org_max`** to `ZONE_KINDS` in `ScenarioMap`, so a template can now carry them.
- **`range` is consumed from units**: new `unitEffects.effectRangeBonus(unit)` sums `range` modifiers on the unit's effects (direct effects AND ground-zone memberships). Added to `structureRangeBonus` at every consumption point — the attack range gate, the combat weapon bands (also shifts the long-range disadvantage band), and reaction shots (`useCombatActions` / `useReactionActions` / `findEligibleReactionArchers`). It is added to **both** `range` and `maxRange`.
- `enter_org_max` on a dropped **zone** already blocks over-level entry (`zoneBlocksOrg`); it is now selectable from the Effect Editor's zone templates.
- Test: `effectRangeBonus` sums direct + zone-membership range modifiers. `tsc` clean; 696 tests pass; `next build` clean.

## Map structures: range bonuses + gate open/close (2026-09-20)
**Files:** src/lib/{effectTemplates,unitEffects,mapStructures,mapStructures.test,structureCombat,structureCombat.test,archerReaction}.ts, src/types/{gameProtocol,structure}.ts, src/components/EffectEditor/EffectModifierFields.tsx, src/components/ScenarioMap/{useCombatActions,useReactionActions,ScenarioMap,useCanvasDraw,StructurePaintPanel,LeftPanel}.tsx, src/components/MapEditor/MapCanvas.tsx, docs/dev/{18-map-structures,outstanding}.md, docs/players/player-manual.md

- **Structure range bonuses**: a new reusable **`range`** effect modifier kind (authorable on zones/structures). `mapStructures.structureRangeBonus(hex, …)` sums the occupant's `range` modifiers and is consumed in the attack range gate + the combat weapon bands (`useCombatActions`) and reaction shots (`useReactionActions` + `findEligibleReactionArchers`), so a watch tower can extend (or shrink) its occupant's reach and shift the long-range band.
- **Gate open/close**: hex structure instances gained `open`. An **open** gate costs no extra entry MP (`structureHexMoveCost` → skipped) and bypasses its door (attacks hit the structure HP directly, `resolveHexStructureAttack`); closed gates keep their cost + door-first pool. Toggled by the GM from the `StructurePaintPanel`; open gates render an `open` badge instead of `door N` in both canvases.
- Tests: `structureRangeBonus` / `structureHexMoveCost` / `structureIsOpen` / `structureAuraFlags`, and prompt door bypass when open. `tsc` clean; 695 tests pass; `next build` clean. **No DB change.**
- Remaining: AI still ignores structure auras/range/gates (v1).

## Map structures Slice 4: hex structures (2026-09-20)
**Files:** src/lib/{structureCombat,structureCombat.test,mapStructures}.ts, src/components/ScenarioMap/{useCombatActions,ScenarioMap,useCanvasDraw,SoftEnforcementModals}.tsx, src/hooks/useHexGrid.ts, docs/dev/{18-map-structures,outstanding}.md, docs/players/player-manual.md

- **Tower auras** (occupancy): a unit standing on a hex structure gains its effect flags — `advantage`/`disadvantage` on its own attacks, `grant_advantage`/`grant_disadvantage` against attackers. `useCombatActions.performAttack` merges `structureAuraFlags(hex, …)` into the combat copies (and the leading-hero profile) as synthetic effects, so the existing roll-mode reader applies them with no persistence.
- **Hex structures are now attackable** (`src/lib/structureCombat.ts`): a drop on a structure hex opens a **target-picker** ("Attack structure" / "Move here", `useHexGrid` → ScenarioMap `hexAction`). Reach is melee at adjacency, else ranged by `maxRange`. No to-hit roll; the **door resolves first** (`resolveHexStructureAttack`: door HP takes damage until destroyed, then the structure HP), gated by the template/instance DT. Costs 1 action + the attack cap (soft-confirmed), and writes a per-key `STRUCTURE` change.
- **Scenario rendering**: `useCanvasDraw` draws hex structures (colour tint + artwork + HP badge, plus a `door N` badge while the door stands); their images join the preload set.
- Tests: `structureCombat.test.ts` (reach, door-first, destruction, doorless). `tsc` clean; 690 tests pass; `next build` clean. **No DB change.**
- Still pending: structure **range bonuses**; AI ignores structure auras/gates for v1.

## Map structures Slice 3b: `enter_org_max` movement gate (2026-09-20)
**Files:** src/lib/mapStructures.ts (+ test), src/components/ScenarioMap/{mapGeometry,useMoveActions,useOverlay,useReactionActions,ScenarioMap}.ts, docs/dev/{18-map-structures,outstanding}.md, docs/players/player-manual.md

- **`enter_org_max` is now consumed by movement** (player paths). `mapStructures.structureBlocksOrg` / `zoneBlocksOrg` + `makeBlockedEdge(walls, { structures, templates, zones, orgLevel })`: a structure on the crossed edge or the destination hex, or a ground zone there, gates entry for movers above the allowed organization level. Wired through `useMoveActions` (drag move), `useOverlay` (drag overlay), and `useReactionActions` (reaction reposition); scatter/charge unchanged. So Archer Spikes now actually stop Close Order+ from entering while Open Order/Scattered/Hero pass.
- **AI assist still ignores the gate** (consistent with the documented v1 AI scope); the `enter_org_max` authoring was already available on zones and structures.
- Tests: `structureBlocksOrg` / `zoneBlocksOrg` cases. `tsc` clean; 682 tests pass; `next build` clean. No DB change (permission-neutral).

## Map structures Slice 3: scenario-native structures (migration 095) (2026-09-20)
**Files:** src/lib/commandLog.ts, src/hooks/useGameEngine.ts, src/components/ScenarioMap/{ScenarioMap,StructurePaintPanel}.tsx (one new, one deleted WallPaintPanel), src/components/ScenarioMap/LeftPanel.tsx, supabase/migrations/095_structure_command_log.sql (new), docs/dev/{18-map-structures,13-map-entities-terrain,02-schema-and-migrations,outstanding}.md

- **`scenarios.map_data.structures` is now the scenario's source of truth.** Edge structures are converted to the runtime `Walls` continuously (`structuresToWalls` in an effect), so movement/combat/render keep working; `map_data.walls` is no longer written (the legacy `WALL` command branch remains only for historical undo).
- **Per-key `STRUCTURE` command sub-steps** (migration **095**): each change is `{ field:'structures', key, from, to }` (null `to` deletes) merged by `apply_substeps`, so concurrent structure edits can't clobber. `UnitChange` gained an optional `key`; `useGameEngine.setStructureLocal` applies the optimistic result; `'STRUCTURE'` added to `ActionType`.
- **In-scenario structure brush** (`StructurePaintPanel`, LeftPanel Map tab) replaces the legacy `WallPaintPanel`: pick a template, click/drag to place edge or hex structures, click a placed edge again to flip its battlement, edit HP/DT/door, right-click removes — authoring writes straight to `map_data.structures`.
- **Edge-structure attacks** now emit the per-key `STRUCTURE` change (destroyed = delete key) instead of a whole-object `WALL` write.
- Still pending (Slice 3b/4): `enter_org_max` movement consumption; hex door/aura combat + drop target-picker. **Apply 095 in Supabase.** `tsc` clean; 680 tests pass; `next build` clean.

## Map structures Slice 2: library authoring (migration 094) (2026-09-20)
**Files:** src/lib/{mapStructures,mapStructures.test,mapEntities,mapEntities.test,structureTemplateCache}.ts, src/components/MapEditor/{MapEditor,MapCanvas}.tsx, src/components/ScenarioMap/ScenarioMap.tsx, supabase/migrations/094_map_structures.sql (new), docs/dev/{18-map-structures,13-map-entities-terrain,02-schema-and-migrations,outstanding}.md

- **`maps.structures`** replaces `maps.walls` (migration **094**, `maps.walls` dropped — no backfill per the agreed wipe). Instances are keyed `"q,r,dir"` (edge) / `"q,r"` (hex) and hold `{ templateId, hp?, maxHp?, dt?, doorHp?, outside? }`.
- **Map Editor Structures tab** replaces the Walls tab: pick a template from the library palette, click/drag to place edge or hex structures; clicking a placed edge again flips its battlement (`outside`); the selected instance exposes Max HP / DT overrides, Door HP (hex doors), battlement Flip and Remove.
- **`MapCanvas`** renders edge structures (blocked/cost styling, battlement square-wave on the outside, per-face move-cost labels) and hex structures (colour tint + artwork + HP badge).
- **Assign derives the runtime**: `assignMap` snapshots `map_data.structures` and converts edge structures to the runtime `Walls` via `structuresToWalls`, so movement/combat/render are unchanged; `structures` is now a persisted map_data layer (`persistMapData` merge) and loaded/realtime-synced. New `mapStructures.ts` (+ tests) and `structureTemplateCache.ts`.
- **Slice 3/4 pending** (`18-map-structures.md`): scenario-native structures + `STRUCTURE` substeps + wall wipe, in-scenario painting, hex door/aura combat + drop target-picker. `tsc` clean; 680 tests pass. **Apply 094 in Supabase.**

## Map Structure Editor + template library (migration 093) — Slice 1 (2026-09-20)
**Files:** src/types/structure.ts (new), src/lib/{structureTemplates,structureTemplates.test,effectTemplates,unitEffects}.ts, src/types/gameProtocol.ts, src/components/StructureEditor/{StructureEditor,StructurePreview}.tsx (new), src/components/EffectEditor/EffectModifierFields.tsx, app/structure-editor/page.tsx (new), src/hooks/useProfile.ts, src/components/Lobby.tsx, supabase/migrations/093_map_structure_templates.sql (new), docs/dev/{README,14-editors,18-map-structures,outstanding}.md

- **Authored structure library** (`map_structure_templates`, migration **093**): name/description/anchor ('edge'|'hex')/colour/image, `battlement`, directional edge faces **Inside (A)** / **Outside (B)** (block / move cost / melee AC / ranged AC), hex move cost, optional **Door HP** (NULL = none), durability **Max HP 30 / DT 15**, and a standard `modifiers` jsonb. Caps `can_view_structure_editor` / `can_use_structure_editor` + RLS mirror the effect/weapon editors; 9 starter templates seeded (archer spikes, wood/stone wall, gates, gate towers, watch towers).
- **Structures are anchored, not multi-hex**: edge structures carry one directional face per side; hex structures carry an entry cost and an optional destructible door (door resolves door-first, then structure HP — combat lands in a later slice).
- **New reusable effect kind `enter_org_max`**: only formations with an org level ≤ the value may enter. Added to `EffectModifierKind`/`EffectKind`, the modifier-row UI and `statFieldOf`; usable on zones and structures (movement consumption is pending).
- **Map Structure Editor** (`/structure-editor`, arranged like the Effect Editor): 3 panels — searchable template list (New/Clone), the form, and a `StructurePreview` drawing the segment with its battlement square-wave + per-face cost/AC labels (or the hex with image/door badges). Lobby button + `useProfile` access caps.
- **Slices 2–4 pending** (see `docs/dev/18-map-structures.md`): Map Editor Structures tab + `maps.structures`, scenario unification (`map_data.structures`, per-key `STRUCTURE` substeps, wall wipe), hex door/aura combat + drop target-picker. `tsc` clean; 672 tests pass. **Apply 093 in Supabase.**

## Edge walls Phase 2: destructible segments (migration 092) (2026-09-20)
**Files:** src/lib/{walls,walls.test,wallCombat,wallCombat.test,commandLog}.ts, src/hooks/{useGameEngine,useHexGrid}.ts, src/components/ScenarioMap/{ScenarioMap,useOverlay,useCanvasDraw,WallPaintPanel,LeftPanel,SoftEnforcementModals}.tsx, src/components/MapEditor/MapEditor.tsx, supabase/migrations/092_wall_command_log.sql (new), docs/dev/13-map-entities-terrain.md, docs/players/player-manual.md

- **Walls can carry HP/DT** (`maxHp` / `hp` / `dt`, already reserved in `walls.ts`): a segment with no `maxHp` is indestructible scenery; an authored `maxHp` starts at full HP. Editable in both wall editors (Map Editor **Walls** tab + in-scenario `WallPaintPanel`).
- **Attacking a barrier = drag a unit onto the edge.** `useHexGrid` tracks the wall edge under the pointer (`nearestWallEdge`, 0.38·hexSize threshold) while dragging; `canAttackWallEdge` (unit reach + destructible wall) routes the drop to the attack, so a legal move hex still moves. `wallCombat.wallAttackKind`: **melee** if the attacker stands on either edge hex, else **ranged** if the weapon's max range covers the nearer hex.
- **No to-hit roll** — reaching the edge is the hit. `resolveWallAttack` rolls weapon damage; `applyWallDamage` compares it to `dt` (≤ DT = no effect, above = full damage off HP); `hp ≤ 0` removes the segment. Costs **1 action**, counts toward the **5-attack cap** (soft-confirmed when over via the new `PendingWallAttack` modal), no AGR/retaliation.
- **Persistence**: new `WALL` sub-step (migration **092** recreates `apply_substeps` with the branch) merges the walls object into `scenarios.map_data.walls`; `useGameEngine.setWallsLocal` applies it optimistically, so undo/redo/realtime/replay restore wall HP with the command.
- **Rendering**: damaged segments shift to a damage colour and show `hp/maxHp`; the edge under the pointer gets an orange cap while dragging; the two adjacent hexes are tinted (drag overlay).
- Tests: `wallCombat.test.ts` (reach classification, DT gate, destruction), `walls.test.ts` (HP/DT parse default, `applyWallDamage`, `nearestWallEdge`). `tsc` clean; 665 tests pass. **Apply 092 in Supabase.**
- **Phase 3 pending**: temporary (magic) walls with caster/duration (tick at END_TURN like zones) and generalized HP/DT for ground zones.

## Reaction move = full action; formation change merged with move (2026-09-19)
**Files:** src/lib/{archerReaction,archerReaction.test}.ts, src/components/ScenarioMap/{useReactionActions,useOverlay,ScenarioMap}.tsx, docs/dev/08-combat.md, docs/players/player-manual.md

- **Reaction reposition now uses one full action's movement** (was half): `reactionMovePool(unit, maxMP)` = `computeMovePool` for units / `computeHeroMovePool` for heroes (leftover MP, or a full pool when MP is 0). Replaces `getReactionMoveBudget`; used by `getReactionReachable` and the reaction branch of the drag overlay.
- **Reaction move + formation change merged into one session.** A reaction session may combine a full move and a formation change (right-click) in **either order**, each checking its own MP. `performReactionMove`/`performReactionFormation` no longer end the session or abort on `archerReactionUsed`; the flag is still set on the first sub-action so the bow can't be re-offered.
- **New End reaction toolbar** (`ScenarioMap`) while a reaction is locked; Escape closes it too. A **reaction shot is unchanged** and still closes the session immediately (a shot can't be combined with a move/formation).
- Tests: `reactionMovePool` cases (unit full pool / leftover / 0; hero proration). `tsc` clean; 652 tests pass.

## Archer rules: front-only ranged arc + indirect-shot LoS (migration 091) (2026-09-19)
**Files:** src/lib/{attackDirection,lineOfSight,lineOfSight.test,unitCombat,unitCombat.test,archerReaction,archerReaction.test,enemyAI/planner,attackDirection.test}.ts, src/components/ScenarioMap/{useCombatActions,useReactionActions,useOverlay}.ts, supabase/migrations/091_archer_rules.sql (new), docs/dev/changelog.md

- **Front-only ranged arc for formed units.** Phalanx, Shield Wall, Close Order and Open Order may only ranged-attack into their **120° front cone** (mirroring the charge wedge); range/maxRange bands are unchanged. Loose formations (Scattered, Hero) keep all-round; Routed already cannot shoot. Migration **091** sets their `ranged_target_arcs = '{front}'`. **Apply 091 in Supabase.**
- **Root-cause fix**: the ranged-arc gate used `determineCombatPosition`, which only resolves the 6 *adjacent* hexes and returns `'front'` for any distance ≥ 2 — so the arc never restricted long shots ("range is a circle, not an arc"). Added a bearing-based `arcOfTarget(origin, facing, target)` (`attackDirection.ts`) and used it in the player attack path, the reaction-arc check, and the AI planner (its `arcBetween` had the same adjacency bug).
- **Indirect shot (blocked line of sight).** New `src/lib/lineOfSight.ts` traces the hex-centre line (`hexLine`); any other unit (friendly or hostile) strictly between shooter and target turns a ranged attack into an **indirect shot**, resolved at **disadvantage**. Hidden, deleted and dead units do not block (a concealed unit must not reveal itself). Threaded as `indirectShot` through `resolveCombatSequence` → new `RollModeInput.losDisadvantage` cause `'indirect shot'` (so any advantage cancels it, and it shows in the roll note). Applies to normal attacks, archer reaction shots, and the AI expected-damage model; healing/magic stay exempt.
- **Reaction shots** respect both rules: `findEligibleReactionArchers` takes the formations map and requires the mover be in the archer's front arc; blocked-line reactions roll at disadvantage.
- **UI**: drag range rings (and the reaction-mode ring) are clipped to the formation's allowed arcs, so painted range equals legal range.
- Tests: `lineOfSight.test.ts` (new), `arcOfTarget` cases, `combatRollMode`/`resolveCombatSequence` indirect-shot cases, `findEligibleReactionArchers` arc case. `tsc` clean; 651 tests pass.

## Fix: ZoC scatter/pursue fired on every move (2026-09-18)
**Files:** src/lib/zocDisengage.ts, src/lib/zocDisengage.test.ts, src/components/ScenarioMap/useCombatActions.ts

- **Bug**: `performPursuits` ran the "breaks formation to disengage — Scattered" sub-step for **every** move by a formed non-hero (including moving in open ground or *entering* a kill zone), because only the pursuit *candidates* were gated on leaving a ZoC, not the scatter.
- **Fix**: added `hostilesLeftZoc(...)` (the unfiltered "whose ZoC was left" set) and gated the whole reaction on it — if no hostile kill zone was actually left, `performPursuits` returns before the scatter. Entering a ZoC or moving in the open now does nothing; only disengaging scatters + pursues. `pursuitCandidates` now filters `hostilesLeftZoc` by melee/used.
- Tests: `hostilesLeftZoc` enter-vs-leave cases. `tsc` clean; 638 tests pass.

## AGR-failure message: breakdown is verbose-only (2026-09-18)
**Files:** src/components/ScenarioMap/useCombatActions.ts

- An AGR-failed attack now posts a plain line (`"<unit> AGR failed — no attack"`); the dice breakdown (`AGR N → need ≤M, rolled R`) moved to `verboseMessage`, so it only shows in verbose combat.

## Pursue: single AGR before the move (2026-09-18)
**Files:** src/lib/unitCombat.ts, src/lib/unitCombat.test.ts, docs/dev/{08-combat,09-morale-routing-pursuit}.md, docs/players/player-manual.md

- **Bug**: a pursue ran the selection AGR (plain) and then a **second** combat AGR (with a threat penalty) inside `resolveCombatSequence`. A pursuer could pass selection, **move** into the vacated hex, then fail the second roll and not attack — "moved but didn't attack".
- **Fix**: `resolveCombatSequence` now skips its AGR for reaction strikes (`opportunityAttack`, used by `performPursuits` and the cornered volley). The single plain `d10 ≤ AGR` at selection is the only check: a failed candidate **does not move** and the next candidate is tried; the one that passes **always attacks**.
- Test added (pursue strikes vs a high-threat target despite `aggressiveness: 1`). `tsc` clean; 636 tests pass.

## Withdraw by drag-to-rear + rout-modal visibility (2026-09-18)
**Files:** src/lib/{withdraw,withdraw.test}.ts, src/components/ScenarioMap/{useOverlay,useOverlay.test,ScenarioMap,ContextMenu}.tsx, docs/dev/07-movement-economy.md, docs/players/player-manual.md

- **Withdraw is now a drag, not a context-menu action.** The drag overlay paints a formed non-hero unit's two rear hexes **white/droppable** (no face change = no turn needed); dropping there opens an **always-on cost confirm** (2 actions, or free under `free_move`, with a red over-budget note) and applies `performWithdraw`. Removed the ContextMenu "Withdraw" item + the rear-hex picker.
- **Withdraw can't enter a kill zone.** `withdrawDestinations(unit, occupied, gridRadius, threatHexes)` now excludes enemy-ZoC hexes, so the overlay never offers a retreat into danger (and the red danger tint is untouched).
- **Rout modal visibility.** The retreat card's full-screen backdrop lightened (`bg-black/50` → `bg-black/10`), and every in-map overlay/modal (edit-unit modal, tooltips, context menu, effect/magic/settings/attach/stats modals, replay/DM bars, debug panel) is wrapped in a layer that goes `opacity-0 pointer-events-none` while `retreatPick` is active — auto-restoring when the rout resolves — so the highlighted retreat hexes stay visible.
- Tests: `withdraw` threat-exclusion case + a new `useOverlay.test.ts` (rear hexes white, occupied rear hex not white). `tsc` clean; 635 tests pass.

## Zone-of-control pursue + Withdraw (migration 090) (2026-09-18)
**Files:** src/lib/{pursuit,pursuit.test,withdraw,withdraw.test,zocDisengage,zocDisengage.test,routedRetreat,routedRetreat.test}.ts, src/components/ScenarioMap/{useCombatActions,useMoveActions,ScenarioMap,ContextMenu}.tsx, src/hooks/{useGameEngine,useSupabaseSync,useScenarios}.ts, src/components/{UnitEditor}.tsx, src/components/ScenarioMap/UnitEditorModal.tsx, src/lib/{templateMappers,unitMorale}.ts, src/types/gameProtocol.ts, test fixtures, supabase/migrations/090_zoc_pursuit.sql (new), docs/dev/{02,07,08,09}, docs/players/player-manual.md

- **Replaced the parting shot + speed-gated pursuit** with one rule: leaving a hostile kill zone **scatters** a formed non-hero mover and provokes **one** aggression-gated **pursue**. Candidates (`pursuitCandidates`) are melee-capable hostiles whose kill zone was left; ordered **attacker → most MaxMP → most avail MP → random**, each rolls **`d10 <= AGR`** until one passes. The pursuer takes a **free 1-hex step** into the contact hex and makes a **free melee attack at the contact hex** (no reaction, once/turn). Rout-through → attacks the friendly that let the pass; cornered fresh rout → every eligible ZoC unit strikes in place. `src/lib/pursuit.ts`.
- **Hero Commanding-Presence leash**: a candidate inside a hero's 7-hex aura only pursues if that hero's `command_pursuit_permit` is true (**default false = hold the line**). A suppressed chase is annotated in the log. Authorable on the unit template + editable on the placed unit (`UnitEditor`, `UnitEditorModal`), plus a **Command: allow pursue** toggle.
- **Withdraw** (context menu under Rotate 180°): a formed non-hero unit spends **2 actions** (free under free-move; soft over-budget confirm) to step **one hex into a rear-arc hex keeping facing** — **never scatters, never provokes**; archer reactions still fire. `src/lib/withdraw.ts`.
- **Scenario toggle** `zoc_pursuit_enabled` (default ON): OFF = no scatter/pursue/opportunity attack; entering still spends MP, leaving just costs movement. New **Zone-of-control pursuit** setting.
- **Rename** `units.opportunity_attack_used` → `units.pursuit_used` (+ allowlist). **Migration 090** adds the scenario column, the two unit/template columns, and the rename. **Apply 090 in Supabase.**
- **Bug fix**: attaching a hero under **free-move** no longer spends MP/an action (`handleAttachHero` + `useGameEngine.attachHero` now guard on `freeMove`, matching `swapHeroPosition`).
- Tests: `pursuit.test.ts`, `withdraw.test.ts`, reworked `zocDisengage.test.ts` (now `pursuitCandidates`), dropped the `routedRetreat` speed cases. `tsc` clean; 631 tests pass; `next build` clean.

## Edge walls / barriers on maps (migration 089) — Phase 1 (2026-09-18)
**Files:** src/lib/{walls,walls.test,hexLine,hexLine.test,moveCost,moveCost.test,unitCombat,unitCombat.test,mapEntities,mapEntities.test,enemyAI/planner}.ts, src/components/MapEditor/{MapEditor,MapCanvas}.tsx, src/components/ScenarioMap/{mapGeometry,useOverlay,useMoveActions,useReactionActions,useCombatActions,useCanvasDraw,ScenarioMap,LeftPanel,WallPaintPanel}.tsx/.ts, supabase/migrations/089_map_walls.sql (new), docs/dev/13-map-entities-terrain.md

- **A wall sits on a hex edge, with a face per side.** Each face can replace the destination hex's terrain MP cost when crossing in (`moveCost`), be impassable (`block`), and grant **melee AC / ranged AC** to the unit standing on that side. Edges are stored once, canonically, keyed `"q,r,dir"` (`src/lib/walls.ts`), so the two neighbours can't desync.
- **Movement**: `computeReachableMap`/`computeChargeReachable` now pass the *from*-hex to the cost callback (a wall face REPLACES terrain) and accept a `blockedEdge` predicate; charges cannot cross any wall edge. `mapGeometry.makeCostOfHex`/`makeBlockedEdge`/`makeChargeBlockedEdge` build these, wired through the overlay, move, reaction, AI and AI-panel paths.
- **Combat AC**: `resolveCombatSequence` takes an optional `walls`; the crossed face's melee/ranged AC is added to the defender. Adjacent edges exact; ranged uses the new cube-lerp `hexLine` to find the entering edge (`src/lib/hexLine.ts`).
- **Authoring**: Map Editor gains a **Walls** tab (arm the tool, click/drag near an edge to place, right-click removes, a per-side face editor). The in-scenario **Movement** tab gains `WallPaintPanel` for live placement. Walls render as thick edge segments (blocked = near-black, cost = tan, AC-only = steel) in both canvases.
- **Persistence**: migration **089** adds `maps.walls jsonb`; assigning a map snapshots `walls` into `scenarios.map_data.walls` (merged by `persistMapData` so no layer is dropped). **Apply 089 in Supabase.**
- `tsc` clean; 627 tests pass (`walls`/`hexLine` suites added; moveCost/unitCombat wall cases).

_Phase 2 (destructible segments: HP/DT + explicit targeting) and Phase 3 (magic-wall effects + effect HP) remain._

## Advantage/Disadvantage effects + always-recorded verbose messages (migration 088) (2026-09-17)
**Files:** src/types/gameProtocol.ts, src/lib/{unitEffects,unitEffects.test,effectTemplates,unitCombat,unitCombat.test,verboseCombat,verboseCombat.test,enemyAI/planner}.ts, src/contexts/MessageContext.tsx, src/hooks/{useGameEngine,useMessageSync}.ts, src/components/ScenarioMap/{useCombatActions,useReactionActions,useCastActions,ScenarioMap,MessagesPanel,LeftPanel,AddEffectModal,UnitTooltip}.tsx, src/components/EffectEditor/EffectModifierFields.tsx, src/components/ScenarioMap/routeUnit.ts, supabase/migrations/088_advantage_effects.sql (new), docs/dev/{08-combat,10-temporary-effects}.md

- **Four new attack-roll effect kinds**: `advantage`/`disadvantage` (the carrier's own attack rolls) and `grant_advantage`/`grant_disadvantage` (anyone attacking the carrier). They are boolean markers (no amount/stat), materialize through the existing unit/ground-zone membership path, and are read by `attackRollFlags`. Seeded into the effect library as scope `both` by **migration 088** (**apply in Supabase**).
- **Unified roll mode** (`unitCombat.combatRollMode`): `executeAttacks`/`executeSplitAttacks` now take `normal` | `advantage` (two d20, take higher) | `disadvantage` (take lower). Sources = acting unit's own flags + target's `grant_*` + the long-range band. **Any advantage cancels any disadvantage (count irrelevant)** → normal, with a `note` explaining the cause. Recomputed per attacker (retaliation uses the retaliator's own flags; a front-attached hero uses its own, threaded via `AttackerHeroProfile.advantage/disadvantage`).
- **Messages state the cause** (`(advantage — target grants advantage)`, `(disadvantage — long range)`, `(... cancelled ... — normal roll)`); verbose prints the `[adv]`/`[dis]` two-die pair. AI `hitChance` applies the same mode.
- **Verbose messages are now ALWAYS recorded, only DISPLAYED when verbose is on**: `GameMessage` gains `verboseText`, broadcast by `useMessageSync`; `execute` takes a `verboseMessage`; every producer builds the verbose string unconditionally (no more `if (verboseCombat)` gating), and `MessagesPanel` picks the variant. Toggling verbose re-renders the full history with dice detail instead of only affecting future messages.
- UI: `KIND_OPTIONS` + `UNIT_KINDS`/`ZONE_KINDS` accept the four kinds; flag modifiers hide the amount/save controls; tooltip/placement rows show `attack roll`. Tests: `combatRollMode` cancellation matrix, advantage/disadvantage execution, grant effects, zone membership, verbose `[adv]`/`[dis]` tags. tsc clean; 608 tests pass.

## Rename `partingShotUsed` → `opportunityAttackUsed` (migration 087) (2026-09-13)
**Files:** supabase/migrations/087_opportunity_attack_rename.sql (new), src/types/gameProtocol.ts, src/hooks/{useSupabaseSync,useGameEngine}.ts, src/components/ScenarioMap/useCombatActions.ts, src/lib/{unitCombat,unitCombat.test,zocDisengage,zocDisengage.test}.ts, test fixtures, docs/dev/{02-schema-and-migrations,07-movement-economy,08-combat}.md

- Follow-up to the opportunity-attack rename: the **per-turn flag** is now consistent too — `units.parting_shot_used` → `units.opportunity_attack_used`, `Unit.partingShotUsed` → `Unit.opportunityAttackUsed`, and the internal `performAttack` / `resolveCombatSequence` option `partingShot` → `opportunityAttack`. The `unit_field_to_column` allowlist is rebuilt accordingly.
- **Migration 087** does a **guarded rename** (safe whether or not 084 was applied) and adds the column if missing. **Apply in Supabase.**
- tsc clean; 593 tests pass.

## Opportunity attacks: all attackers strike before any rout (+ rename) (2026-09-13)
**Files:** src/components/ScenarioMap/{useCombatActions,useMoveActions,ScenarioMap}.tsx, src/lib/{unitCombat,unitCombat.test,zocDisengage}.ts, docs/dev/{07-movement-economy,08-combat}.md, docs/players/player-manual.md

- **Renamed `performPartingShots` → `performOpportunityAttacks`** (D&D terminology; users are D&D players), and the late-bound ref `partingShotsRef` → `opportunityAttacksRef`. (The `partingShotUsed` flag / `parting_shot_used` column were renamed in the next entry, migration 087.)
- **Bug**: when a unit disengaged from the kill zone of **two** enemies, only the **first** one struck — whichever landed its attack first **routed** the mover and the loop stopped (`defenderRouted` break), skipping the rest. (Order-dependent: Z-then-AB vs AB-then-Z gave different survivors.)
- **Fix**: routing is now **deferred** to after the whole volley. `performAttack` gained a `deferRouting` option (skips its `routeUnit` calls); `performOpportunityAttacks` passes it, tracks the mover's HP between strikes, breaks only on a **killed** mover, and issues **one** ROUT afterwards. So every kill-zone enemy strikes once at the contact hex, then the mover breaks once.
- **Melee-only, clarified**: the strike resolves at the contact hex, so an active-ranged unit **auto-draws its melee weapon** (or Fists) for it — no ranged opportunity attacks. Documented in `08-combat.md` / `07-movement-economy.md` / player manual.
- Tests: comment/name updates only (selection filter unchanged). tsc clean; 593 tests pass.

## Combat messages print one clause per line (2026-09-13)
**Files:** src/components/ScenarioMap/{useCombatActions.ts,MessagesPanel.tsx}, docs/dev/changelog.md

- The ATTACK message (command-log description **and** chat/verbose text) now puts each clause on its own line: the attack header, `{striker} strikes first`, the hero's volley, the unit's volley, the defender-hero line, `{retaliator} retaliates`, the hero that TOOK the retaliation (moved ahead of the volley lines), then the retaliation hero/unit volleys. Verbose dice detail sits on its own clause line.
- `MessagesPanel` gained `whitespace-pre-wrap break-words` so the newlines render and long lines wrap. No test impact (message text only).

## Leading hero auto-joins every attack (replaces the participation prompt) (2026-09-13)
**Files:** src/lib/unitCombat.ts (+ test), src/components/ScenarioMap/{useCombatActions,SoftEnforcementModals,ScenarioMap}.tsx, docs/dev/08-combat.md, docs/players/player-manual.md

- **Simpler rule — no prompt, no cross-client coordination:** a hero attached **in front** now AUTO-joins **every** attack its host makes (melee, ranged, charge, pursuit, parting) when it has an action and a weapon that reaches; a **back-attached (protected)** hero never joins. The attach position is the participation toggle.
- **Weapon auto-switch** mirrors the host: at melee range the hero draws its first melee weapon (or Fists); at range it uses its first weapon whose `maxRange` reaches (else it can't join). `AttackerHeroProfile` gained `range`/`maxRange` so the hero rolls at **its own** disadvantage, not the host's.
- **Out of actions → sits out** (no gate, no negative actions). Heroic Inspiration now triggers on any attack the leading hero joins (melee or ranged).
- **Removed** the `PendingHeroJoin` 3-option modal, the `heroJoin`/`heroOverBudget` options, and their threading through `PendingChargeAttack`/`PendingAttackCap` and the confirm handlers — a net simplification.
- Tests: `unitCombat` hero volley (auto profile) + charge doubling. tsc clean; 593 tests pass.

## Hero joins charge attacks; hero-volley rules documented (2026-09-13)
**Files:** src/components/ScenarioMap/{useCombatActions,SoftEnforcementModals,ScenarioMap}.tsx, src/lib/unitCombat.test.ts, docs/dev/08-combat.md, docs/players/player-manual.md

- **A front-attached hero now joins the host's CHARGE attack too** (previously melee-standard only). The hero-join is resolved once at the drag entry (before the charge branch), so it applies to the full charge, the premature-charge confirm, and the at-cap confirm alike. The hero spends one of its own actions, adds its volley — **doubled while charging** — and triggers Heroic Inspiration. `PendingChargeAttack` / `PendingAttackCap` now carry `heroJoin`/`heroOverBudget` so every confirm path is consistent.
- **Exclusions made explicit (no accidental special cases):** ranged/magic volleys never include the hero, never spend its action, and never trigger Heroic Inspiration; likewise pursuit, parting shots, a defending front hero (stays a damage pool), and the AI. Documented in `08-combat.md` and the player manual, with a rationale comment at the ranged inspiration gate.
- Tests: joining hero volley doubles during a charge (1). tsc clean; 593 tests pass.

## Hero-volley log breakdown + retaliation-cap fix (2026-09-13)
**Files:** src/lib/unitCombat.ts (+ test), src/components/ScenarioMap/useCombatActions.ts, docs/dev/08-combat.md

- **Fix — a unit with a front-attached hero no longer has its defender volley over-capped.** The `unit_melee_hero_cap` ("only 30% can reach hero") was applied to the *whole* retaliation **and then** `executeSplitAttacks` sent 30% of that at the hero — double-reducing the host unit's share (~21% of its real attacks). The cap now applies **only to a lone hero attacker** (`attacker.isHero`); a unit+hero keeps its full volley (e.g. 20 → 6 hero / 14 unit). Both the defender-first strike and the retaliation paths are fixed.
- **Log breakdown — hero vs unit, in both the command-log description and verbose combat.** New `CombatOutcome` fields (`firstStrike`/`retaliation` `AttackerHeroAttacks` + `UnitDamage`/`HeroDamage`) separate the joining hero's own volley from the host's. The header reads `{Attacker} (+ {Hero}) attacks {Target} with {Weapon}`, and each blow lists `{Hero}: N attacks… ` and `{Unit}: N attacks…` separately; the incoming `{defender hero} took …` line is unchanged.
- Tests: full-retaliation-with-hero (no cap), lone-hero still capped, joiner fields. tsc clean; 592 tests pass.

## Hero joins the volley — Phase 2 (2026-09-13)
**Files:** src/lib/unitCombat.ts (+ test), src/components/ScenarioMap/{useCombatActions,SoftEnforcementModals,ScenarioMap}.tsx, docs/dev/{08,09}, docs/players/player-manual.md

- A hero attached **in front** now fights **with** its host: `resolveCombatSequence` takes an `attackerHero` profile (`attackBonus`/`damageDice`/`numberOfAttacks`) and rolls the hero's own active-weapon volley, merging it into the attacker's blow — the first strike, or the attacker's retaliation when the defender holds Reach. The host's formation attack modifier applies; a defender front hero's damage split still applies. The hero **spends one of its own actions** (separate ATTACK sub-step).
- **3-option soft gate when the hero is out of actions**: *Attack with hero (over limit)* → proceed, hero goes negative + red message; *Unit only* → the host attacks alone (no hero blows, no Heroic Inspiration); *Cancel*. New `PendingHeroJoin` modal.
- Attacker-side only (a **defending** front hero stays a damage pool). Charge/pursuit/parting and AI paths don't join. Heroic Inspiration for a front-attached hero now requires it to actually join (`heroJoin`), so a unit-only attack doesn't inspire.
- Tests: `resolveCombatSequence` hero-volley (1). tsc clean; 590 tests pass.

## Hero morale boost: Commanding Presence / Heroic Inspiration + heroic capacity (2026-09-13)
**Files:** supabase/migrations/086_hero_morale_boost.sql (new), src/types/gameProtocol.ts, src/lib/{unitMorale,unitStats,unitCombat,enemyAI/planner,templateMappers}.ts (+ tests), src/hooks/{useSupabaseSync,useGameEngine}.ts, src/components/{UnitEditor.tsx,ScenarioMap/{ScenarioMap,UnitEditorModal,UnitTooltip,UnitTemplateTooltip,useCombatActions,useReactionActions}.tsx}, test fixtures, docs/dev/{02,08,09}, docs/players/player-manual.md

- **New unit attribute `morale_boost` (`n`)** on `unit_templates` + `units` (heroes seeded 1; the template editor auto-fills 1 when **Hero** is toggled). A HERO with `n` steadies every same-alliance unit in its hex + 6 neighbours (**7 hexes**): **Commanding Presence +n**. When the hero **lands a melee attack** (stand-alone, or leading a unit) the aura upgrades to **Heroic Inspiration +n+1** and persists until the start of the hero's next alliance turn (survives moving to the back). `n=0` gives nothing until inspired. Non-heroes are inert, heroes don't inspire themselves, and several heroes don't stack (max). `calcMoraleBoost` feeds `computeEffectiveMoraleModifier`, so combat routs, the tooltip, rally, and the canvas hearts all inherit it.
- **Scenario toggle `hero_morale_boost_enabled`** (default **true**) in Scenario Settings; mirrors into an ambient flag the pure morale lib reads. New `heroic_inspiration_active` unit flag (command-logged; reset at turn start beside `archerReactionUsed`/`partingShotUsed`).
- **Heroic capacity aura**: `heroicCapacityBonus` adds the global `heroic_capacity_multiplier` setting (decimal, seed 1) to a non-hero unit's **attack and retaliation** capacity when a same-alliance hero within 7 hexes is **leading (attached front) or inspired**. Applied in `performAttack`, `useReactionActions`, and the AI planner; `computeAttackCount` now rounds the troop cap so decimal settings are safe.
- **UI**: tooltip Morale-factors row labelled **Commanding Presence +n** / **Heroic Inspiration +n+1** plus an **Aura** line on the generating hero; template blueprint shows “Morale boost +n aura”. `UnitEditorModal` gained a `Morale boost` field and a `Heroic Inspiration` toggle, and the 6 save fields are now labelled **“Saving throws”**.
- Tests: `calcMoraleBoost` (5) + `heroicCapacityBonus` (5). tsc clean; 589 tests pass. **Migration 086 must be applied in Supabase.**
- **Phase 2 (deferred):** the front-attached hero's own attacks will join the host's volley (hero spends an action; 3-option soft gate when out of actions).

## Formation AC split by attack type (melee vs ranged) (2026-09-13)
**Files:** supabase/migrations/085_formation_range_ac.sql (new), src/types/gameProtocol.ts, src/lib/{unitStats,unitCombat,enemyAI/planner}.ts (+ unitStats test), src/components/ScenarioMap/{useCombatActions,useReactionActions,UnitTooltip,UnitEditorModal}.tsx, test fixtures, docs/dev/{02,08}, docs/players/player-manual.md

- **Formations now carry two AC modifiers**: `ac_modifier` was renamed → `melee_ac_modifier`, and a new `range_ac_modifier` covers ranged attacks. `unitStats.effectiveAc(unit, formation, direction, isRanged)` picks the term (front/flank only; still 0 from the rear). **Migration 085 must be applied in Supabase.**
- **Values are data-driven — never hard-coded.** The migration defaults every formation's `range_ac_modifier` to `0` and sets **Shield Wall to +5 ranged** (its melee term stays +3). Tune in test play via SQL (there is no formation editor yet). If the migration isn't applied, code falls back to `0` for ranged.
- **The per-unit shield is unchanged**: its +2 stays baked into `baselineAc` (360°, dropped −2 for two-handed/routing exactly as before). The formation term is *additional* to baseline.
- **`isRanged` is threaded everywhere AC is computed** — `resolveCombatSequence` (both sides), verbose combat, the "rear — no formation bonus" callout, archer reaction shots (already ranged), and the AI planner's expected-damage.
- **Tooltip AC is now annotated by type**: `AC melee: 19, [Range: 21]. [rear: 16]` (brackets appear only when a value differs from melee). The DM editor shows `melee / ranged` when they differ.
- **Note for future balance (magic):** single-target magic entered as a weapon (`magicDimension = 0`) rolls attack rows vs AC exactly like a bow, and has no magic flag to distinguish it — so `range_ac_modifier` currently applies to those hero-heavy attacks too. Area magic (`magicDimension > 0`) resolves by saving throws and is unaffected. Revisit if heroes over-benefit from the split.
- Tests: `effectiveAc` ranged case (1). tsc clean; 579 tests pass.

## Kill-zone stop + parting shot on disengagement (2026-09-13)
**Files:** supabase/migrations/084_parting_shot.sql (new), src/types/gameProtocol.ts, src/hooks/{useSupabaseSync,useGameEngine}.ts, src/lib/zocDisengage.ts (+ test, new), src/components/ScenarioMap/{useCombatActions,useMoveActions,ScenarioMap}.tsx, test fixtures, docs/dev/{02,07,08,09}, docs/players/player-manual.md

- **Entering a kill zone ends the move.** A MOVE whose destination is a hostile threat hex now zeroes the leftover `movementPointsAvailable` (the mover may still spend another action, but that pool is spent) — the "remaining movement reduce to zero" rule the ZoC always implied. Pass-through was already blocked; this closes the leftover pool.
- **Parting shot on disengagement.** Moving OUT of a hostile kill zone provokes **one free attack** from every formed hostile whose kill zone is being left (`zocDisengage.disengageAttackers` → `useCombatActions.performPartingShots`). Resolved through the normal melee tree at the **origin hex** (contact point): AGR applies, the mover's retaliation is suppressed, **free but +1 to the 5-attack cap**, **once per attacker per turn** (`units.parting_shot_used`, migration 084; reset at turn start like `archerReactionUsed`). Strikes resolve sequentially, tracking the mover's HP so a killed mover isn't struck again. **Scattered/Routed/Heroes never make one** (no kill zone), but **any mover can take one — including one that changed to Scattered** or a Hero, which is what closes the mounted hit-and-run (charge in → free double-damage strike → 2nd action scatter and flee). Charge-over overrun and free-move are exempt; routed retreats use the existing pursuit flow.
- **Reuses the existing tree:** `isInKillZone` + `canStopEnemyMovement` for eligibility, the `pursuit` free-attack path in `performAttack`, and `suppressRetaliation`'s deny path for the no-counter. Fixes an adjacent bug where **verbose combat dropped `chained`** on ATTACK.
- Wired through `completeMove` via a late-bound ref (hook-order cycle), so normal moves, charges, the over-budget confirm and **AI moves** all trigger it; the AI panel now drives `completeMove`.
- Tests: `zocDisengage` (9) + `resolveCombatSequence` parting-shot case (1). tsc clean; 578 tests pass. **Migration 084 must be applied in Supabase.**

## Cross-alliance actions hard-blocked + move/charge continuation fixes (2026-09-13)
**Files:** src/lib/weaponParser.ts (+ test), src/lib/chargeOver.ts (+ test), src/components/ScenarioMap/{useCombatActions,useCastActions,useMoveActions,useOverlay,SoftEnforcementModals,ScenarioMap}.tsx, docs/dev/08-combat.md, docs/players/player-manual.md

- **Friendly fire and heal-an-enemy are now hard-blocked** (`validateTargetAlliance`): offensive weapons may only target a **different** alliance; healing weapons only the **same** alliance. The `PendingCrossAlliance` soft confirm is removed (it arrived with the healing gate in `89b1fe9`, contradicting the original combat spec's "blocks friendly fire"). Rationale: cross-alliance attacks/heals are anti-intuitive and near-unused, and the DM/players have explicit tools for those edge cases. Area-cast resolution gains the same guard as defense in depth.
- **Soft over-budget move confirm now runs the full move** (`completeMove`): the confirm path called `performMove` alone, skipping two continuations — the chained `CHARGE` `chargeDistance` tick (so a charging unit that moved over budget never reached a full charge, and the **charge-over prompt never appeared**) and `DETACH_HERO` (so an attached hero moved but stayed attached — "can't detach"). Both paths now share `completeMove` (move → charge tick → drag-away detach). `isChargeOverEligible` also uses the hero proration rate for hero chargers.
- **Drag overlay matches the drop**: hovering any unit during a drag now paints it as a **target** (green hostile / red ally-invalid) and suppresses the movement-reachability paint, instead of showing a movement path that the drop would treat as an attack.
- Tests: `validateTargetAlliance` (1), hero charge-over affordability (1). tsc clean; 568 tests pass.

## Corpse scatter: linear outward density, centre reachable, 1.6× radius (2026-09-13)
**Files:** src/lib/corpseTracker.ts, src/lib/battleStats.test.ts, docs/dev/15-token-rendering.md

- Replaced the annulus `0.20 + √rand · 0.24` (a visible ring with an empty centre and a hard 0.44 cap) with a **continuous linear radial density**: random direction, candidate radius accepted with probability `r / R` (rejection sampling — no `sqrt`/square curve in the code). Density rises linearly from the centre to the edge, so the wider outer 60° sectors carry proportionally more dots and the middle stops over-clumping.
- **Radius doubled** to `R = 0.88 × HEX_SIZE` (old max `0.44`) and the `0.20` inner floor removed, so dots now fill the hex and the centre is reachable (sparse) again. Later trimmed to `R = 0.704` (80% length) — the first pass ran too far out.
- Still deterministic + prefix-stable (extra draws happen in index order), so the cache/undo/replay behaviour is unchanged. Test now asserts the `[0, 0.704]` bounds and the ~25%/75% inner/outer split. tsc clean.

## Directional formation AC: no bonus from the rear (2026-09-06)
**Files:** src/lib/attackDirection.ts (+ test, new), src/lib/unitStats.ts (+ test), src/lib/unitCombat.ts, src/lib/enemyAI/planner.ts, src/hooks/useGameEngine.ts, src/components/ScenarioMap/{useCombatActions,useReactionActions,ContextMenu,UnitTooltip,ScenarioMap}.tsx, src/components/TokenRenderer/drawToken.ts, docs/dev/08-combat.md, docs/players/player-manual.md

- **Formation AC is now actually applied in combat** (it was tooltip-only — combat rolled against raw `currentAc`, so the displayed formation bonus did nothing). New `unitStats.effectiveAc(unit, formation, direction) = baselineAc + (rear ? 0 : formation.ac_modifier) − shieldPenalty`, used by combat, tooltip, messages, and the AI.
- **Uniform rear rule**: a formation gives **no AC bonus from the rear** for any formation. Direction comes from the new bearing-based `attackDirection()` (works for melee and ranged; reproduces the adjacent front/flank/rear classification exactly).
- **Shields stay 360°** (in `baselineAc`); two-handed/routing drops unchanged. Heroes face all sides, so they never take the rear penalty.
- **Shield Wall now requires a shield** to form (engine + reaction formation + context menu; two-handed still blocks it).
- **Tooltip** shows `AC 21 (18 at rear)`; **verbose combat** rolls against the correct direction-aware AC and annotates `[rear — no formation bonus]`; reaction shots too. **Shield Wall tokens** now draw shield arcs on the flanks as well as the front row (the rear is left open).
- Tests: `attackDirection` (4) + `effectiveAc` (5). tsc clean; 566 tests pass. No migration (values read from existing `formations.ac_modifier`).

## Pursuit diagnostics: adjacent units only, verbose-gated (2026-09-06)
**Files:** src/lib/routedRetreat.ts, src/components/ScenarioMap/ScenarioMap.tsx

- `pursuitGateInfo` now lists only **adjacent** hostiles (matching `choosePursuer`'s hard `hexDistance === 1` gate) and drops the `not adjacent` note; non-adjacent enemies were pure noise.
- The per-unit gate list on a failed pursuit is shown only when **verbose combat** is on; otherwise the log says a short `No melee pursuer can strike {unit}.` (`verboseCombat` added to `applyRoutedFlow`'s deps). tsc clean; 557 tests pass.

## Rally: recover routed units via the context menu (2026-09-06)
**Files:** src/lib/rally.ts (+ test, new), src/hooks/useGameEngine.ts, src/components/ScenarioMap/{ContextMenu,ScenarioMap}.tsx, docs/dev/09-morale-routing-pursuit.md

- New **Rally** context-menu item for any **non-fearless** unit/hero (visible but greyed with a reason until eligible), placed in the **formation group directly under Scattered** (heroes, who have no formation list, still get the row). Eligibility (`canRally`): currently Routed, alive, **positive effective morale**, and **no visible hostile adjacent** (hidden hostiles ignored; routed hostiles still count).
- On Rally, one undoable `FORMATION` command sets `currentFormation → Scattered` (heroes → `Hero`), `organizationLevel → 0`, and clears `actionsAvailable`/`movementPointsAvailable` (spends the rest of the turn).
- The normal formation picker is now **hidden while Routed**, so Rally is the only way out (the old `changeFormation` rally guard remains as a safety net for non-menu callers).
- Tests: `canRally` (8). tsc clean; 557 tests pass.

## Fix: Add/Edit Weapon form wiped fields on a library pick (2026-09-06)
**Files:** src/components/WeaponEditorModal.tsx, src/lib/weaponParser.ts, src/lib/weaponParser.test.ts, src/lib/weaponMappers.test.ts

- Root cause: the Add/Edit Weapon modal pre-maps the `weapons` library with `mapWeaponRow`, then called `mapWeaponRow(lib)` **again** on click. The mapper reads snake_case, so the second pass found `max_range`/`damage_dice`/`attack_bonus`/… undefined and reset them to defaults — a library pick silently lost its **maximum range** (plus dice/bonus/magic dimension/saves). Fix: `setWeapon({ ...lib })` (already a `Weapon`), with a comment; affects both the scenario DM editor and the unit editor (shared modal).
- `formatWeaponDisplay` (and `getWeaponDisplayText`) now show the disadvantage band as `range–maxRange`, e.g. `Long bow 1x +4 1d8 3–12hex`; melee/`maxRange === range` stay `Nhex`.
- Tests: regression guard documenting `mapWeaponRow`'s snake_case-only contract + updated display expectations. tsc clean; 549 tests pass.

## Range-attack weapon-switch prompt (2026-09-06)
**Files:** src/lib/weaponParser.ts (+ test), src/components/ScenarioMap/{useCombatActions,SoftEnforcementModals,ScenarioMap}.tsx, docs/dev/08-combat.md

- Attacking a target beyond the active weapon's `maxRange` no longer silently switches when several weapons could reach. New rule: **0 reachers** → red flash + "cannot reach"; **1** → silent auto-switch (unchanged); **2+** → a `PendingWeaponSwitch` confirm offering only the **first** reaching weapon (single green "Switch to X and attack" button + Cancel), so a caster with many spells isn't flooded with choices. Cancel lets the player pick manually and redo.
- Added `weaponIndicesReaching(weapons, activeIndex, dist)` (arsenal order, non-healing) + tests; `handleAttackRequest` gains a `weaponIndex` resume option (also avoids stale-`units` re-prompting).
- tsc clean; 547 tests pass.

## Effects: transparent background (2026-09-06)
**Files:** supabase/migrations/083_effect_transparent_background.sql (new), src/lib/effectTemplates.ts (+ test), src/types/gameProtocol.ts, src/components/EffectEditor/{EffectEditor,EffectHexPreview}.tsx, src/components/ScenarioMap/{ScenarioMap,EffectsPanel,EffectFormModal,AddEffectModal}.tsx, src/components/ScenarioMap/useCanvasDraw.ts, docs/dev/{02-schema-and-migrations,10-temporary-effects}.md

- New per-effect **Transparent background** toggle (template + per placed instance): the ground-zone hex tint is skipped so only the artwork (and the small marker dot / unit pip) show. The colour still drives the marker/pip/swatch. Migration **083** adds `effect_templates.transparent_background`; the flag rides the drag payload and every `UnitEffect`/`GroundEffect`; `EffectHexPreview` shows the bare hex.
- Tests: `effectTemplates` mappers (3). tsc clean; 544 tests pass. **Migration 083 must be applied in Supabase.**

## Effect Editor: image-size slider + 7-hex preview (2026-09-06)
**Files:** supabase/migrations/082_effect_image_scale.sql (new), src/lib/effectTemplates.ts, src/types/gameProtocol.ts, src/components/EffectEditor/{EffectEditor,EffectHexPreview}.tsx (hex preview new), src/components/ScenarioMap/{ScenarioMap,EffectsPanel,EffectFormModal,AddEffectModal}.tsx, src/components/ScenarioMap/useCanvasDraw.ts, docs/dev/{02-schema-and-migrations,10-temporary-effects}.md

- New per-template **image scale** (percent, default 100) with a slider in the Effect Editor under the image picker (and in the drop/edit form). Migration **082** adds `effect_templates.image_scale`; the scale rides the drag payload and every `UnitEffect`/`GroundEffect`, and `useCanvasDraw` multiplies the drawn artwork height (default = 1.2 hex-radii) by it.
- New **`EffectHexPreview`**: the right panel now previews the effect over a **7-hex grid** (centre + 6 neighbours) at the same relative size as the map, so you can size the image against real hexes.
- tsc clean; 541 tests pass. **Migration 082 must be applied in Supabase.**

## Unit Editor: contextual Create / Save / Cancel footer (2026-09-06)
**Files:** src/components/UnitEditor.tsx, docs/dev/changelog.md

- The sticky footer now matches the Weapon Editor's flow: a **new** unit (its id isn't in the loaded list) shows **Create** + **Cancel**; a **loaded** unit shows **Save** + **Save As** + **Cancel** + **Delete**. Cancel discards the draft and clears the selection (routed through the existing unsaved-changes prompt when dirty). tsc clean; 541 tests pass.

## Weapon Editor page + shared weapon form (2026-09-06)
**Files:** supabase/migrations/081_weapon_editor.sql (new), src/lib/{weaponParser,weaponMappers}.ts, src/components/WeaponEditor/{WeaponFields,WeaponEditor}.tsx (new), src/components/WeaponEditorModal.tsx, app/weapon-editor/page.tsx (new), src/hooks/useProfile.ts, src/components/Lobby.tsx, docs/dev/{01-architecture,02-schema-and-migrations}.md, README.md, src/lib/weaponMappers.test.ts (new)

- New **Weapon Editor** at `/weapon-editor` (Lobby button beside the other editors; admin/dm author, everyone views). Two panels — searchable list + form, **no preview** — with New / Clone / Save / Delete writing the `weapons` library directly instead of hand-editing the DB.
- **Shared form**: the weapon fields were extracted into `WeaponFields`, used by both the new page and the existing Add/Edit Weapon modal, so they always match. Validation + defaults live in `weaponParser` (`isValidDamageDice`/`blankWeapon`/`validateWeapon`); row<->object mapping in `weaponMappers`.
- Migration **081**: `can_view_weapon_editor`/`can_use_weapon_editor` access caps (view all, use admin/dm), `user_has_access` cases, defensive column adds, and RLS on `weapons` (select = view, insert/update/delete = use).
- Tests: `weaponMappers` (5). tsc clean; 541 tests pass. **Migration 081 must be applied in Supabase.**

## Cache the deterministic corpse layout (2026-09-06)
**Files:** src/lib/corpseTracker.ts, src/components/ScenarioMap/useCanvasDraw.ts, src/lib/battleStats.test.ts

- `corpseScatterPositions` and the new `corpseDots(q, r, groups)` memoize their deterministic output (module `Map`, cleared past 5000 entries). `useCanvasDraw` now just looks up the per-hex dot list and draws — pan/zoom/hover/replay no longer regenerate positions or allocate spec arrays each frame. Drawing still scales with the total corpse count (unavoidable), but generation is one-time per hex+count.
- Behaviour identical; test asserts the cached list is reference-stable and matches the raw scatter. tsc clean; 536 tests pass.

## Corpse piles match the dead unit + spread from the centre (2026-09-06)
**Files:** src/lib/corpseTracker.ts, src/components/ScenarioMap/useCanvasDraw.ts, src/lib/battleStats.test.ts, docs/dev/15-token-rendering.md

- Fallen-troop dots now mirror the unit that died: **team colour**, **mounted = triangle / foot = circle**, radius scaled by `sizeCategory`×`visualScale` — all recovered from the `PLACE` sub-step payload in the command log (no migration, no new table; still derived, not stored).
- `FallenMap` is now `Record<string, FallenGroup[]>` (per team/mounted/size group), so a hex that saw a foot unit and a mounted one keeps both.
- Removed the 40-dot cap; scatter now uses an **annulus `0.20 + √rand · 0.24`** so piles no longer over-clump at the centre (overlap elsewhere is fine). Deterministic + prefix-stable (test updated).
- tsc clean; 535 tests pass.

## Effects: zones undoable, library context menu, stat zones on move (2026-09-06)
**Files:** supabase/migrations/080_zone_command_log.sql (new), src/lib/commandLog.ts, src/lib/unitEffects.ts, src/hooks/useGameEngine.ts, src/components/ScenarioMap/{ScenarioMap,AddEffectModal}.tsx, src/lib/unitEffects.test.ts, docs/dev/{02-schema-and-migrations,10-temporary-effects,outstanding}.md

- **Zone ops ride the command log** (migration 080): a new `ZONE` sub-step writes the whole `groundEffects` array into `scenarios.map_data` in the same transaction as the log row, so paint/drop/edit/clone/reorder/drop-effect **and the END_TURN tick/expiry** are undoable and appear in replay. The engine gains `applyZoneChange(prev, next, desc)` + `setZonesLocal`; ScenarioMap routes every zone mutation through it (no more direct `map_data` writes for zones). Migration 080 also makes `apply_substeps` array-aware for `text[]` columns (supersedes the hand-applied array fix).
- **Unit "Effects…" dialog now uses the effect library** (`effect_templates`) instead of the hardcoded in-code catalog — composites (Haunted), Sleep (`hp_borrow`, with a borrow-amount field), and zone templates apply from the context menu. It builds an `EffectFormValue` and reuses `applyUnitDrop`/`applyZoneDrop`.
- **Stat zones apply on move**: `computeZoneReconcile(unit, zones)` (extracted, tested) is used by a new move-time `EFFECT` sub-step, so entering/leaving a Bless/Bane/Slow hex applies/restores the stat immediately rather than waiting for the unit's next activation. END_TURN's sweep unchanged.
- Tests: `computeZoneReconcile` (4). tsc clean; 535 tests pass. **Migration 080 must be applied in Supabase.**

## Verbose rolls show save → damage per troop (2026-09-06)
**Files:** src/lib/unitEffects.ts, src/lib/verboseCombat.ts, src/components/ScenarioMap/useCastActions.ts, src/lib/unitEffects.test.ts, src/lib/verboseCombat.test.ts, docs/dev/10-temporary-effects.md

- Effects already rolled damage per troop; `EffectDamageDetail` now also carries `saveDC`, `saveRolls` (each troop's save total) and `applied` (post-save damage). `describeEffectDamage` (verbose) prints every roll paired: `1d2 per troop DC 16 → 2(18→1), 1(13→1), 2(3→2), 1(20→0) (Σ 6)` where each entry is `damageRoll(saveTotal→applied)`.
- Magic keeps its single shared damage roll; `verboseCombat.formatSaveRolls`/`formatSpellBaseFaces` are replaced by `formatSpellRollLine` → `21 (1,1,1,2,3,4,4,5) per troop DC 16 → 18→10, 13→21, 3→21, 20→10`. `useCastActions` appends this to the verbose cast/heal message. `spellDamage.ts` mechanics unchanged.
- Tests updated. tsc clean; 531 tests pass.

## Effect damage: roll dice per troop (2026-09-06)
**Files:** src/lib/unitEffects.ts, src/lib/unitEffects.test.ts, docs/dev/10-temporary-effects.md

- esolveEffectDamage now rolls the effect dice **once per affected troop** (each troop takes its own roll, save-adjusted, capped at its troop HP) instead of one roll spread across the unit. EffectDamageDetail gains olls (each troop's roll) alongside oll (the sum). Verbose messages list the per-troop rolls ("1d2 per troop → 2, 2, 1, 2, 1 (Σ 8)").
- Removed the now-unused savedTroopCount helper; saves roll per troop inline. Tests updated. tsc clean; 531 tests pass.


## Effect damage now reported in chat (2026-09-06)
**Files:** src/lib/unitEffects.ts, src/hooks/useGameEngine.ts, src/components/ScenarioMap/ScenarioMap.tsx, src/lib/unitEffects.test.ts, docs/dev/10-temporary-effects.md

- DoT ticks (unit effects + ground zones) and zone **entry** damage previously only produced the command line (e.g. "End Turn — enemy turn begins"), so the damage was invisible. esolveEffectDamage now returns a structured EffectDamageDetail (roll, saves, troops before/after, HP before/after) alongside the changes, and computeEndTurnEffects emits damageEvents.
- describeEffectDamage formats one chat line per event: **who**, **how many troops affected**, **damage/heal taken**, and troops lost; **verbose combat** (erbose_combat) appends the die roll (2d6 = 7) and save count. END_TURN and MOVE now pass these as the message (entry-zone damage rides the move message).
- effectDamageChanges kept as a thin wrapper over esolveEffectDamage. New tests: detail/roll/affected, non-verbose vs verbose text, and a DoT tick event. tsc clean; 531 tests pass.


## Effect Editor: images/layers, editable drops, edit + clone (2026-09-06)
**Files:** supabase/migrations/078_effect_editor_layer.sql (new), supabase/migrations/079_effect_images_bucket.sql (new), src/lib/effectTemplates.ts, src/types/gameProtocol.ts, src/lib/unitEffects.ts, src/hooks/useGameEngine.ts, src/components/ColorField.tsx (new), src/components/EffectEditor/EffectModifierFields.tsx (new), src/components/ImagePickerModal.tsx, src/components/EffectEditor/EffectEditor.tsx, src/components/ScenarioMap/EffectFormModal.tsx (new), src/components/ScenarioMap/{ScenarioMap,EffectsPanel,AddEffectModal}.tsx, src/components/ScenarioMap/useCanvasDraw.ts, src/components/TokenRenderer/drawToken.ts, src/components/Lobby.tsx, docs/dev/{10-temporary-effects,02-schema-and-migrations,01-architecture}.md, README.md, src/lib/unitEffects.test.ts

- **Removed the obsolete magnitude mode**: deleted the editor select + magnitudeMode type/mapper plumbing; migration 078 drops effect_templates.magnitude_mode.
- **Effect images + layers**: migration 079 adds the effect_images bucket; migration 078 adds effect_templates.layer ('above'|'below'). Effect artwork now renders on the map on its hex — below unit in the ground-effects pass, above unit after the tokens (still under fog); an "above" image hides while the unit on its hex is hovered (getLoadedImage sync cache lookup + a preload tick in useCanvasDraw). UnitEffect/GroundEffect gained imageUrl/layer, threaded through drag payloads and all apply paths.
- **Effect Editor polish**: title "Effects Library" → "Effect Editor" (and the Lobby button); the image URL text box is now a picker/uploader from effect_images (generalized ImagePickerModal with bucket/title/showRaces); a **below/above unit** select sits beside it; the colour input is a swatch + hex box + preset palette (ColorField). Extracted the shared modifier row into EffectModifierFields.
- **Editable pre-apply drop form** (EffectFormModal): shows and lets you edit name/colour/image+layer, duration, tempo, and every modifier before applying; **removed the zone radius** (a zone drops on the single dropped hex) and there is no description field. (The old hp_borrow borrow-amount box is gone — the modifier's own amount field carries it.)
- **Placed-effect edit + clone**: the "Effects at hex" right-click menu gains **Edit** (reopens the shared form, persists to map_data.groundEffects) and **Clone** (one-shot — the next left-click places a copy; Esc / right-click cancels). The unit **Effects…** modal now lists the ground zones on the unit's hex with Edit/Clone/✕, and its unit effects gain **Edit**. Unit-effect edits go through the new editEffectChanges (remove + re-apply in one EFFECT command; stat snapshots rebase) exposed as editEffect in useGameEngine.
- Tests: editEffectChanges added (3). tsc clean; 528 tests pass.
- **Migrations 078 / 079 must be applied in Supabase.**


## Effect editor: one amount field + responsive mid panel (2026-09-06)
**Files:** src/components/EffectEditor/EffectEditor.tsx, src/lib/effectTemplates.ts, docs/dev/10-temporary-effects.md

- Removed the redundant numeric magnitude/delta input: each modifier now has a single **amount** field accepting a plain number (flat) or dice XdY±Z (X=0 = flat Z). The flat part is mirrored into delta so stat kinds and legacy consumers are unaffected; blank clears both. New modifiers and lankEffectTemplate seed dice: '1', and the preview summary shows the dice when present.
- Effect editor mid panel now shrinks to fit: dropped the fixed max-width, grids collapse (lg:grid-cols-2, sm:grid-cols-3), modifier rows wrap, and the side panels narrow (w-52/w-56, widening at lg).



## Log outstanding backlog for next session (2026-09-06)
**Files:** docs/dev/outstanding.md (new), docs/dev/README.md, docs/README.md, AGENTS.md

- Added a forward-looking roadmap: remaining effects work (images/layer bands, composite-instance decision), Full AI mode, the Spelljammer engine, blocked player-team/auth items, rules housekeeping, docs refresh + screenshot manifest, migration notes (068-077 applied; the apply_substeps array fix exists as SQL only - consider a 078 migration file), and the owner's uncommitted ship WIP.



## Entry-zone troop-count prompt + DoT tick help (2026-09-06)
**Files:** src/hooks/useGameEngine.ts, src/components/ScenarioMap/{ScenarioMap,EffectsPanel}.tsx, docs (changelog)

- Landing on an **entry** zone now prompts 'How many troops are caught?' (0 = none; default = all). Only that many troops roll saves / take the dice damage (per-troop cap). The engine awaits the prompt and folds the result into the same MOVE command (undo-safe); all/legacy = all troops if no callback.
- EffectsPanel notes DoT damage begins on the effect's next tick; use a zone entry effect for immediate damage.



## Effects: dice/heal/saves, zone menu (Move up/down, Drop Effect) (2026-09-06)
**Files:** src/types/gameProtocol.ts, src/lib/effectTemplates.ts, src/lib/unitEffects.ts + test, src/hooks/useGameEngine.ts, src/components/ScenarioMap/{ScenarioMap,EffectsPanel,useCanvasDraw}.tsx, src/components/EffectEditor/EffectEditor.tsx, docs (changelog)

- Effect modifiers now accept dice ('XdY+Z'; X=0 => flat Z) and a healing flag; plus savingThrow/saveDC/onSaveHalfOrNeg. DoT/entry dice roll each tick / on entry and are spread per affected troop, **capped at troop HP** (healing capped at troop HP too); per-troop saves: d20+bonus >= DC passes => half (or negate). Legacy numeric effects unchanged.
- Tempo anchor: zones/effects dropped with no caster now carry casterTeam = current turn alliance so they tick once per cycle on that alliance (free play anchors friendly).
- Right-click an empty hex with ground effects -> 'Effects at hex' menu: Move up/down (zIndex draw order) and **Drop Effect** (DM or the effect's creator). Effects Editor gained dice/heal/save/DC controls. 525 tests, tsc clean.
- Still pending: the entry 'How many troops are affected' prompt (currently all troops), and the DoT no-tick-on-drop text note.



## Pursuit is melee-only + adjacency-gated (2026-09-06)
**Files:** src/lib/routedRetreat.ts + tests, src/components/ScenarioMap/ScenarioMap.tsx, docs (changelog)

- Pursuit (and the no-retreat FREE pursue attack) is now **melee-only**: a pursuer must be ADJACENT to the vacated/standing hex (no 2-hex run-up / teleport) and its ACTIVE (primary) weapon must be melee — a ranged unit never pursues, even when it caused the rout.
- The no-retreat 'attacker always free-attacks' shortcut was removed: the free pursue attack now uses the same gate (attacker still preferred when eligible melee); if no adjacent melee pursuer exists there is simply no free attack (log explains why).
- Diagnostics report adjacency/melee/speed/reach/MP per candidate. 520 tests, tsc clean.



## Pursuit speed gate: equal effective speed now pursues (2026-09-06)
**Files:** src/lib/routedRetreat.ts + test, docs (dev/09 + changelog)

- choosePursuer no longer multiplies the routed unit's (already x1.5) effective rout speed by another 1.5. Gate 2 is now 'pursuer effective MaxMP >= routed effective routing MaxMP', so an equally-fast rider (4 vs 4) pursues. Diagnostics and tests updated.



## Pursuit: verbose gate diagnostics + free pursue attack (2026-09-06)
**Files:** src/lib/routedRetreat.ts, src/components/ScenarioMap/{ScenarioMap,useCombatActions}.tsx, docs (changelog)

- When no enemy pursues, a log line now reports each nearby hostile and exactly which pursuit gate fails: speed (effective vs routed effective x1.5), one-droppable-move reach into the vacated hex, and affordable MP (e.g. rider 4 < 6 -> no pursuit).
- **Pursuit attacks no longer cost an action** (they were spending 1 via the normal attack sub-step). They remain free like charge attacks, still +1 toward the attack cap; the follow move still pays 1 MP.



## Effect engine: zone mp_cost affects movement (2026-09-06)
**Files:** src/components/ScenarioMap/ScenarioMap.tsx, docs (changelog)

- Movement now uses a **merged cost map** = painted terrain + live zone 'mp_cost' deltas (clamped 0-9). Zone bog/slow hexes actually cost extra MP to enter, and zone 'free'/'cheaper' deltas reduce costs (floor 0). Reach overlay, drag moves, charges, pursuit, reactions and AI plotting all read the merged map; painting visuals still use the raw painted map.



## Effect engine: zone ENTRY damage (2026-09-06)
**Files:** src/types/gameProtocol.ts, src/lib/unitEffects.ts, src/hooks/useGameEngine.ts, src/components/ScenarioMap/ScenarioMap.tsx, docs (changelog)

- New zone kind **entry**: landing on an 'entry' zone hex deals its damage immediately (in the same move command, so undo reverts the trap), to the mover and any attached hero. Works for drag moves, charges, pursuit and free-move landings (engine keeps a live zone list via syncZoneEffects). Zones can also carry 'mp_cost' (stored; movement effect still pending). Unit types extended with entry/mp_cost kinds.



## Glossary removed (keep tooltips); Sleep/hp_borrow engine (2026-09-06)
**Files:** src/components/{ScenarioMap/TopBar,ScenarioMap,UnitTooltip}.tsx (tooltip help kept), src/lib/{unitEffects.ts,unitEffects.test.ts}, src/types/gameProtocol.ts, ScenarioMap drop UI, removed GlossaryModal/terms, docs (changelog)

- Removed the TopBar '?' glossary (nobody reads a dictionary mid-game; tooltips remain), per request.
- **hp_borrow (Sleep) engine**: new effect kind. Applying deducts X HP immediately (NEVER below 1 HP — cannot kill, troops derive), ticks on the caster activation, and refunds X (capped, troop-corrected) when it expires/removed — but only if the unit is still alive. Unit drop UI prompts for the borrowed amount. +2 tests; 517 tests, tsc clean.



## Plain-language glossary + inline term help (2026-09-06)
**Files:** src/lib/terms.ts (new), src/components/GlossaryModal.tsx (new), src/components/ScenarioMap/{TopBar,ScenarioMap,UnitTooltip}.tsx, docs (changelog)

- New searchable **Plain-language glossary** (TopBar '?') explains every abbreviation and wargame term in one line each (AC, AGR, MOR, MP, DoT, ZoC, 2H, F, NR, Reach, Rout/Rally/Charge, Rear/Flank, saves/DC, ranges, formations, Hero/Unit, Attach, Effects/tempo, alliances, Free Move, Undo, Replay).
- Unit tooltip labels (HP/Move/Actions/Attacks/AC/AGR/MOR) gained hover tooltips with the same plain-language definitions so jargon is explained inline too.



## Fix: tempo-free effects tick once per turn cycle + context cleanup (2026-09-06)
**Files:** src/lib/unitEffects.ts + unitEffects.test.ts, src/components/ScenarioMap/ContextMenu.tsx, docs (changelog)

- **DoT multi-burn bug**: effects/zones with no caster team (GM/player tempo-free) ticked on EVERY alliance's End Turn, burning 2-3x per cycle. They now tick once per game turn on the FIRST active alliance's activation (friendly if none assigned); caster-tagged effects are unchanged. +1 regression test.
- Removed the separator between 'Attach to Unit...' and 'Other Action...'.
- Clarification: the 'effect engine stage' only refers to the NEW library kinds (Sleep/hp_borrow, zone entry, zone mp_cost, composite instances, image layers) - core ac/morale/movement/dot + zones were already implemented.



## Effects tab: drag-&-drop application (assigned players) (2026-09-06)
**Files:** src/components/ScenarioMap/{EffectsPanel.tsx (new),LeftPanel.tsx,ScenarioMap.tsx,ContextMenu.tsx}, docs (changelog)

- The Effects tab now lists the library as **draggable cards**. Drag onto an empty hex opens a **zone placement** prompt (duration + radius fill); drag onto a unit opens an **apply** prompt (duration). Zone placement expands ac/morale/dot modifiers across the radius and persists to map_data.groundEffects; unit apply uses the existing applyEffect path. hp_borrow/entry/mp_cost modifiers post a 'needs the engine stage' note for now.
- Context-menu 'Effects...' removed (replaced by the drag path; unit effects are now placed from the Effects tab). Zone painting terrain MP-cost remains GM-only.



## Context menu: Other Action under Attach to Unit (2026-09-06)
**Files:** src/components/ScenarioMap/ContextMenu.tsx, docs (changelog)

- 'Other Action' now sits directly under 'Attach to Unit...' for unattached heroes (and stays available next to front/back swap for attached heroes). The context-menu 'Effects...' entry is temporarily retained until the Effects-tab drag-and-drop apply engine (empty hex -> zone with prompts; unit -> apply prompt) replaces it.



## Effects tab for assigned players (Stage 2a) - 2026-09-06
**Files:** src/components/ScenarioMap/{LeftPanel,ScenarioMap}.tsx, docs (changelog)

- The left-panel **Effects** tab now appears for every participant with a team (any role); unassigned viewers still see nothing. Assigned players may arm an effect zone template and paint zones on the map at any time (no action/MP or turn limit); terrain (MP-cost) painting remains GM-only. Unit-target effect application stays available via each unit's context menu.
- (Still ahead: library drag-&amp;-drop + radius/unit-apply modals - the effect-template apply engine.)



## Hero 'Other Action' + Select wording + context clamp (Stage 1) - 2026-09-06
**Files:** src/lib/commandLog.ts, src/hooks/useGameEngine.ts, src/components/ScenarioMap/{ContextMenu,ScenarioMap}.tsx, docs (changelog)

- Heroes get an **Other Action** context entry: spends 1 action (soft-confirm at 0; free under Free Move) and logs a generic line - the table roleplays/resolves the deed by hand. OTHER_ACTION action type, undoable.
- Attached-hero wording renamed to **Select {name}** (hero/host), forward-compatible with multiple heroes per ship.
- Context menu position is clamped to the viewport (tooltip-style).



## Effects library — Stage 1: schema, access, editor (2026-09-06)
**Files:** supabase/migrations/077_effect_templates.sql (new), src/lib/effectTemplates.ts (new), src/hooks/useProfile.ts, src/components/{Lobby,EffectEditor/EffectEditor}.tsx, app/effect-editor/page.tsx (new), docs (changelog)

- Global **effect_templates** library (migration 077, apply to DB): DM/admin author; everyone may apply. Template = name/description/color/image_url/scope(unit|zone|both)/magnitude(fixed|caster_input)/default_duration + a modifiers array, so composites (Haunted = ac-2 + morale-1) and special kinds (hp_borrow Sleep, zone entry, zone mp_cost) are authored as data. Rows seeded from the in-code catalog plus Haunted/Sleep/Fire Field/Smoke/Bog examples. RLS + iew_effect_editor/effect_editor access caps and user_has_access cases added.
- Types + row mappers (src/lib/effectTemplates.ts).
- **Effects Library editor** at /effect-editor (3-panel like Unit Editor: left selector, middle authoring incl. a modifier composer, right preview summary). Lobby button in hazard style.
- Note: applying templates into scenarios (tick/refund, zones/radius, image layer bands, hover/hit-testing) is the next stage. 515 tests, tsc clean.



## Map editor: painting 0-MP free hexes works (2026-09-06)
**Files:** src/components/MapEditor/MapEditor.tsx, docs (changelog)

- Standalone Map Editor treated every paint value <= 1 as 'clear', so arming the pen at 0 (free entry) silently erased instead of marking the hex free. Painting now deletes only for cost 1 (the default) and stores 0 as a free-entry hex; the free tint + 0 label render on the canvas.



## Lobby: construction-hazard editor buttons (2026-09-06)
**Files:** `src/components/Lobby.tsx`, docs (changelog)

- The three editor/library buttons (Archfar's Shipyard, Unit Editor/Unit Library, Map Editor/Map Library) now use diagonal black + muted-yellow hazard stripes (`repeating-linear-gradient(45deg, …)`, thin `#8a7a12` border, near-white label) so they read as builders'-yard entries — distinct from the disabled Replay Scenario gray and the green action buttons.

## Lobby: mute editor/library buttons — 2026-09-06
**Files:** `src/components/Lobby.tsx`, docs (changelog)

- Archfar's Shipyard, Unit Editor/Unit Library and Map Editor/Map Library now use a muted slate style (`bg-gray-800/70`, thin `border-gray-600`, `text-gray-300`) so the bright green action buttons (New/Join/Delete Scenario) remain the visual focus.

## Lobby left panel button order + separators — 2026-09-06
**Files:** `src/components/Lobby.tsx`, docs (changelog)

- Lobby left panel reordered to: **Admin Panel · Settings** → separator → **New Scenario · Join Scenario · Replay Scenario** → separator → **Archfar's Shipyard · Unit Editor · Map Editor**, with **Delete Scenario pinned as the very last action** (contextual deletion banner / Request Deletion / Lock sit just above it). Lifecycle column merged into the single action list.

## Delete scenario requires typing the name — 2026-09-06
**Files:** `src/components/Lobby.tsx`, docs (changelog)

- Both scenario-delete flows (creator "Confirm Delete" of a flagged deletion request and "Delete Scenario") now open a modal that requires **typing the exact scenario name** before the Delete button enables (Enter works too; Cancel dismisses). Removes the plain `confirm()` guard.

## Corpses (fallen circles) + Scenario statistics — 2026-09-06
**Files:** `src/lib/{corpseTracker,battleStats}.ts` + tests (new), `src/hooks/useCommandLogRows.ts` (new), `src/components/ScenarioMap/{ScenarioStatsModal.tsx,TopBar.tsx,useCanvasDraw.ts,ScenarioMap.tsx}` (new/changed), `src/components/ScenarioMap/{useCombatActions,useCastActions,useReactionActions}.ts`, corpse-leak audit (`mapGeometry`,`unitMorale`,`fogOfWar`,`archerReaction`,`unitInteractions`), docs (changelog)

- **Corpses**: a dead non-hero is now pure scenery. Its hex is fully passable and it is excluded from every rule system (threat/ZoC, morale, fog reveal, reactions, hit-testing). A deterministic per-hex **fallen-troop pile** (derived from the command log; troop losses count on the hex the unit stood on; GM edits excluded; undo removes rows) is drawn as neutral scattered circles seeded by `q+r` (stable as the pile grows), under live tokens.
- **Scenario statistics** (derived from the log + live units, undo-safe): roster of placed units (excl. GM-deleted, incl. hidden), level, max troops, troops at start of Turn 1 (turn-1 wins, else max), current troops, **troop kills** and **hostile levels** (Σ victim level × troops killed), status Effective/Routed/Killed. Damage sub-steps now carry `payload { killerUnitId, victimLevel }` for attack/retaliation/charge/magic/reaction; DoT/GM award nothing. Sorted friendly → enemy → neutral, heroes first, then level high→low.
- **UI**: a 📊 **Stats** button in the TopBar — visible to the DM during live play and to anyone during replay. Opens a stats panel locally; **Share to all players** posts the summary to Messages (hidden units revealed fully).

## AI assist: heroes & hero-mounted units are player/DM-only — 2026-09-06
**Files:** `src/lib/enemyAI/planner.ts` + `planner.test.ts`, docs (`docs/dev/17-enemy-ai.md`, changelog)

- **Reverts** the previous "heroes ride with AI hosts" logic (combined moves are gone). Heroes are **never AI-controlled**, and neither is any unit with an attached hero — players and the DM play those;
the AI only plots ordinary units. `isAiControllable` now rejects `isHero`
units (lone or attached) and hero hosts. Planner tests updated. 511 tests,
`tsc --noEmit` clean.

## AI assist: smarter planner (v2) — turns, doctrines, target priority — 2026-09-06
**Files:** `src/lib/enemyAI/planner.ts` + `planner.test.ts`, `src/components/ScenarioMap/{AiPanel,ScenarioMap,aiTypes,useCanvasDraw}.tsx`, docs (`docs/dev/17-enemy-ai.md`, changelog, player-manual §12)

- Planner steps now include **turn (60°) and formation**. Formed units rotate to face objectives (1 MP/60° via real `applyMpSpend`, free for Hero/Scattered/Routed, never about-turn/org-drop); previews draw turn glyphs + a formation chip.
- **Doctrine auto by weapon**: ranged-only units stand off (Scattered near contact, keep a gap, no fist-fighting); melee/hybrid engage.
- **Ranged target priority = biggest threat first**: enemy within 2 hexes → Phalanx → Close Order → expected damage breaks ties. Melee prefers targets attacked from the enemy's **rear/flank** and tries cheap flanking approaches (≤ a few turns + a straight leg, real budget); otherwise closes frontally.
- Execution drives turn/formation through the real `rotateUnit`/`changeFormation` with just-in-time validation (affordability/availability). 4 new tests. 510 tests, `tsc --noEmit` clean.

## AI assist: routed flee stops at the map rim — 2026-09-06
**Files:** `src/lib/enemyAI/planner.ts` + `planner.test.ts`, `src/components/ScenarioMap/{AiPanel,ScenarioMap}.tsx`, docs (`docs/dev/17-enemy-ai.md`, changelog)

- Routed fleeing no longer runs off the board: `AiPlanContext.gridRadius` bounds `chooseFleeHex`, so the run stops on the **outer rim** of the grid and never moves beyond it. A unit already at/outside the rim (grid shrunk) stays put — the DM gets a chance to hide the broken unit. AiPanel passes the live map `gridRadius`. +2 tests. 506 tests, `tsc --noEmit` clean.

## AI assist: routed units flee as far as possible — 2026-09-06
**Files:** `src/lib/enemyAI/planner.ts` + `planner.test.ts`, `src/components/ScenarioMap/AiPanel.tsx`, docs (`docs/dev/17-enemy-ai.md`, changelog)

- Routed units on AI teams are now plotted: instead of being skipped they **run away** — each step lands on the reachable hex strictly farthest from the nearest hostile (enemy kill-zone landings penalized), spending all their actions; they never attack. `isAiControllable` no longer excludes Routed; execution guards skip a routed unit's attack step ("X is routing — it cannot attack"). +1 test. 504 tests, `tsc --noEmit` clean.

## AI assist: per-unit opt-out (click ✓ to exclude) — 2026-09-06
**Files:** `src/components/ScenarioMap/{ScenarioMap,AiPanel,aiTypes,useCanvasDraw}.tsx`, `src/lib/enemyAI/planner.ts` + `planner.test.ts`, docs (`docs/dev/17-enemy-ai.md`, changelog, player-manual §12)

- AI selection state lifted to ScenarioMap (`aiTeams`, `aiExcluded`, `aiBusy`); AiPanel is controlled. A **plain click on an AI-eligible token toggles its opt-out** (canvas `onUnitClick` — drags untouched; clicks ignored while Execute runs; reaction-arming takes precedence). Excluded-but-eligible units draw a **grey opt-out badge** in place of the ✓.
- Opt-outs clear at each End Turn (fresh selection per alliance activation); teams persist. Opt-out or team changes invalidate the current idle plot.
- Planner gains `excludeUnitIds` and skips excluded units (+ test). 503 tests, `tsc --noEmit` clean.

## AI assist (GM plotting tool) — 2026-09-06
**Files:** `supabase/migrations/076_ai_assist.sql` (new), `src/lib/enemyAI/{planner,index}.ts` + `planner.test.ts` (new), `src/components/ScenarioMap/{AiPanel.tsx, aiTypes.ts}` (new), `src/components/ScenarioMap/{LeftPanel,useCanvasDraw,ScenarioMap}.tsx`, `docs/dev/17-enemy-ai.md`, docs/changelog + player-manual (§12 + S-33)

- **AI assist** — a Scenario-Settings toggle (`ai_assist_enabled`, migration 076) reveals a GM-only **AI** left-panel tab. Teams dragged into an *AI control box*; eligible units (active-alliance teams only, never deleted/killed/hidden/attached/Routed) wear a fixed-size ✓.
- **Pure planner** (`src/lib/enemyAI/`): deterministic `planAiMoves` over board copies — best expected-damage legal attack (fog-aware, adversarial-alliance-only, under attack cap) else best scored reachable hex (threat/ZOC + terrain aware) using real MP accounting so the AI never plans a soft-enforcement action. 11 tests.
- **Preview** draws route polylines + crossed-swords on attack targets + a ghost at the end hex (dimmed unless hovered); Reset is free (nothing logged). **Execute** replays through the real `performMove`/`performAttack` path one command at a time with Pause / Step / Resume / Cancel remainder; steps are re-validated live and skipped with a message when invalid.
- **Undo**: unit-by-unit by default; an **Undo Execute** macro captures the top `command_log` id before the batch and loops server-validated `undo()` until back at baseline. No schema/RPC changes.
- Non-goals (future): whole-turn auto-director, auto-answered prompts, AI charges/magic/reactions/hero-attach, difficulty knobs, bot accounts. 502 tests, `tsc --noEmit` clean.

## Documentation reorganization — technical menu + player manual (2026-09-06)
**Files:** `docs/README.md` (new), `docs/dev/README.md` (new, technical menu), `docs/dev/01-architecture.md`…`docs/dev/16-ship-builder.md` (new), `docs/players/player-manual.md` (new, single book), `README.md`, `AGENTS.md`, `handover.md` (now a stub), moved: `handover.md` → `docs/dev/changelog.md`, `HANDBOOK.md` → `docs/dev/legacy/HANDBOOK.md`, `NOTEBOOK.md` → `docs/dev/legacy/NOTEBOOK.md`

- Reviewed the entire doc set. verdict: `handover.md` was great history but no reference; `HANDBOOK.md` mixed tech with superseded design prose (formation/AGR/threat/undo/Auth sections stale); `NOTEBOOK.md` examples predated the threat-ratio + formation-modifier changes.
- Reorganized into two menus: **technical** (dev chapters by subsystem, written from `src/lib`/`src/hooks`/migrations, with `file:line` citations) and **player** (a single book with instructions, worked examples, GM-flagged sections, and a 32-shot screenshot manifest with placeholders at `docs/players/screenshots/<id>.png`).
- Examples verified against the real libs via a throwaway vitest file (economy accounting, hero proration, formation-change cost, threat ratings/wounds, and a full 10-roll melee exchange) — corrected several hand-derived numbers (e.g. a 4-MP move from a fresh unit consumes both actions → MP 2/actions 0; melee retaliation count uses the full engaged front, not one row).
- Archive: `docs/dev/legacy/` holds HANDBOOK + NOTEBOOK for mining. Migration status table in `docs/dev/02` flags applied/awaiting/unverified. Spelljammer engine still pending; player manual excludes ship content (dev chapter 16 only). 491 tests, `tsc --noEmit` clean.

# Handover — 2026-08-03

## Unit 5-attack cap (soft) + hero 5-action prorated movement (2026-08-24)
**Files:** `supabase/migrations/060_attack_cap_hero_actions.sql` (new), `src/lib/{moveCost,unitCombat,attackCap}.ts` + tests, `src/types/gameProtocol.ts`, `src/hooks/{useGameEngine,useSupabaseSync}.ts`, `src/components/ScenarioMap/{ScenarioMap,UnitTooltip}.tsx`, `HANDBOOK.md` (§7.10/§4.9/§14), `.scratch/spelljammer-mod/spec.md`, `AGENTS.md`

- **Migration 060** — applied to the DB. `units.attacks_used INTEGER NOT NULL DEFAULT 0`; `units.movement_points_available` → **NUMERIC** (heroes carry 1-decimal fractions, units stay whole); settings seeds `unit_attack_cap = 5`, `hero_actions_per_turn = 5`; `unit_field_to_column` allowlist gains `attacksUsed → attacks_used` (sub-steps may write it).
- **Hero economy** (`moveCost.ts` hero variants): heroes start each turn at **FULL MP + 5 actions** (units start 0 MP / 2 actions); each converted action grants `maxMP/5` MP (`heroMovePerAction`, 1 decimal — maxMP 3 → 0.6; mounted 6 → 1.2). **Fraction carries** (0.6 → 1.2 → 1.8 …; display floors, storage keeps the decimal). `applyHeroMoveCost` spends materialized MP first then converts `ceil((cost − MP)/per)` actions (may go negative — soft); `applyHeroMpSpend` for attach/detach/swap; `computeHeroMoveBudget/Pool` = MP + actions×per; `isHeroMoveAffordable`. `useGameEngine` branches `moveUnitRecorded`/attach/detach/swap on `isHero`; `endTurn` resets heroes to **full effective MP + 5 actions**, units to 0 MP/2 actions + `attacks_used → 0`; spawn mirrors it (heroes spawn with full MP).
- **Attach/detach/swap**: −1 hero MP; when MP < 1 the UI asks **"convert [#] actions to 1 MP?"** (`pendingHeroAttachConversion`/`pendingHeroSwapConversion` modals, [#] = `ceil((1−MP)/per)`); over-budget fallback keeps the old confirm.
- **Unit attack cap** (`attackCap.ts`, soft): every `ATTACK` command counts +1 for non-hero attackers (free-action/charge/AGR-failed included); a defender's actual retaliation counts +1. **Attacker at cap → pause + modal ("attack past the 5-cap?")** → confirm executes + red message (6/5), cancel aborts. **Retaliator at cap → pause + modal** → allow records over-cap + red message; **decline suppresses the counter** (`suppressRetaliation(..., atCap=true)`, works even in simultaneous combat). Stashed-resume pattern: `performAttack` accepts `stashed` (same outcome, no re-roll) so the modal decision resumes without new dice; charging continuation (charge-over/charge-end) handled in both modal handlers.
- Tooltip: `Actions: n/5` heroes / `n/2` units; `Attacks: n/5` (red at cap); `Move` shows `(0.6 MP/action)` for heroes.
- 334 tests (moveCost hero suite + suppressRetaliation cap cases + attackCap); `tsc --noEmit` clean.

## Spelljammer module design docs + Archfar's Shipyard admin entry point (2026-08-24)
**Files:** `.scratch/spelljammer-mod/spec.md` (new), `HANDBOOK.md` (§17 + §14.2/§14.3), `supabase/migrations/059_ship_editor_access.sql` (new), `src/hooks/useProfile.ts`, `src/components/Lobby.tsx`, `AGENTS.md`

- **Spelljammer design closed - v8.1 FINAL; code is canonical** (`src/lib/shipStats.ts` implements it; docs + `.scratch/shipyard-formula/shipyard.csv` align): ships are hero-like (no retaliation/morale/rout, no 5-attack cap - rate of fire = weapons x Fire Cycle x crew). Scenario settings: **sub-turn toggle** (OFF = ground combatants; ON = 5 segments / 1 action per hero), **environment** (Space | Atmosphere; active cap = TopSpeed vs AtmosphereSpd), **firing arcs**. Movement on the fly: **speed per turn**, a Helm action moves `speed/5` hexes and adjusts speed by **Accel = 18 x sails/mass** toward the active cap (**Top Speed** 12/11/10/9, **Atmosphere Spd authored**, Overthrust +2 with skill check + subsystem-damage risk); **MC = hexes to travel per 60 deg turn** (integer, lower = better) with **TE = speed/MC** (1 decimal, higher = better) via the parabola (`u* = clamp(0.33+5.4*fill+0.2*(25/mass-0.5),0.33,0.6)`, `w = clamp(0.4+0.05*rudders,0.45,0.7)`, `TE_max = clamp(3*(25/mass)^0.7,0.8,3)`); differential caps = persistent `Vp - Vt` chase; **hit boxes** (1t = 1 box, only armor + hullR safe, BoxHP = ceil(5 x (1+armorFactor)), weapon anchors S=10/L=20 doubled when reinforced, per-instance pools, hullR 1t/1000gp = +25 Ship HP AND reinforces next-in-order, crew quarters = ceil(crew_count/5), Ship HP = frame base + hullR x 25, **DT flat 15**, repair kits); **crew** = `crew_count` complement (>= min crew) with a `ship_crews` roster; **officer actions** = no bridge `max(1, helmsman Int mod)` / bridge `max(4, 4 + captain Int mod)`; Jettison Heavy = cargo-ejector device (deploys 1-t space mines). Stations + crew reserve + **info war** (Tiny open, Small+ own station only, Command Bridge panel sees all, destroyed -> blackout); captain kit = panel + enable-only (redo / +1 result), no gambits. Heroes never auto-die -> D&D VTT handoff. Migrations 066 (schema) + 067 (seed) + 068 (RLS) + 069 (ship_crews) + 070 (extra_crew -> crew_count).
- **Migration 059 — applied to the DB.** `access_roles.can_view_ship_editor` + `can_use_ship_editor` (BOOLEAN default false), seeded **true only for admin**; `user_has_access` extended with `view_ship_editor` / `ship_editor` cases (mirrors 050).
- **`useProfile`**: `Access.canViewShipEditor` / `canUseShipEditor` added to the matrix (select/fallback/EMPTY_ACCESS).
- **`Lobby`**: admin-only **"Archfar's Shipyard"** button (left panel, `canViewShipEditor`) opens a placeholder "under construction" modal; `canUseShipEditor` will gate the future ship builder.
- Design-docs only + entry point: no ship entities/combat/sub-turn engine yet. 314 tests; `tsc --noEmit` clean.

## Move highlight reflects leftover MP: full pool only when MP is exhausted (2026-08-18)
**Files:** `src/lib/moveCost.ts` + test, `src/components/ScenarioMap/ScenarioMap.tsx`

- **Bug**: `computeMovePool` returned a full MP pool whenever `actionsAvailable >= 1`, so the reachable highlight never shrank as MP was spent.
- **`computeMovePool`** now returns the full pool **only when `movementPointsAvailable <= 0`** (an action materializes a fresh pool); once MP is on hand it returns exactly the leftover MP (an action only refills a pool after the current MP is exhausted).
- **`handleUnitMove`** now builds the droppable reachable map from `computeMovePool` (was `computeMoveBudget` = leftover + all action pools), so the shown highlight and the accepted drop area stay in sync. `computeMoveBudget` import removed from ScenarioMap.
- 314 tests; `tsc --noEmit` clean.

## Movement cone wedge + about-turn settings + hero AGR/cap rules + DM rout (2026-08-18)
**Files:** `supabase/migrations/053_settings_about_turn_hero.sql` (new), `src/lib/moveCost.ts` + test, `src/lib/unitCombat.ts` + test, `src/hooks/useGameEngine.ts`, `src/components/ScenarioMap/{ContextMenu,ScenarioMap,UnitTooltip}.tsx`

- **Migration 053 — apply to the DB.** Seeds: `about_turn_cost_foot` (1), `about_turn_cost_mounted` (2), `about_turn_org_penalty` (1), `hero_combat_capacity` (0.5 decimal). **Apply to the DB.**
- **Movement cone (item 1)**: white reachable set is now the **full front wedge** (BFS over the two front-arc dirs, keeping facing) — interior zig-zag hexes like `(1,-2)` are droppable, not just the two edge rays. Grey (turn-required) set = turn-cost Dijkstra minus white; never droppable.
- **About-turn (item 2)**: a 180° about-turn is a **single maneuver** charged from settings — foot 1 MP / mounted 2 MP — plus `about_turn_org_penalty` (1) org levels, free for Hero/Scattered/free-move. **Mounted units in Close Order cannot about-turn** (blocked in `rotateUnit` + the cone Dijkstra never faces them rearward, so rear hexes cost 3 MP via 60° turns instead of 2). ContextMenu Rotate 180° shows the dynamic cost/org and is disabled when blocked.
- **Front hero ignores AGR (item 3)**: `resolveCombatSequence` skips the AGR roll when the attacker has a **front-attached hero** (`attachedAttackerHero`). UnitTooltip shows "Front hero — host attacks ignore AGR".
- **Hero combat troop cap (item 4)**: `applyHeroCombatCap` multiplies a side's attack count by `unit_melee_hero_cap` (0.5 default, renamed from `hero_combat_capacity` in migration 058) when a unit strikes a **lone hero** or retaliates against a **hero attacker** (lone or front-attached) — **melee only** (ranged attacks against heroes are uncapped). Note: `only X% of troop can reach hero in melee`. Unit-vs-unit-with-front-hero is unchanged (`hero_attack_split` handles it).
- **DM Rout (item 6)**: GM-only **"Rout Unit"** context-menu action (`useGameEngine.setRouting`, no un-rout), routed through the command log so it's undoable.
- 313 tests; `tsc --noEmit` clean.

## Alliance-wide End Turn, replay co-watch + turn-1 marker, live command_log (2026-08-18)
**Files:** `supabase/migrations/052_alliance_end_turn_replay.sql` (new), `src/hooks/useReplay.ts`, `src/components/ScenarioMap/{ScenarioMap,ReplayOverlay}.tsx`

- **Migration 052 — apply to the DB.** (1) `command_log` published to `supabase_realtime` — the UndoDebugPanel and cross-client `refreshUndoState` update live (they subscribe to `postgres_changes`, which never fired before). (2) `execute_command` relaxed: a **non-GM player may run `END_TURN`'s `SCENARIO` step** while their own alliance holds the turn (free play / null turn stays GM-only; `ALLIANCE` steps stay GM-only). (3) new **`replay_state`** table `(scenario_id PK, mode, cursor, playing, updated_at)` with participant RLS + realtime publish. **Apply to the DB.**
- **Alliance-wide End Turn**: the End Turn button is enabled when `isGM || (currentTurnAlliance !== null && myAlliance === currentTurnAlliance)`; free play (null) is GM-only. The **free-move end-turn warning modal was removed** — ending the turn from free play just starts Turn 1 (free_move auto-off, turn-0-prep behavior from earlier work is unchanged).
- **Replay fixes (items 1–4 of the earlier batch)**:
  - The broadcast `mode:'replay'` handler now mirrors local `setMode` (reset cursor/playing + bump `reloadKey`) — fixing players landing on an empty **0/0** timeline when the DM enters replay.
  - Late joiners **auto-enter replay**: `useReplay` reads `replay_state` on mount (mode + cursor + playing) and applies the persisted cursor once the timeline loads; local mode/cursor/playing are **debounced-upserted** (skipped for broadcast-derived state to avoid echoing). The live realtime-subscribe on `replay_state` was dropped (self-echo would fight an actively-playing local clock — the broadcast channel handles live sync).
  - `turnOneIndex` exposed from `useReplay` (first step whose state has `turn_number >= 1`); `ReplayOverlay` draws a small amber **▲** under the slider at that position.
- **Ranged-drag rings (item 5B)**: while dragging, the movement highlight shows **only** (no unconditional range rings). Range rings + target tint appear **only when hovering a different-alliance valid target**, and the movement highlight is suppressed then.
- 305 tests; `tsc --noEmit` clean.

## Turn/rotate/threat/morale ruleset: free+180° rotates, own-turn gate, kill-zone threat, only-attacks-rout, distance-only moves (2026-08-18)
**Files:** `src/components/ScenarioMap/{ContextMenu,ScenarioMap,UnitTemplateTooltip,UnitTooltip}.tsx`, `src/hooks/useGameEngine.ts`, `src/lib/{moveCost,scenarioPermissions,unitMorale}.ts` + tests, `.scratch/command-log/spec.md`

- **Rotates**: free + 180° rotate options; own-turn gate (non-GM can only act during their alliance's turn — GM overrides via `permRef`/`canActOnUnit`).
- **Kill-zone threat**: threat rating only pressures an attacker standing in the target's front kill zone (front two hexes).
- **Only attacks rout**: movement alone never routs — only an attack (combat or spell) can break morale into a rout.
- **Distance-only moves**: movement costs distance only (turning is a separate paid ROTATE); threat hexes reachable but not passable.
- **Tooltip clamps** (`useTooltipClamp.ts` new): tooltip stays on-screen near the cursor.
- 309 tests; `tsc --noEmit` clean.

**Files:** `supabase/migrations/051_server_authoritative_commands.sql` (new), `src/hooks/useGameEngine.ts`, `src/components/ScenarioMap/ScenarioMap.tsx`, `src/lib/commandLog.ts` (new), `src/lib/commandHistory.ts` + test, `src/game/GameEngine.ts` + `GameEngine.test.ts` (deleted)

- **Migration 051 — apply to the DB.** `command_log.seq` BIGSERIAL (backfilled by `created_at, id`; unique + `(scenario_id, seq)` index). The live top chain is now totally ordered by `seq` — `(created_at, id)` could tie same-timestamp commands in arbitrary uuid order, which made undo reject valid targets and redo reorder chains.
- **`execute_command` / `undo_commands` / `redo_commands` / `undo_state` RPCs** (SECURITY DEFINER, `SET search_path = public`). All state mutations now flow through a shared **`apply_substeps`** that writes sub-step deltas to `units` / `team_alliances` / `scenarios` **in the same transaction as the log mutation** — the units table and the command log can no longer diverge. The old flow (client `updateUnit` write, then a separate `command_log` insert) was the root cause of undo reverting the wrong state and of un-undoable drift when one write failed.
- **`apply_substeps`** uses a camelCase→snake_case allowlist mirroring `updateUnit()` (unknown field → `RAISE`, never silently skipped), expands `hex` → `hex_q/r/s`, derives `organization_level` from `current_formation`, and applies `from`-deltas in reverse when undoing. Internal only — no client EXECUTE grant.
- **`execute_command`** requires the caller to be a **participant** (`scenario_participants`); **ALLIANCE/SCENARIO sub-steps are GM-only** (they write `team_alliances` / `scenarios`). Server-enforced, not just client-gated. `created_at` default + `updated_at = now()` on all target tables (keeps Lobby recency ordering).
- **`redo_commands`**: redo target = the newest `deleted_at` batch; owner-or-GM permission; **invalidated when any live command has `seq` above the batch's max** (a new action clears redo; LIFO-correct across undo-then-undo chains).
- **`undo_state`**: returns `{ undo: { ids, count, description, playerName, canUndo }, redo: {...} }` from the log alone — drives the Undo/Redo buttons with no client stack.
- **`useGameEngine`**: client-side `GameEngine` stack deleted. `execute`/`undo`/`redo` call the RPCs with optimistic local apply (realtime confirms). New `undoState` cache (from `undo_state`) feeds `canUndo`/`canRedo`/`peekUndoChainLength`, refreshed on mount, on every `command_log` realtime INSERT/UPDATE, and after each action. **A rejected undo no longer corrupts state** — it just shows "Cannot undo…" and refreshes (the old pre-pop + `hydrateFromLog` churn was the "undo does nothing" bug).
- **Cleanup**: types moved to `src/lib/commandLog.ts` (`ActionType/SubStep/UnitChange/CommandEntry/CommandLogRow/parseSubSteps/rowToEntry` + `UndoState`); `src/game/GameEngine.ts` + test deleted; `buildStackFromLog` removed from `commandHistory.ts` (replay + row helpers kept, re-exported so `useReplay`/`UndoDebugPanel` are untouched); `ScenarioMap.tsx` swaps `hydrateFromLog` for `refreshUndoState`.
- **Historical note**: `undo_stack_size` setting (047) is now unused (no client stack) — left in place, harmless. Old pre-051 rows keep their backfilled seqs at the bottom of the chain; they can't be reached by normal undo and are safe to keep or clear.
- 298 tests (GameEngine 7 + buildStackFromLog 4 removed); `tsc --noEmit` clean.

## Fix: joining an open room silently failed when the DM was online (2026-08-11)
**Files:** `src/hooks/useScenarios.ts`, `src/components/Lobby.tsx`

- **Root cause**: the lobby's Room Open badge subscribes a read-only presence channel `presence:${scenarioId}` per scenario. `checkDMOnline` (used by `joinScenario`) tried to open a **second** channel on the same topic; `RealtimeClient.channel()` reused the already-subscribed channel, and `RealtimeChannel.on('presence', …)` on a joined channel **throws** ("cannot add 'presence' callbacks … after 'subscribe()'"). The throw rejected the join even though the DM was online and the room was open.
- **`checkDMOnline`** now reuses the existing lobby presence channel (reads `presenceState()`, short 1.5s poll for the GM) instead of opening a new one; the old one-shot probe remains as a fallback for non-lobby contexts.
- **`Lobby.performJoin`** now toasts **every** join error (was: only messages containing "Game Master"); passwordless-room failures (DM offline, room closed, RLS) are now visible.
- 309 tests; `tsc --noEmit` clean.

## Turn 0 free play: free_move auto-ends at Turn 1 + alliance-gated movement (2026-08-11)
**Files:** `src/hooks/useGameEngine.ts`, `src/components/ScenarioMap/ScenarioMap.tsx`

- **Turn 0 = free play** (`current_turn_alliance` null, `free_move` ON by default). The End Turn button shows **"End Turn (Free Play)"** in gray instead of a misleading friendly-blue label.
- **`endTurn`**: `leavingFreePlay = currentAlliance === null` → first End Turn sets `turn_number + 1` (Turn 1 begins) AND pushes a `free_move → false` SCENARIO change (rides the command log, undo restores it). Returns `freeMoveEnded`. The DM can still re-enable free move manually later.
- **Movement gating** (`canControlUnit`): GM always overrides; otherwise role-scope gate first; then during free play / free move (`freeMove || turn === null`) role scope is the only gate; from **Turn 1 on**, only units whose alliance group equals `current_turn_alliance` may move/attack/rotate (drag, context menu, keyboard all flow through this). `permRef` now also carries `currentTurnAlliance`, `freeMove`, `isGM`.
- `performEndTurn` passes `freeMove`, applies `setTurnNumber` on `wrapped || freeMoveEnded`, and clears local free move when it ended. Free-move confirm modal copy updated.
- 309 tests; `tsc --noEmit` clean.

## Unit template tooltip in Unit Selector (2026-08-11)
**Files:** `src/components/ScenarioMap/UnitTemplateTooltip.tsx` (new), `src/components/ScenarioMap/UnitSelector.tsx`

- Hovering a template row in the left-panel **Unit Selector** shows a blueprint tooltip (`fixed`, follows cursor, `pointer-events-none` so drag-to-place is unaffected): name/race/⭐Hero header; grid of Level · Size · Movement · **AC (DB `baselineAc`, not recalculated)** · Troops · Troop HP · Max unit HP · AGR · MOR (Fearless in yellow) · Can Charge · Mount · Equip/Weekly gp; weapon list (name, `[2H]`, atk, dice, healing, attacks, magic dimension+shape); formations; and **all 6 save bonuses shown with signs (zeros/negatives included)**.
- 309 tests; `tsc --noEmit` clean.

## Scenario rename via card pencil icon (2026-08-11)
**Files:** `src/components/Lobby.tsx`

- Scenario cards owned by the current user show a **✏️ pencil** next to the name. Clicking opens a **Rename Scenario** modal (prefilled, Enter saves, Cancel/Save, inline error).
- `handleRename` reuses `updateScenarioField(scenarioId, { name })` (already live for GM free_move/room_open toggles — no RLS change) then `fetchScenarios()` so cards/search/aliases refresh.
- 309 tests; `tsc --noEmit` clean.

## Lobby: split DM tag / room badge + My Scenarios / Available filters (2026-08-11)
**Files:** `src/hooks/useScenarios.ts`, `src/components/Lobby.tsx`

- **Bug fixed**: the card's "Room Open/Closed" badge was driven by DM presence, conflating two states. Cards now show **two** tags: **DM Online/Offline** (live presence via `dmOnlineByScenario`) and **Room Open/Closed** (DB `room_open` — whether the DM closed the room to new players).
- **`useScenarios`**: new `myScenarioIds` (scenario IDs where the current user has a `scenario_participants` row, GM or player) — refetched when `currentUser`/`scenarios` change.
- **Lobby filters**: replaced the "Open rooms only" toggle with a segmented **My Scenarios / Available scenarios** control (default **My Scenarios**). My Scenarios keeps `myScenarioIds`; Available keeps `room_open = true` (DM presence not required — it's a find-a-room listing). A user with zero participation auto-falls back to the Available view so the lobby is never empty. Empty-state copy updates per view.
- 309 tests; `tsc --noEmit` clean.

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

---

## Routed Retreat & Pursuit (ScenarioMap)

- `src/lib/routedRetreat.ts` � pure retreat/pursuit rules: legal adjacent retreat hexes (unoccupied, out of enemy ZOC), 2-hex rout-through only through friendly Open Order/Scattered, **routed units never yield** and ordered ranks block, Open-Order-through disrupts that friendly to Scattered, `retreatDiagnosis` reasons, `choosePursuer` (faster than Routed speed **and** able to pay; attacker ? fastest ? most MP ? random).
- `src/components/ScenarioMap/ScenarioMap.tsx` � `routFlowRef` orchestrator reacts to live ROUT rows: opens the retreat modal (always, even with zero options); option hover highlights the hex on the map; draggable card; chained MOVE/FORMATION/pursuit commands. Geometry is resolved at the pursuer's post-follow hex so melee never misfires as "long range".
- Pursuit is **mandatory and cannot be declined**: the pursuer attacks the **disrupted friendly** when the rout-through scattered one, the routed unit on a 1-hex rout, and **no attack** when the rout only passed through a Scattered friendly (occupied hex). No legal rout ? attacker makes a labeled **FREE pursue attack** (no speed/MP gate, org -1 still applies).
- `routeUnit.ts` carries the cause (`payload.cause`) so the attacker is preferred as pursuer.
- Docs: `.scratch/routed-retreat/spec.md`, HANDBOOK �7.5.
