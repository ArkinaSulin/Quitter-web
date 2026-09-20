# Outstanding Features & Backlog

Living roadmap of what is **not built yet**, for the next session. Shipped work
goes in `docs/dev/changelog.md`; this file is the forward-looking list.
Statuses: 🔜 next / ⏳ later / 🚧 blocked / ✅ done-here-listed-for-context.

## Effects engine
- ✅ Zone **entry** damage, zone **mp_cost**, **dice** amounts (`XdY±Z`; X=0 flat),
  **healing** flag, per-troop **saves** (stat/DC/half-or-negate), **per-troop HP cap**.
- ✅ Entry-zone **"How many troops are caught?"** prompt.
- ✅ Interactable zones: right-click empty hex → **Effects at hex** (Move up/down,
  **Drop Effect**), tempo anchor = alliance active at drop.
- ✅ **Effect images + layer bands**: `imageUrl`/`layer` (below/above unit token)
  rendered on the map; "above" hides while the unit on its hex is hovered.
- ✅ **Zones ride the command log** (migration 080 `ZONE` branch): paint/drop/edit/
  clone/order/drop + END_TURN ticks are undoable and replay. Stat-zone membership
  reconciles on move (`computeZoneReconcile`), not just at activation start.
- ✅ **Unit Effects… dialog reads the library** (`effect_templates`), so composites
  / Sleep / zone templates apply from the context menu too.
- ✅ **Attack-roll flag effects** (`advantage` / `disadvantage` / `grant_advantage`
  / `grant_disadvantage`): boolean markers read at attack resolution; any advantage
  cancels any disadvantage (count irrelevant). Library seed = migration **088**;
  UI/tooltips show `attack roll`. `src/lib/unitCombat.combatRollMode`.
- ✅ **Messages record both variants**: every `GameMessage` carries the plain
  `text` plus an always-recorded `verboseText` (dice/roll detail); the scenario
  verbose setting only picks which is **displayed**, so toggling it re-renders the
  whole history. Broadcast carries both (`useMessageSync`).
- ⏳ **Composite instance semantics**: the original design was "one instance
  carries `modifiers[]`". Today a composite template is **expanded into one
  primitive effect per kind** on apply. Consider consolidating to a single
  instance (removal/stacking by template) — behavioral decision needed.

## Map structures (migration 093)
Template library + editor shipped (Slice 1). See `18-map-structures.md`.
- ✅ **Slice 1**: `map_structure_templates` (edge/hex, inside/outside faces,
  battlement, door HP, 30/15 defaults), Structure Editor (`/structure-editor`),
  caps/RLS, seeds, and the reusable **`enter_org_max`** effect kind.
- ✅ **Slice 2**: `maps.structures` (migration 094, `maps.walls` dropped) + Map
  Editor **Structures** tab (template palette, edge/hex painting, click-again
  battlement flip, HP/DT/door overrides), `MapCanvas` edge + hex rendering, and
  assign-time `structuresToWalls` derivation into the runtime `walls`.
- ✅ **Slice 3**: scenario-native structures — `map_data.structures` as the source
  of truth, per-key `STRUCTURE` command sub-steps (migration 095), in-scenario
  `StructurePaintPanel`, edge-structure attacks via `STRUCTURE`; runtime `walls`
  derived from structures (legacy `map_data.walls` no longer written).
- ✅ **Slice 3b**: `enter_org_max` is consumed by player movement (structures on
  the crossed edge / destination hex, or a ground zone there, gate over-level
  movers) via `makeBlockedEdge(walls, { structures, templates, zones, orgLevel })`;
  wired through drag-move, the drag overlay and reaction repositioning. AI ignores
  it for v1.
- ✅ **Slice 4**: hex structures — tower auras (occupancy flags merged into combat),
  door-first attacks via a drop **target-picker** (`structureCombat.ts`), scenario
  hex rendering (tint/art/HP/door badges). Structure **range bonuses** and gate
  open/close state remain deferred; AI ignores structure rules (v1).

## Edge walls (migration 089)
- ✅ **Phase 1 shipped**: edge `maps.walls` keyed `"q,r,dir"`, a face per side
  (`moveCost` replaces terrain / `block` / `meleeAc` / `rangedAc`). Map Editor
  **Walls** tab + in-scenario `WallPaintPanel`; movement replace/block
  (`computeReachableMap`), combat AC (`hexLine` entering edge); snapshotted into
  `scenarios.map_data.walls`.
- ✅ **Phase 2 shipped** (migration **092**): per-segment `maxHp`/`hp`/`dt`
  destructibility. Drag a unit onto the edge to attack it (melee on either edge
  hex, else ranged by weapon max range; `wallCombat.ts`); no to-hit roll — the
  DT gates the damage; 1 action + attack cap; destruction rides a `WALL`
  command-log sub-step so undo/replay restore HP.
- 🔜 **Phase 3**: temporary (magic) wall effects with a caster/duration, ticking
  at END_TURN like ground zones; generalize HP/DT to all effects (destructible
  ground zones).

## Zone of control, pursue & Withdraw (migration 090)
- ✅ **Any** exit from a hostile kill zone scatters a formed non-hero mover and
  provokes **one** aggression-gated pursue; moves that don't leave a ZoC do
  nothing. Pursuer order attacker → most MaxMP → most avail MP → random; a failed
  `d10 ≤ AGR` does not move and yields to the next candidate; the selected
  pursuer always attacks (single AGR — no combat re-roll). `src/lib/pursuit.ts`.
- ✅ **Hero Command-Presence leash** (`command_pursuit_permit`, default **hold**;
  template + placed-unit editable) and the scenario toggle `zoc_pursuit_enabled`.
- ✅ **Withdraw**: drag a formed unit one hex into a rear hex (2 actions, keeps
  facing, never scatters/pursues; can't enter a ZoC; free under free-move).
- ⏳ Rout-modal/eventual AI handling of the new pursue (AI planner ignores it for v1).

## AI assist
- 🔜 **Full AI mode** (auto whole-turn director: watches turn, runs the plot,
  auto-answers rout/reaction prompts, auto End Turn) on top of the existing
  planner + Execute driver.
- ⏳ AI **charges / magic / reactions / hero attach** (v0 excludes them).
- ⏳ Difficulty knobs; per-team doctrine toggles (currently auto by weapon type).
- ✅ v0/v2 shipped: plotting, turns/formation, doctrines, stand-off, cheap
  flanking, routed flee-to-rim, per-unit opt-out.
- ✅ By design: AI **never** controls heroes or hero-hosted units.

## Spelljammer module (largest remaining)
Design closed (`.scratch/spelljammer-mod/spec.md`, `.scratch/ship-builder/spec.md`,
`.scratch/shipyard-formula/shipyard.csv`); **builder + stats + renderer shipped**,
**engine not started**:
- 🔜 `src/lib/shipMoveCost.ts`, `shipCombat.ts`, `src/hooks/useShipEngine.ts`.
- 🔜 Scenario instance table `spelljammer_ships` (schema exists in migration 066)
  + ship tokens on the scenario map.
- 🔜 `src/components/ScenarioMap/ShipPanel.tsx` (stations, crew reserve, info war).
- 🔜 Sub-turn toggle (5 segments / 1 action per hero), `environment`
  (Space/Atmosphere), `firing_arcs` scenario settings.
- 🔜 Captain's Command (officer actions), repairs/loading counters, Overthrust,
  hit-box damage resolution, Jettison/space mines.
- Out of scope by decision: **boarding** (hand off to a D&D VTT).

## Access / players
- 🚧 **Player→Team assignment tab** — deferred pending the auth decision below.
  (The Players tab already sets roles/teams; decide if the dedicated tab is still wanted.)
- 🚧 **Auth/provider decision** (email/Google/Discord vs Discord-only) — affects
  which metadata key seeds `profiles.display_name`; blocks the tab above.

## Rules / housekeeping
- ⏳ `UnitEditor`: toggling **Hero** may force the `Hero` formation (postponed).
- ⏳ Troop soft caps per size category (Medium 80 / Large 20 / Huge 6) —
  enforcement style undecided.
- ⏳ **Replay**: animation smoothing (currently step-through states); co-watch
  attention pings (deferred).
- ⏳ localStorage/IndexedDB autosave/session migration (future).
- ⏳ Mobile responsiveness (low priority); TokenRenderer flicker debounce;
  Web Worker skeleton unused.

## Docs
- ✅ Refreshed dev chapters + player manual for the **effects** (dice/saves/entry/
  troop prompt, attack-roll flags), **pursuit/ZoC/Withdraw**, **walls**, and the
  message (verbose) model.
- 🔜 Still to document: **statistics**, **corpses**, and any remaining **AI assist**
  changes.
- 🔜 Player manual screenshot **S-33** (AI tab) + all S-01…S-32 images pending
  from the GM; then the Word/PDF export pass.

## Migrations
- ✅ Applied & verified: 068–080, plus **085** (formation AC split), **087**
  (opportunity rename), **088** (attack-roll effects), **089** (map walls),
  **090** (ZoC pursue + Withdraw) — owner-confirmed. The former hand-applied
  `apply_substeps` array-write fix is folded into migration **080**.
- 🔜 **Awaiting apply**: **091** (front-only ranged arc), **092** (wall
  command-log branch).

## Uncommitted working tree (owner's, left untouched)
- `.scratch/ship-builder/spec.md`, `.scratch/shipyard-formula/{FINDINGS.md,shipyard.csv}`,
  `.scratch/spelljammer-mod/spec.md`, `src/lib/shipStats.ts`,
  `supabase/migrations/067_ship_seed.sql`.
