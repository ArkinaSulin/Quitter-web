# 00 — Universal rules & canonical homes

Every "universal" rule (one that governs combat, movement, morale and the UI
alike) should have **one** code location that everyone imports. This chapter is
the map from rule → canonical home, so a new feature changes a rule in place
instead of re-deriving it.

> If you find the same primitive implemented twice, prefer deleting the copy and
> importing the canonical one. The low-level primitives listed first are the
> building blocks for the higher-level rules.

## Low-level primitives (single source)

| Primitive | Home | Notes |
|---|---|---|
| Cube neighbour directions (`HEX_DIRS`) | `src/packages/primitives/lib/hexGeometry.ts` | The one array; `world/mapGeometry` re-exports it. |
| Direction index / front & rear hex-arc | `src/packages/primitives/lib/hexGeometry.ts` → `hexDirIndex`, `frontArcIndices`, `rearArcIndices` | `(facing+4)%6, (facing+5)%6` lives here only. |
| Facing vertex + rotation | `src/packages/primitives/lib/hexGeometry.ts` → `frontVertex`, `rearVertex`, `rotateLeft`, `rotateRight` | Hero layout, turn generation, AI. |
| Arc of a target (adjacency) `front/flank/rear` | `src/packages/primitives/lib/hexGeometry.ts` → `arcOf` | `combat/unitCombat.determineCombatPosition` and the old `morale/unitMorale.facingArc` are thin wrappers over it. |
| Arc of a target (bearing, any range) | `src/packages/primitives/lib/attackDirection.ts` → `arcOfTarget` | Ranged counterpart; equals `arcOf` for adjacency. |
| Team → alliance group | `src/packages/primitives/lib/alliances.ts` → `allianceOf(team, alliances)` | Defaults to `'friendly'`. |
| Hostility between two teams | `src/packages/primitives/lib/alliances.ts` → `isHostile` / `sameAlliance` | Every cross-group pair is hostile; same-group (incl. neutral↔neutral) is not. |
| Looseness | `src/packages/movement/lib/formationRules.ts` → `isLooseFormation`, `isLooseUnit` | Scattered/Routed/Hero — move any direction, no org. |
| Actually airborne | `src/packages/movement/lib/flying.ts` → `isAirborne(elevation, surface)` | `elevation > surfaceAt(hex)` — a fly-capable garrison on a structure is grounded. Consumers pass `structureSurfaceAt(hex)` (move/rotate/formation pool, kill zone, overlay). |
| Vertical gap ≤ 10 ft | `src/packages/movement/lib/flying.ts` → `withinVerticalGap`, `verticalGapDown` | Melee reach / same-column domination. |
| Melee reach | `src/packages/combat/lib/meleeFallback.ts` → `isMeleeReachable` | Horizontal adjacency AND ≤10 ft vertical. |
| **Damage / d20 / min-1** | `src/packages/primitives/lib/damage.ts` → `rollDamageDetailed`, `rollD20`, `clampDamage`, `rollAppliedDamage`, `MIN_DAMAGE` | **The one damage parser.** Every path (weapon, magic, walls, structures, effects, entry, fall) rolls and clamps here. A **landed** amount is never < 1 and never > cap; a save **negate** is the only 0, a half-save still lands ≥1. `combat/unitCombat` re-exports for compat. |
| **Fly pool vs ground MP** | `src/packages/movement/lib/flying.ts` → `usesFlyPool(unit, surface)` (`isAirborne && canFly`), `movePoolMode` | Rotate / formation / move pool selection (context menu labels too). An elevated **non-flyer** (climber) stays on ground MP. |

## Rules (canonical predicate + consumers)

| Rule | Canonical home | Consumers |
|---|---|---|
| Formation matrix (melee/ranged/threat/stop/retaliate/charge arcs, modifiers) | `src/packages/movement/lib/formationRules.ts` (backed by `unit_formations` rows) | combat, morale, movement, AI, editors. |
| Attack arcs (melee front-2 / all-around; ranged; structure) | `canMeleeTarget`/`canRangedTarget` (`movement/formationRules`) + `combat/unitCombat`/`combat/wallCombat`/`combat/structureCombat` | `useCombatActions`, overlay. |
| Kill zone / ZoC (unified) | `src/packages/morale/lib/unitMorale.ts` → `imposesKillZone` (the one predicate) | `isInKillZone` (morale/point-blank/AGR), `computeThreatHexes` (overlay), `imposesZocOn` (disengage), `combat/meleeFallback`, `useCombatActions`. |
| Threat reach (heroes) | `src/packages/morale/lib/unitMorale.ts` → `heroThreatAgainst` | `calcEnemyThreats`. |
| Rear-threat ×2 | `getThreatMode` (`movement/formationRules`) via `calcEnemyThreats` | tooltip, morale checks. |
| Charge / Stoop | `src/packages/combat/lib/chargeStance.ts` → `chargeStanceFor` (declare) + `isStooping` (declared) | `ContextMenu`, `useCombatActions`, `useOverlay`. |
| Vertical flyer dominance | `imposesKillZone` + `computeThreatHexes` (with `isAirborne`/`verticalGapDown`) | overlay, pursue, retreat, combat. |

## Consolidation status

The primitives and rules above are single-source. The previously duplicated
shapes have been folded in:

- **ZoC/kill zone** — `imposesKillZone` (`KillZoneQuery` with `ownSurface`,
  `exclude`, `requireFormed`) is the one predicate; `isInKillZone`,
  `computeThreatHexes` and `imposesZocOn` all call it (no more per-caller
  front-2/vertical/exclusion assembly).
- **Charge/Stoop** — both halves live in `combat/chargeStance.ts`;
  `isStooping` builds on the shared `isAirborne`.
- **`ai/planner.allianceOf`** is a wrapper over `primitives/alliances.allianceOf`.

## Package boundaries (enforced)

Since the deep-module migration everything under `src/packages` lives in
`src/packages/<domain>/` (entry point `index.ts`, implementation `lib/`, tests
`tests/`). The boundary rules are **machine-checked** by dependency-cruiser
(`npm run lint:boundaries`, part of `npm run check`):

- app / `src/components` / `src/hooks` → a package **entry point** only.
- a package → its own `lib/` freely; **other** packages via their entry points.
- packages must never import the app/UI layer.
- `src/types` is a leaf. **Cycles are a warning** (the rules are cross-cutting).
- A second guardrail, `src/rules.test.ts`, asserts that a universal primitive has
  exactly one implementation (d20, the fly-pool composition, damage clamps).

See `src/packages/README.md` for the layout and how to add a package.

## Code vs data

A "rule" has one of two homes, by nature:

- **Code predicate** (pure, tested) — e.g. `imposesKillZone`, `arcOf`,
  `clampDamage`, `usesFlyPool`. Lives in a package `lib/` and is imported.
- **Data** — e.g. the `unit_formations` matrix, `infra/settingsCache` values
  (`formation_change_cost_per_step`, `about_turn_cost_*`). Lives in the DB / a
  settings table and is *read* by code; tune it there, not in a constant.

Prefer code for logic and data for tuning numbers; never duplicate a data-driven
rule into a second inline table.

## Adding a universal rule

1. Put the primitive/rule in its home module above (pure, tested).
2. Replace every inline re-derivation with an import.
3. Add a row to this table (and, if a hand-written primitive, a case to
   `src/rules.test.ts`).
4. Cite it from the relevant chapter (`07` movement, `08` combat, `09` morale)
   and the player manual.
5. Run `npm run check` (typecheck + tests + boundaries + build).
