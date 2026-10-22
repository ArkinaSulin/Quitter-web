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
- 📌 **Current status (2026-10-21):** Pass 1 + 2a + 2b plus the post-playtest
  fixes are shipped through `a6469cc` (strict no-turn, defensive one-plan
  advance, battle roles, front-line-only pairing, fast flankers, ring-3 staging
  + facing, structure hold, ranged stand-off/reaction, reserve hold/intercept,
  rout re-evaluation + hostile-mass flee, last-action attack fallback). The
  reserve was then reworked into a whole-line reaction force: leading-rank
  frontage, rear-rank reserves at a central ~2-hex station, sector groups for
  long lines, Scattered waiting, surplus-only pairing (`enemyFront > ownFront +
  1`), forward-band-only targeting, flank/rear reaction, routing-hole patching,
  and cluster-cap exemption while reacting. Follow-up anti-idle pass: adjacent
  near-breakeven attacks (multi-action), nearest-reachable-enemy fallback when a
  lane is blocked, flankers retargeting/circling at ≥3 hexes and closing only
  after a start-of-plan frontage lock, whole-line pairing before reserves (short leading ranks promote rear units; true surplus stays reserve), and one-shot defensive attack-exposure facing. Migration 130 is
  applied; no
  migration was needed for these fixes. The AI
  package is the source of truth: `src/packages/ai/lib/{planner,battleLine,reserve}.ts`,
  `src/packages/ai/tests/planner.test.ts`, `src/components/ScenarioMap/AiPanel.tsx`;
  design in `docs/dev/17-enemy-ai.md`.
- **Next session:** playtest the latest role/staging/reserve behaviour, then the
  remaining rounds in order — **2a archers + artillery → 3 mounted charges → 4
  full coordination → 5 full auto-turn**. Known separate bug from playtest: the
  **turn counter** appeared to be broken/desynced; reproduce before changing
  turn advancement.
- 🔜 **Full AI mode** (auto whole-turn director: watches turn, runs the plot,
  auto-answers rout/reaction prompts, auto End Turn) on top of the existing
  planner + Execute driver.
- ✅ **Pass 2a** shipped: line-order target/lane assignment (order-independent),
  assigned-lane plan order, neutral hex-hash tie-break, leftover-MP movement
  with a scored hold, Aggressive/Defensive AI-tab stance, cohesion (1–2-hex line
  + 8-hex isolation) scaled by AGR. Test-85 red-line and yellow/black 6-vs-6
  regressions.
- ✅ **Pass 2b** shipped: aggressive advance low-AC/isolated target priority +
  non-lethal melee-lock avoidance; defensive safety weighting and ranged ZoC
  avoidance; defensive ranged formation posture (Close far/no fire → Open/
  Scattered under fire → Scattered before melee); defensive cluster speed capped
  to the slowest member (slowest planned first). Charges remain Round 3.
- 🔜 **Round 2a — archers + artillery**: LOS/indirect-shot polish, focus fire,
  and the war-machine slice (AI-only immobility while operating, fixed facing,
  `expectedWarMachineDamage`, `bombard` steps that pause for marker placement;
  routed crew flees normally, the weapon structure stays).
- ⏳ **Round 3 mounted charges**, then AI magic / reactions / hero attach.
- ⏳ Per-team doctrine toggles (currently auto by weapon type).
- ⏳ Advanced formation changes **Phase 2**: anticipate ranged damage and allow
  higher-AC changes outside a ZoC.
- ⏳ AI still ignores **flight** and some elevation/climb nuances (structures and
  per-surface occupancy now feed the planner).
- ✅ **Pass 1** (safety/coherence): multi-maneuver one-pool movement (mounted
  move/turn/charge path allowed), no generic contact tax, no-attack turn
  surcharge, conditional target exclusion, line-bearing penalty at any distance,
  per-unit step budget; test-85 red-line regression.
- ✅ Basic/Advanced flag + player access flag (migration 130); both brains have
  self-preservation (own flank/rear exposure, path bypass, turn economy) and
  formation-aware retaliation; Advanced adds trade/overkill value and ZoC-
  triggered formation changes.
- ✅ v0/v2/v3 shipped: plotting, turns/formation, doctrines, stand-off, cheap
  flanking, routed flee-to-rim, per-unit opt-out, real map context, darkvision fog.
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
- ✅ Applied (owner-confirmed, AI assist): **130** (`ai_assist_advanced` /
  `ai_assist_players`).
- 🔜 **Awaiting apply**: **096** (structure `spikes` + "Archer's Stake" rename),
  **097** (`structure_images` bucket), **112** (`units.climb_to` — Phase 2b-7).

## Uncommitted working tree (owner's, left untouched)
- Last checked 2026-10-18 after the AI commits (`009a6b1`, `f4e3695`): the AI
  code/tests/docs are clean and pushed. Owner-dirty files remain:
  `.scratch/ship-builder/spec.md`,
  `.scratch/shipyard-formula/{FINDINGS.md,shipyard.csv}`,
  `.scratch/spelljammer-mod/spec.md`,
  `.scratch/screen-capture/` (untracked), plus unrelated edits in
  `src/components/shared/mapFeatureDraw.ts`,
  `src/packages/infra/lib/templateMappers.ts`,
  `src/packages/movement/tests/moveCost.test.ts`, and
  `src/packages/units/lib/tokenUtils.ts`. Do not stage these with AI work.
