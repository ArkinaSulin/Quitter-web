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
- ✅ **Unit Effects… dialog reads the library** (`map_effect_templates`), so composites
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
  door-first attacks via **Shift + drop** (`combat/structureCombat.ts`), scenario
  hex rendering (black outline/art/HP/door badges), and hex/edge **info tooltips**
  + Shift-held inspect mode (`MapInfoTooltip`).
- ✅ **Range + gates**: reusable `range` effect modifier (watch-tower / zone reach
  +/-), consumed by attacks + reactions; gate **open/close** (open = no extra
  entry MP, door bypassed).
- ⏳ Only gap: the AI planner ignores structure auras / range / gates (v1).

## Structure elevation (Phase 2b, migrations 111–112)
Shipped (slices 7a–7c). See `docs/dev/changelog.md` and `18-map-structures.md`.
- ✅ **Data**: `map_structure_templates.elevation` (default 10; 0 = decorative);
  `map_effect_templates.elevation`; `units.climb_to`. Editors (Structure Editor,
  placed `StructureEditModal`, Effect Editor/modal) expose elevation. The
  `ignore_climb` effect modifier (unit/zone/edge) replaces the old `stairs`
  boolean (retired in migration 113).
- ✅ **Dynamic ground + occupancy**: `structureSurfaceAt`; `movePoolMode`/`moveBudgetUnit`
  take a surface; `computeOccupiedHexes(units, excludeId, surface=0)` is per-surface.
- ✅ **Climb / hang**: `climbPlan` (10 ft @ 4 MP, `height/2.5`), `climb_to`;
  `ignore_climb` waives climb; `feather_fall` ignores fall damage; mounted can't
  climb; linear movement (up = target / down = own hex);
  hover +10 ft if the origin ground is occupied; no retaliation; attack/ZoC only at
  the wall top; rout = free-fall (d6/10 ft) + standard rout picker.
- ✅ **Flight blocking / ranged vertical / offsets / badges / stair graphic**.
- ⏳ **Follow-ups**:
  - The charge-disable gate (`makeChargeBlockedEdge`) does not fold in the climb
    cost — a climb of 2+ MP should disable charge per the "any 2+ MP crossing"
    rule.
  - `useCastActions` magic-rout of a climbing unit defaults the free-fall to
    **ground** (it lacks `structures`); pass the origin surface so a platform-origin
    climber falls to the platform, not 0.
  - ✅ **Voluntary descent UI shipped**: dropping a unit on an **adjacent lower**
    surface opens a **Climb down / Drop / Cancel** modal (`pendingDescent`,
    `confirmDescentClimb`/`confirmDescentDrop`). Climb down = 4 MP/10 ft (hangs
    midway if short; stairs free; mounted barred); Drop = `floor(ft/10)`d6 fall
    (`feather_fall` negates; refused on an occupied hex); both provoke archer
    reactions, pursue self-gated on a raised origin. Elevation changes only across
    an adjacent edge — a non-adjacent move ending on a different surface is refused.
  - **ZoC "only at the wall top"**: currently a climbing unit exerts ZoC only
    against movers at its exact elevation (the 2b-6 rule); the explicit
    wall-top gate wasn't added separately — verify in play it reads correctly.
  - **Enemy AI** ignores elevation / climb / flight-blocking entirely (v1), same as
    structure auras.

## Edge walls (migration 089) — unified into map structures
- ✅ **Edge walls are authored as structures** (see "Map structures"): the runtime
  `Walls` map is derived from edge structure instances, `map_data.walls` is no
  longer written, and destruction rides a per-key `STRUCTURE` command sub-step.
- ✅ **Movement + combat**: a face replaces terrain / blocks
  (`computeReachableMap`) and grants melee/ranged AC (`primitives/hexLine` entering edge).
- ✅ **Destructible segments**: `maxHp`/`hp`/`dt`; **Shift + drop** a unit on the
  edge to attack it (no to-hit roll, DT gates; 1 action + attack cap).

## Zone of control, pursue & Withdraw (migration 090)
- ✅ **Any** exit from a hostile kill zone scatters a formed non-hero mover and
  provokes **one** aggression-gated pursue; moves that don't leave a ZoC do
  nothing. Pursuer order attacker → most MaxMP → most avail MP → random; a failed
  `d10 ≤ AGR` does not move and yields to the next candidate; the selected
  pursuer always attacks (single AGR — no combat re-roll). `src/packages/morale/lib/pursuit.ts`.
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
- 🔜 `src/packages/ships/lib/shipMoveCost.ts`, `shipCombat.ts`, `src/hooks/useShipEngine.ts`.
- 🔜 Scenario instance table `ship_spelljammer` (schema exists in migration 066)
  + ship tokens on the scenario map.
- 🔜 `src/components/ScenarioMap/ShipPanel.tsx` (stations, crew reserve, info war).
- 🔜 Sub-turn toggle (5 segments / 1 action per hero), `environment`
  (Space/Atmosphere), `firing_arcs` scenario settings.
- 🔜 Captain's Command (officer actions), repairs/loading counters, Overthrust,
  hit-box damage resolution, Jettison/space mines.
- Out of scope by decision: **boarding** (hand off to a D&D VTT).

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
  **090** (ZoC pursue + Withdraw), **091** (front-only ranged arc), **092** (wall
  command-log branch), **093–095** (map structures) — owner-confirmed. The former
  hand-applied `apply_substeps` array-write fix is folded into migration **080**.
- ✅ Applied (owner-confirmed, Phase 2 aerial/elevation): **108** (elevation/fly),
  **109** (template fly speed), **110** (`fly_speed_available` numeric), **111**
  (structure/effect elevation).
- 🔜 **Awaiting apply**: **096** (structure `spikes` + "Archer's Stake" rename),
  **097** (`structure_images` bucket), **112** (`units.climb_to` — Phase 2b-7).

## Uncommitted working tree (owner's, left untouched)
- `.scratch/ship-builder/spec.md`, `.scratch/shipyard-formula/{FINDINGS.md,shipyard.csv}`,
  `.scratch/spelljammer-mod/spec.md`, `src/packages/ships/lib/shipStats.ts`,
  `supabase/migrations/067_ship_seed.sql`.
