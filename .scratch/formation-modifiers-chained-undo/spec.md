Status: ready-for-agent

# Formation Modifiers & Chained Undo

## Problem Statement

The `formations` lookup table has four modifier columns (`ac_modifier`, `movement_modifier`, `attack_modifier`, `morale_modifier`) but none of them are read anywhere in gameplay logic. A unit in Shield Wall formation gets no AC bonus. A unit in Scattered formation gets no movement boost. The formation's contribution to effective morale (`morale_modifier`, added in a previous migration) is not factored into routing checks. The tooltip shows "AC = baseline + 0" because nothing ever modifies current AC.

Separately, the undo/redo system treats every action as an isolated entry. When a unit moves and its morale collapses causing a rout, the GM must undo twice (first rout, then move) to rewind the causal chain. There's no mechanism to link causally related actions together for batch undo while keeping them as distinct atomic entries in the command log.

## Solution

### Formation Modifiers

Four on-the-fly computations (never persisted) that apply formation modifiers to battlefield stats:

- **Effective AC** = `baselineAc + formation.ac_modifier`
- **Effective max movement** = `max(1, movementPoints + formation.movement_modifier)`
- **Effective attack bonus** = `weapon.attackBonus + formation.attack_modifier`
- **Effective morale** includes `formation.morale_modifier` as an additional term in the computed modifier (alongside wounds, isolation, enemy threats)

The tooltip shows each effective value with a breakdown (e.g. "AC 20 = 18 + 2 (Shield Wall)", "Move 3/5 (base 3, formation +2)").

### Chained Undo

A `chained` boolean column on `command_log` marks an entry as a direct consequence of the entry before it. The undo engine collects all consecutive `chained=true` entries plus their root cause (`chained=false`) from the top of the stack and returns them as a batch. The batch is soft-deleted (set `deleted_at`) atomically and pushed to the redo stack as a group. Redo mirrors the operation.

- ROUT entries are `chained=true`, linking them to the triggering MOVE
- Other actions (ATTACK, DAMAGE, etc.) can be `chained=true` in the future
- Players can only undo their own chain; GMs can undo any chain
- UI shows "Undo (N)" when the chain has more than one entry

## User Stories

1. As a player, I want my unit's AC to reflect its formation (e.g., Shield Wall gives +2 AC), so that formation choice has a mechanical impact on defense.
2. As a player, I want my unit's max movement to reflect its formation (e.g., Scattered gives +1 movement), so that light formations are faster.
3. As a player, I want my unit's weapon attack bonus to include the formation modifier (e.g., Close Order gives +1 to all weapon attacks), so that dense formations hit harder.
4. As a player, I want my unit's effective morale to include the formation's morale modifier (e.g., Routed gives -2 morale), so that a broken formation is harder to rally.
5. As a player, I want the tooltip to show the breakdown of each effective stat so that I understand how the formation contributes.
6. As a player, I want the tooltip's AC line to show "effective = base + formation" not "currentAc = baselineAc + 0" so that I see the actual defensive value.
7. As a player, I want the tooltip's Move line to use the effective max movement as the denominator, so I know how far I can actually move this turn.
8. As a player, I want the tooltip's weapon section to show the effective attack bonus including the formation modifier, so that I see the true hit chance.
9. As a player, I want the tooltip's morale factors section to include a "formation" line showing the formation's morale modifier, so that I understand why morale is boosted or penalized.
10. As a player, when my unit's effective morale reaches 0 or below after a move, I want it to rout automatically (set `isRouting=true`, `currentFormation='Routed'`), so that the morale system has consequences.
11. As a player, I want heroes to never rout regardless of their effective morale, so that they remain reliable battlefield commanders.
12. As a player, I want already-routing units to not re-trigger the routing check, so that a unit can't rout twice.
13. As a GM, when a move causes a rout, I want the MOVE and ROUT entries in the command log linked so that one undo unwinds both actions in sequence.
14. As a GM, I want to undo a linked chain of actions with a single undo button press, so that I can quickly rewind complex sequences for review.
15. As a player, I want to only be able to undo my own actions, so that I can't accidentally undo another player's moves.
16. As a GM, I want to be able to undo any player's action chain, so that I have full control over the game state.
17. As a GM, I want the undo button to show "Undo (N)" when the chain has more than one entry, so that I know how many actions will be unwound.
18. As a developer, I want the undo/redo engine to protect chain integrity: if any entry in the chain fails the permission check, the entire chain stays in place, so that partial undos are impossible.
19. As a developer, I want the `chained` boolean stored on both the in-memory `CommandEntry` and the `command_log` table row, so that the undo engine and the persisted log are consistent.
20. As a developer, I want the undo/redo system to work consistently for both keyboard shortcuts (Ctrl+Z, Ctrl+Y) and mouse clicks, so that there's no behavior difference.
21. As a player, when I move my unit next to an enemy whose effective morale drops to 0 or below due to the new threat, I want that enemy to rout, so that tactical positioning has morale consequences.
22. As a player, when multiple units adjacent to my target hex all rout from the resulting morale collapse, I want all their ROUT entries chained to the same MOVE, so that one Ctrl+Z unwinds the entire cascade.
23. As a GM, when the routing cascade fires on a move, I want every non-hero, non-routing unit adjacent to the target hex evaluated for routing, so that proximity-based morale cascades have full battlefield consequences.

## Implementation Decisions

### Formation Modifiers — Computation Layer

- A new pure-function module (unitStats.ts) exposes three functions and one helper:
  - `computeEffectiveAc(unit, formationAcModifier)` → `unit.baselineAc + modifier`
  - `computeEffectiveMovement(unit, formationMovementModifier)` → `max(1, unit.movementPoints + modifier)`
  - `computeEffectiveAttackBonus(weaponAttackBonus, formationAttackModifier)` → `weaponAttackBonus + modifier`
  - `getFormationModifier(lookupMap, formationName, key)` → looks up a formation by name in a `Record<string, Formation>` map and returns the requested modifier (0 if not found)

- The existing `computeEffectiveMoraleModifier` in `unitMorale.ts` gains an optional `formationMoraleModifier` parameter (defaults to 0). It is added as an additive term alongside wounds, isolation, and enemy threats:
  ```
  return wounds + (isolated ? -1 : 0) - (threats.frontSide + threats.rear) + formationMoraleModifier
  ```

- All four formation modifier fields on the `Formation` interface use snake_case (`ac_modifier`, `movement_modifier`, `attack_modifier`, `morale_modifier`) matching the existing DB column naming convention used by `Race`, `Armor`, and other lookup table types.

### Formation Modifiers — Data Flow

- Formations are fetched from Supabase once in `ScenarioMap` on mount via `supabase.from('formations').select('*')` and stored as `Record<string, Formation>` keyed by formation name.
- The `customDraw` render pipeline looks up each unit's current formation and passes the `morale_modifier` into the morale computation for heart rendering.
- The `UnitTooltip` receives the current formation object (or null) directly. It computes effective AC/movement/attack/morale for display using the pure functions above.
- Nothing is persisted to the unit's DB fields — all effective stats are derived on the fly, matching the morale pattern.

### Routing Trigger — Cascade

- Implemented in `ScenarioMap.handleUnitMove`. After the MOVE command is recorded via `moveUnitRecorded`, a **synthetic post-move state** is built: the mover is placed at the target hex with all properties except position unchanged; all other units remain at their current positions.
- The following candidates are evaluated in order:
  1. The mover itself (at its new position, evaluating adjacency to enemies from the target hex).
  2. Every non-hero, non-routing unit that is **adjacent** to the target hex (regardless of allegiance).
- For each candidate whose effective morale ≤ 0 (computed using the synthetic state), a new `execute('ROUT', { unitId, ... }, { chained: true })` call is made.
- Each ROUT sub-step sets `isRouting` from `false` to `true` and `currentFormation` from current to `'Routed'`.
- Heroes, already-routing units, and the mover itself (if it already routed as candidate 1) skip evaluation.
- All ROUT entries are created with `chained: true`, so Ctrl+Z unwinds the entire MOVE → ROUT(A) → ROUT(B) cascade as one batch.
- The cascade is synchronous within the function — no `await` between ROUT executions, so they all land on the stack before the next user action.

### Chained Undo — Schema

```sql
ALTER TABLE command_log ADD COLUMN chained BOOLEAN NOT NULL DEFAULT false;
```

### Chained Undo — GameEngine Changes

- `execute` accepts an optional 7th parameter `options: { chained?: boolean }`. Defaults to `false`.
- `CommandEntry` interface gains `chained: boolean` field.
- `undo()` returns `CommandEntry[]` instead of `CommandEntry | null`. It pops entries from the top of the stack while they have `chained=true`, plus one root entry (with `chained=false`). The collected chain is returned in chronological order.
- `redo()` returns `CommandEntry[]`. It peeks at the redo stack for the matching chain (same logic), pops them in reverse order, and pushes them back to the main stack.
- `peekUndoChainLength()` returns the number of entries in the chain (0 if no undo available, or permission denied).
- Permission check on undo/redo: for the entire chain, every entry must belong to the current player. Exception: the GM can undo any chain.
- If permission fails mid-chain (theoretically impossible since chain is always contiguous with same player, but defensive), the entire chain is pushed back to the stack — no partial undo.
- `canUndo`/`canRedo` now check the full chain rather than just the top entry.

### Chained Undo — useGameEngine Changes

- `execute` wrapper accepts optional 4th param `options?: { chained?: boolean }`. Passes `chained` to both the engine's `execute` and to the `command_log` insert.
- `undo` loops over the returned `CommandEntry[]`, applies `from` changes for each entry's sub-steps, and soft-deletes each row (`deleted_at = now()`).
- `redo` loops over the returned `CommandEntry[]`, applies `to` changes for each entry's sub-steps, and undeletes each row (`deleted_at = null`).
- Message: "Undid: Moved griffin (+1 more)" when chain length > 1.

### Chained Undo — UI

- Undo button text becomes `Undo{chainLen > 1 ? ' (N)' : ''}` where N = `peekUndoChainLength()`.
- Ctrl+Z / Ctrl+Y shortcuts remain unchanged — they call `undo()` and `redo()` which now process the full chain.

### UnitTooltip Display

- **AC line**: `"20 = 18 + 2 (Shield Wall)"` — shows effective AC = baseline + formation AC modifier. Only shows formation label when modifier is non-zero.
- **Move line**: Denominator is `effectiveMaxMovement`. When modified: `"3/5 (base 3, formation +2)"`. When not modified: `"3/3"`.
- **Weapons section**: Each weapon shows `"Spear (+5 atk [base +3, formation +2], 1d8)"`. The `[base +N, formation +N]` breakdown only appears when the formation modifier is non-zero.
- **Morale line**: Shows `"MOR: 7 = 5 + 2 (incl. formation +1)"` when formation modifier is non-zero.
- **Morale factors**: Additional line `"formation +1"` (green for positive, red for negative) in the factors grid, only shown when non-zero.
- **Formation row**: Shows the formation name and its organization level, e.g. `"Formation: Shield Wall (org lv 3)"`.

## Testing Decisions

A good test for this system tests the external behavior of pure functions: given known inputs, assert correct outputs. Avoid testing canvas rendering, DOM layout, or async Supabase writes.

### Modules to test

1. **`unitStats.ts`** (new, no existing tests)
   - `computeEffectiveAc` — pure function
     - baselineAc=18, modifier=+2 → 20
     - baselineAc=10, modifier=0 → 10
   - `computeEffectiveMovement` — pure function
     - movementPoints=3, modifier=+2 → 5
     - movementPoints=1, modifier=-3 → 1 (floor at 1)
     - movementPoints=4, modifier=0 → 4
   - `computeEffectiveAttackBonus` — pure function
     - weaponAtk=3, modifier=+1 → 4
     - weaponAtk=3, modifier=0 → 3
   - `getFormationModifier` — pure function
     - Valid formation name, valid key → returns modifier value
     - Unknown formation name → 0
     - Undefined formation name → 0
     - Missing formations map → 0 (via no-name check)

2. **`unitMorale.ts`** — `computeEffectiveMoraleModifier` with formation modifier
   - Unit at full HP, no enemies, formation morale +1 → modifier = +1
   - Unit at 50% HP, no enemies, formation morale -2 → modifier = -5 + (-2) = -7
   - (Existing tests for wounds/isolation/threats inherited from previous spec)

3. **`GameEngine.ts`** — chain undo/redo behavior
   - Single entry with `chained=false` → undo returns 1 entry
   - Two entries: MOVE(chained=false), ROUT(chained=true) → undo returns 2 entries
   - Three entries: MOVE(c=false), ROUT(c=true), PURSUE(c=true) → undo returns all 3
   - Chain with mixed players (non-GM) → undo returns null, chain restored
   - Chain undo → chain pushed to redo stack; redo returns same chain
   - Undo single non-chained action → moves to redo stack; canUndo/canRedo updated
   - Stack overflow (50+ entries) — entry count is clamped, oldest dropped

### Prior art

- `tokenUtils.test.ts`: Tests pure functions with various inputs — pattern of "given X input, expect Y output" for each combination.
- `templateMappers.test.ts`: Tests pure DB-to-TypeScript mapping.
- `weaponParser.test.ts`: Tests string parsing with boundary cases.

### Not tested (manual QA / integration-only)

- Routing cascade logic (candidate selection, iteration, chained ROUT execution) in `handleUnitMove` — lives entirely in the async React integration layer. No new seams needed; the highest testable seam is `computeEffectiveMoraleModifier` in `unitMorale.ts`, which already has test coverage.
- Tooltip positioning and visibility
- Undo/redo button rendering and keyboard shortcut behavior
- Supabase `command_log` insert/update/delete operations
- Canvas rendering with effective AC/movement (these stats are not drawn on tokens)

## Out of Scope

- Combat resolution system (ATTACK/DAMAGE actions). The routing trigger hooks into MOVE only; DAMAGE will need the same check when built.
- Persisting effective stats to the `units.currentAc` or other DB fields. All effective stats are computed on the fly.
- Formation modifier application during unit creation (templates are formation-agnostic; formations are chosen on placement).
- Replay system (`deleted_at` skip is a query concern, not an undo engine concern).
- `chained` entries for actions other than ROUT (future: ATTACK, DAMAGE, PURSUE, etc. will use the same mechanism).

## Further Notes

- The route from `currentMoraleModifier` to effective morale: `effectiveMoraleModifier = unit.currentMoraleModifier + computeSituationalModifier(…) + formationMoraleModifier`. The `currentMoraleModifier` is GM-adjustable and persisted; the other two terms are computed on the fly.
- The `Unit` interface's `currentAc` field was originally intended as a mutable battlefield AC. Since all formation AC modifiers are now computed on the fly (not persisted), `currentAc` is effectively unused for formation purposes. It remains in the interface for potential future use (e.g., spell effects, item bonuses that should persist).
- Tooltip morale computation duplicates some helper functions (`calcWounds`, `calcIsolation`, `calcEnemyThreats`) from `unitMorale.ts` due to the tooltip being a self-contained display component. This is an acceptable trade-off to keep the tooltip independent and easily understandable.
