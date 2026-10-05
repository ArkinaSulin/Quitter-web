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
| Cube neighbour directions (`HEX_DIRS`) | `src/lib/hexGeometry.ts` | The one array; `mapGeometry` re-exports it. |
| Direction index / front & rear hex-arc | `src/lib/hexGeometry.ts` → `hexDirIndex`, `frontArcIndices`, `rearArcIndices` | `(facing+4)%6, (facing+5)%6` lives here only. |
| Arc of a target (adjacency) `front/flank/rear` | `src/lib/hexGeometry.ts` → `arcOf` | `unitCombat.determineCombatPosition` and the old `unitMorale.facingArc` are thin wrappers over it. |
| Arc of a target (bearing, any range) | `src/lib/attackDirection.ts` → `arcOfTarget` | Ranged counterpart; equals `arcOf` for adjacency. |
| Team → alliance group | `src/lib/alliances.ts` → `allianceOf(team, alliances)` | Defaults to `'friendly'`. |
| Hostility between two teams | `src/lib/alliances.ts` → `isHostile` / `sameAlliance` | Every cross-group pair is hostile; same-group (incl. neutral↔neutral) is not. |
| Actually airborne | `src/lib/flying.ts` → `isAirborne(elevation, surface)` | `elevation > surfaceAt(hex)` — a fly-capable garrison on a structure is grounded. |
| Vertical gap ≤ 10 ft | `src/lib/flying.ts` → `withinVerticalGap`, `verticalGapDown` | Melee reach / same-column domination. |

## Rules (canonical predicate + consumers)

| Rule | Canonical home | Consumers |
|---|---|---|
| Formation matrix (melee/ranged/threat/stop/retaliate/charge arcs, modifiers) | `src/lib/formationRules.ts` (backed by `unit_formations` rows) | combat, morale, movement, AI, editors. |
| Attack arcs (melee front-2 / all-around; ranged; structure) | `canMeleeTarget`/`canRangedTarget` (`formationRules`) + `unitCombat`/`wallCombat`/`structureCombat` | `useCombatActions`, overlay. |
| Kill zone / ZoC (unified) | `src/lib/unitMorale.ts` → `isInKillZone` | `computeThreatHexes` (mapGeometry), `imposesZocOn` (zocDisengage), `meleeFallback`, `useCombatActions`. |
| Threat reach (heroes) | `src/lib/unitMorale.ts` → `heroThreatAgainst` | `calcEnemyThreats`. |
| Rear-threat ×2 | `getThreatMode` (`formationRules`) via `calcEnemyThreats` | tooltip, morale checks. |
| Charge / Stoop stance | `src/lib/chargeStance.ts` → `chargeStanceFor` | `ContextMenu`. |
| Vertical flyer dominance | `isInKillZone` + `computeThreatHexes` (with `isAirborne`/`verticalGapDown`) | overlay, pursue, retreat, combat. |

## Known remaining duplication (backlog)

- **ZoC shape (slice 4)**: `isInKillZone` (unitMorale), `computeThreatHexes`
  (mapGeometry) and `imposesZocOn` (zocDisengage) still each assemble the
  front-2 + vertical + exclusion set. Goal: one `killZoneHexes(unit, opts)` the
  other two consume.
- **Charge/Stoop (slice 5)**: `chargeStanceFor` and `isStooping` overlap on the
  airborne check; fold `isStooping` onto the shared `isAirborne`.
- **`enemyAI/planner.allianceOf`** is now a wrapper over `alliances.allianceOf`.

## Adding a universal rule

1. Put the primitive/rule in its home module above (pure, tested).
2. Replace every inline re-derivation with an import.
3. Add a row to this table.
4. Cite it from the relevant chapter (`07` movement, `08` combat, `09` morale)
   and the player manual.
