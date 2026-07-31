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
- **Helpers:** `src/lib/turnState.ts` — `ALLIANCE_ORDER`, `getActiveGroups(alliances)`, `advanceTurn(current, activeGroups) → { next, wrapped }` (pure, tested in `turnState.test.ts`: 13 cases).

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
| `src/components/UnitEditor.tsx` | "Ignore morale checks (fearless)" checkbox; `ignoreMoraleChecks` default in blank template |
| `supabase/migrations/013_turn_tracking.sql` | New migration: `scenarios.current_turn_alliance` (CHECK), `scenarios.turn_number` default 0 |
| `src/lib/turnState.ts` | New pure module: `ALLIANCE_ORDER`, `getActiveGroups`, `advanceTurn` |
| `src/lib/turnState.test.ts` | New tests for active-group derivation + advance/skip/wrap |
| `src/types/gameProtocol.ts` | `Scenario.currentTurnAlliance: AllianceGroup \| null`, `Scenario.turnNumber: number` |
| `src/hooks/useScenarios.ts` | `mapScenario` maps the two new fields; new `updateScenarioField(scenarioId, fields)` |
| `src/game/GameEngine.ts` | `ActionType` += `'END_TURN'`, `'SCENARIO'` |
| `src/hooks/useGameEngine.ts` | `updateScenarioField` prop; `SCENARIO` branch in execute/undo/redo; new `endTurn()` building the atomic command |
| `src/components/ScenarioMap/ScenarioMap.tsx` | Scenario turn fetch + realtime subscription; `currentTurnAlliance`/`turnNumber` state replace local `turn`; alliance-colored End Turn button visible to all; scatter seed uses persisted turn number |

## Pending
- Migration 013 (`turn_tracking`) — **written, needs `supabase db push`/manual apply**
- Migrations 010 (`attached_position`), 011 (`Hero` formation), and 012 (`ignore_morale_checks`) — user applied all three to the DB
- `UnitEditor.tsx`: `isHero` toggle should force `'Hero'` formation / disable other formation checkboxes — **postponed** until the consolidated interface update
- Movement & action tracking — End Turn + turn counter implemented; still open from `.scratch/movement-actions-tracking/spec.md`: MP/action deduction in `MOVE`/`ROTATE`/`FORMATION`/`ATTACH_HERO`/`DETACH_HERO`/`ATTACK` sub-steps, `computeMoveCost` pure function extraction, drag-overlay `maxMP` clamp to remaining MP, tooltip `Actions: n/2`, `actionsAvailable` default → 2 at spawn
