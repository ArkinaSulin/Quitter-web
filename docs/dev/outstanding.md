# Outstanding Features & Backlog

Living roadmap of what is **not built yet**, for the next session. Shipped work
goes in `docs/dev/changelog.md`; this file is the forward-looking list.
Statuses: next / later / blocked / done-here-listed-for-context.

## Recently shipped (2026-10-24)
- Charge/swoop: 1+ action gate, later-action declaration, action -> full pool
  conversion, free attack, AGR-failure end/drop, no air swoop. Swoop doubles
  damage like a charge.
- Mounted AI: outer-rim marks, 5/3 friendly-kill-zone safety (target excluded),
  closest valid charge-start points (start need not be rear), multi-turn routing,
  rear-only final-front-arc charges, hold only at a valid start, no normal melee
  fallback.
- Flying AI: airborne target priority; ranged at max/current range, otherwise
  paid melee; no air charge/swoop; pursues air targets instead of ground;
  flying marks prefer airborne.
- Off-grid tokens (option 2): moves/withdraw/rout may leave the grid; non-DM
  players and AI cannot control off-grid tokens, and off-grid tokens cannot be
  targeted or attack. DM/effective GM is exempt for recovery. AI may plan a move
  to off-grid, then the unit drops out of eligibility.
- Advanced AI/Stance removed/cancelled; Basic is the only planner. Manual
  one-charge-per-activation was scrapped (AI still plots one).
- AI roster: stacked ground/air units independently toggleable.

## Halloween Siege (migration 133)
**Status (2026-10-26): shipped for current scope.** DM wave config, weighted
Enemy-turn spawns at the grid rim, between-wave break turns, public wave/turn
badge, arm/cancel, completion toast, and the End Turn guard when no Enemy team
exists. Spawns are non-atomic/not fully undoable; see `20-halloween-siege.md`.
- later: make wave spawns atomic (server-side INSERT in `apply_substeps`) so the
  whole wave is one undoable command and `lastSpawnedTurn` rides the log.
- later: optional "Spawn current wave now" recovery after a failed/undone spawn.
- later: allow neutral-alliance monsters if/when the AI planner targets neutral.

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
  UI/tooltips show `attack roll`. `combat/unitCombat.combatRollMode`.
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
- ✅ **Climb / hang**: `climbPlan` (`steps × mp_*` MP per 10 ft, uniform for hex +
  edge; `mp_*` default 4, `0` = free), `climb_to`; a mover's own `ignore_climb`
  effect waives climb; `feather_fall` ignores fall damage; mounted can't
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
    `confirmDescentClimb`/`confirmDescentDrop`). Climb down = `steps × mp_*` MP (hangs
    midway if short; a `0` mp_* = free; mounted barred); Drop = `floor(ft/10)`d6 fall
    (`feather_fall` negates; refused on an occupied hex); both provoke archer
    reactions, pursue self-gated on a raised origin. Elevation changes only across
    an adjacent edge — a non-adjacent move ending on a different surface is refused.
  - **ZoC "only at the wall top"**: currently a climbing unit exerts ZoC only
    against movers at its exact elevation (the 2b-6 rule); the explicit
    wall-top gate wasn't added separately — verify in play it reads correctly.
  - **Enemy AI** now climbs structure tops, holds walls, flies (swoop/air
    superiority) and air-fights; some elevation/flight-blocking nuances remain
    to verify in play.

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

## AI assist � current scope complete

**Status (2026-10-26):** Basic AI is the only planner; Advanced AI/stance is
cancelled. Source of truth: `docs/dev/17-enemy-ai.md`,
`src/packages/ai/lib/{planner,board,marks,types}.ts`.

- Shipped: Preview/Execute, per-unit opt-out, undo macro, one-shot worker;
  melee/ranged/flying/mounted doctrines; independent marks; formation priority;
  safe destinations/ZoC facing; multiple actions per activation; ranged posture;
  mounted charges and air swoops; air superiority; structure-top/takeover and
  wall crossings; off-grid handling.
- Shipped (recent): whole-activation climb objectives, session-only top +
  base/crossing route lock, redundant structure-edge wall pathing, wall-stat
  climb profile, rout <=2 MP per entered hex, one friendly pass-through, and no
  voluntary AI drop.
- The preview overlay (routes, marks, `T` vacant-top objectives) is local to the
  AI client; it is not broadcast or persisted.
- **Known limitation:** parked real-map oscillation - Gnoll AO can still pace
  between `(6,-4)` and `(7,-4)` while holding a valid `(4,-4)` objective.
- Remaining follow-ups (not blockers): archers/artillery refinements; AI
  magic/reactions/hero attach; ZoC scatter/pursue; some elevation nuances;
  per-team doctrine toggles. AI still never controls heroes or hero-hosted
  units.

## Spelljammer module (largest remaining)
**Mass-first overhaul shipped** (migration 134, applied): no ship frames, hull
mass = `totalMass × (10% + totalMass/500)`, armor as % of total, acceleration
and MC from the new rules, whole-ton rounding, binary per-ton hit boxes.
**Ship Editor v2** is built: summary + composition table, ship image upload,
square component-slot layout, weapon capacity budget, atmospheric speed,
damage threshold, catalog AC/images. **Component Workshop** is built:
two-tab editor over Components/Weapons, UUID/name catalogs, optional components,
weapon mass, min/range/max range, fire-cycle steps, and the `max_range = 1`
Ram slot filter. **Migrations 135–139 are pending apply.**

The five reference templates (Racer, Shuttle, Wasp, Damselfly, Star Moth) are
locked in `shipStats.test.ts`.

**Engine not started:**
- 🔜 `src/packages/ships/lib/shipMoveCost.ts`, `shipCombat.ts`, `src/hooks/useShipEngine.ts`.
- 🔜 Scenario instance table `ship_spelljammer` (schema exists in migration 066)
  + ship tokens on the scenario map.
- 🔜 `src/components/ScenarioMap/ShipPanel.tsx` (stations, crew reserve, info war).
- 🔜 Sub-turn toggle (5 segments / 1 action per hero) + `firing_arcs` scenario settings.
- 🔜 Reinforcement **target assignment** in the editor (+10 temp HP to one weapon
  or component cluster) — the count is modelled, the target picker is not.
- 🔜 Command Bridge bonus wiring, repairs/loading counters, hit-box destruction
  resolution, Jettison/space mines.
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
- 🔜 Still to document: **statistics** and **corpses**.
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
- ✅ Applied (owner-confirmed, AI assist): **130** (legacy
  `ai_assist_advanced` / `ai_assist_players`; Advanced AI is cancelled).
- ?? **Awaiting apply**: **132** (drops the old `ai_role_markers` column), **096** (structure `spikes` + "Archer's Stake" rename),
  **097** (`structure_images` bucket), **112** (`units.climb_to` — Phase 2b-7), **135**
  (ship `crew_quarters` + `passengers`), **136** (ship editor v2 fields + `ship_images`),
  **137** (ship catalog UUID/name), **138** (Component Workshop fields/access),
  **139** (merge accessories into components).

## Uncommitted working tree (owner's, left untouched)
- Last checked 2026-10-27 after the mass-first ship overhaul. The old v8.1
  design files were deleted intentionally (`.scratch/shipyard-formula/`,
  `.scratch/ship-builder/spec.md`, `.scratch/spelljammer-mod/spec.md`).
  Owner-dirty files remain: `.scratch/screen-capture/` (untracked), plus
  unrelated edits in `src/components/shared/mapFeatureDraw.ts`,
  `src/packages/infra/lib/templateMappers.ts`,
  `src/packages/movement/tests/moveCost.test.ts`, and
  `src/packages/units/lib/tokenUtils.ts`. Do not stage these with AI work.
