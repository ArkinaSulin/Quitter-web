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
- 🔜 **Effect images + layer bands**: optional `imageUrl` per effect rendered on
  the map; bands **under tokens** (above terrain, below corpses/units) and
  **above tokens**; hover-lowering so a token under an effect can be inspected;
  Alt-cycling / "Effects at hex" ordering already exists for zones.
- ⏳ **Composite instance semantics**: the original design was "one instance
  carries `modifiers[]`". Today a composite template is **expanded into one
  primitive effect per kind** on apply. Consider consolidating to a single
  instance (removal/stacking by template) — behavioral decision needed.
- 🔜 Unit-effect (not just zone) images / on-map markers.
- ⏳ Remove path for **unit effects** is via the unit context **Effects…** modal;
  consider consolidating into the interactable-effects surface.

## AI assist
- 🔜 **Full AI mode** (auto whole-turn director: watches turn, runs the plot,
  auto-answers rout/reaction prompts, auto End Turn) on top of the existing
  planner + Execute driver.
- ⏳ AI **charges / magic / reactions / hero attach** (v0 excludes them).
- ⏳ Difficulty knobs; per-team doctrine toggles (currently auto by weapon type).
- ✅ v0/v2 shipped: plotting, turns/formation, doctrines, stand-off, cheap
  flanking, routed flee-to-rim, per-unit opt-out, verbose pursuit gates.
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
- 🔜 Refresh dev chapters + player manual for the **effects** (dice/saves/entry/
  troop prompt), **pursuit** (melee-only, adjacency, equal-speed, free attack),
  **statistics**, **corpses**, and **AI assist** changes.
- 🔜 Player manual screenshot **S-33** (AI tab) + all S-01…S-32 images pending
  from the GM; then the Word/PDF export pass.
- 🔜 `docs/dev/02` currently marks 068–077 applied (verified). Add/record the
  **`apply_substeps` array fix** (delivered as SQL, option "1") as a proper
  migration file (`078_...`) for repo history if desired.

## Migrations
- ✅ Applied & verified: 068–077.
- ⚠️ The **`apply_substeps` array-write fix** (formation_availability etc.) was
  handed over as pasted SQL, not a repo migration. Confirm it ran; if any DB
  needs it again, re-paste. Consider committing `078_fix_apply_substeps_arrays.sql`.

## Uncommitted working tree (owner's, left untouched)
- `.scratch/ship-builder/spec.md`, `.scratch/shipyard-formula/{FINDINGS.md,shipyard.csv}`,
  `.scratch/spelljammer-mod/spec.md`, `src/lib/shipStats.ts`,
  `supabase/migrations/067_ship_seed.sql`.
