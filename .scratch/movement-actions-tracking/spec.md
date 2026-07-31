Status: ready-for-agent

# Movement & Action Tracking (Turn System)

## Problem Statement

The game has no turn economy. The `movement_points_available` and `actions_available` columns exist on `units` and are already read/written by `useSupabaseSync.ts`, but nothing ever consumes or resets them:

- A MOVE command only changes `hex` — no movement points are deducted.
- A unit can attack repeatedly — `actionsAvailable` is set to `0` at spawn and never incremented.
- There is no concept of "whose turn it is", no reset, and no end-of-turn.

The tooltip already renders `Move: {movementPointsAvailable}/{effectiveMaxMovement}`, but the numerator is permanently stale. The drag overlay clamps reachable hexes to `computeEffectiveMovement(...)` (the unit's *max*) rather than its *remaining* movement.

## Solution

Add a lightweight, **per-team turn** tracker. It records budgets, never enforces them.

1. **Turn state.** A scenario tracks `current_turn_alliance` (null = free play). An **End Turn** button advances to the next alliance group in fixed order **friendly → enemy → neutral**, skipping any group with no team assigned to it in `team_alliances` (teams default to `'friendly'`, so friendly is always active). The advance and the per-unit resets are one atomic, undoable command. `turn_number` increments only when a full cycle completes (advance returns to the first active group). Anyone in the session may press the button.
2. **Reset on turn start.** When a group's turn starts, every unit whose team is in that group resets:
   - `movementPointsAvailable` → `computeEffectiveMovement(unit, formation.movement_multiplier)` (formation multiplier applied)
   - `actionsAvailable` → **2** (each unit gets 2 actions per turn)
3. **Spending.** Each player action records the points it costs in its command sub-steps. Points may go negative — **tracking never blocks an action**. "No one is exempt" (GM, heroes, routed units all track); "going over never stops the user from doing more" (per explicit requirement — tabletop flexibility, no enforcement exceptions).
4. **Movement cost** (rule set, already in the BFS code):
   - **1 MP** per hex entered from the front arc
   - **1 MP** per 60° facing change
5. **Overlay.** The drag overlay clamps `maxMP` to `min(effectiveMovement, movementPointsAvailable)` so players see where they can still go this turn.

## User Stories

1. As a player, when my team's turn starts, I want all my units at full movement and 2 actions, so I have a clear per-turn budget.
2. As a player, I want an "End Turn" button that advances to the next team, so turns alternate between teams.
3. As a player, I want a visible "Current turn: {team}" indicator so I know whose turn it is.
4. As a player, I want each move to deduct the actual movement cost (front-arc steps + facing turns), so positioning and facing are meaningful.
5. As a player, I want the reachable-hex overlay to respect my *remaining* movement points, not my maximum.
6. As a player, I want an attack to consume 1 action, so a unit can't act indefinitely in one turn.
7. As a player, I want the tooltip to show remaining actions (`Actions: n/2`) next to the existing move display.
8. As a player, I want to still be able to act when my budget is exhausted (the tracker records negative values but never blocks me), so the GM keeps tabletop freedom.
9. As a GM, I want undo/redo to restore spent movement and actions along with the hex/formation/HP changes, so the command log stays the single source of truth.
10. As a developer, I want the movement-cost computation as a pure function with a seeded RNG-free signature, so it is fully testable.

## Implementation Decisions

### Action cost table

| Player action | Command | Action cost | MP cost | Notes |
|---|---|---|---|---|
| Move (drag to hex) | `MOVE` | 1 | path cost (front steps + turns) | also sets hex, facing |
| Attack (drag onto enemy) | `ATTACK` | 1 | 0 | combat resolution unchanged |
| Rotate (context menu) | `ROTATE` | 1 | 1 | one 60° step |
| Formation change | `FORMATION` | 1 | 1 | keeps proportional MP scaling (existing behavior) |
| Attach / Detach hero | `ATTACH_HERO` / `DETACH_HERO` | 1 | 0 | |
| Hide / Assign team / Delete / Place | `TOGGLE_HIDE` / `TEAM` / `DELETE` / `PLACE` | 0 | 0 | GM/utility actions |
| Rout (morale-induced) | `ROUT` | 0 | 0 | forced, not a player action |

### Schema

- `scenarios`: add `current_turn_alliance text` (nullable, `CHECK IN ('friendly','enemy','neutral')`) and `turn_number integer NOT NULL DEFAULT 0`. `null` = free play / no active turn; `turn_number` increments once per full cycle.
- Verify `movement_points_available` and `actions_available` already exist on `units` (sync code reads/writes them today); if they don't, include them in the migration.

### Types (`src/types/gameProtocol.ts`)

- `Scenario.currentTurnAlliance: AllianceGroup | null`
- `Scenario.turnNumber: number`

### Movement cost (`src/lib/moveCost.ts` — new, pure)

Extract the path-cost logic that currently lives inside `getReachableHexes` in `ScenarioMap.tsx`:

```
computeMoveCost(unit, units, alliances, targetHex, formationsMap): { mpCost, path } | null
```

- State space `(hex, facing)`; 1 MP per front-arc step, 1 MP per 60° turn (unchanged).
- Returns `null` when unreachable (out of MP, occupied, or through a red threat hex).
- `getReachableHexes` is reimplemented on top of it (same reachable-set output) so the overlay and the executed cost can never disagree.

### Command integration (`src/hooks/useGameEngine.ts`)

Each command's sub-steps gain `movementPointsAvailable` / `actionsAvailable` deltas so undo restores them automatically (the engine already replays `from`/`to` per field):

- `moveUnitRecorded`: sub-steps add `actionsAvailable` (n → n-1) and `movementPointsAvailable` (from → from − cost).
- `rotateUnit`: add `actionsAvailable` (n → n-1) and `movementPointsAvailable` (n → n-1).
- `changeFormation`: add `actionsAvailable` (n → n-1) and `movementPointsAvailable` (n → n-1).
- `attachHero` / `detachHero`: add `actionsAvailable` (n → n-1).
- `onAttack` in `ScenarioMap.tsx`: add an `actionsAvailable` (n → n-1) sub-step to the ATTACK command.

### Turn command (`END_TURN`)

- New `ActionType = 'END_TURN'` in `GameEngine.ts` (plus a `'SCENARIO'` sub-step type for scenario-row changes).
- One command, undoable like any other:
  - sub-step 1 (`SCENARIO`): `scenarios.current_turn_alliance` → next group and `turn_number` → +1 if the cycle wrapped (computed by `advanceTurn` in `src/lib/turnState.ts`; active groups derived from the `team_alliances`-backed `alliances` map)
  - then one sub-step per unit of the *newly-active* group resetting `movementPointsAvailable` and `actionsAvailable`
- New `endTurn()` in `useGameEngine.ts` plus a UI button with the current group in the label/color and a `Turn {n}` indicator (in `ScenarioMap`'s top bar).

### Turn-cycle helpers (`src/lib/turnState.ts` — new, pure)

- `ALLIANCE_ORDER = ['friendly','enemy','neutral']`
- `getActiveGroups(alliances)` — unique groups present in the alliance map
- `advanceTurn(current, activeGroups)` → `{ next, wrapped }`; `null` starts at the first active group; `wrapped` = full cycle (triggers the +1).

### UI (`ScenarioMap.tsx`, `UnitTooltip.tsx`)

- Drag overlay: `maxMP = min(computeEffectiveMovement(unit, movementMult), unit.movementPointsAvailable)`.
- Tooltip: add `Actions: {unit.actionsAvailable}/2`; keep `Move: remaining/max`.
- **Non-blocking:** no new validation in `handleUnitMove`, `onAttack`, or `rotateUnit` — the tracker records and moves on.

## Testing Decisions

Pure-function tests only; no async/DB/React integration.

1. **`turnState.test.ts`** (done): active-group derivation (friendly-only default, canonical order, all three groups), advance/skip/wrap, null start, single-group wrap.
2. **`moveCost.test.ts`** (new):
   - Front-arc step costs 1 MP
   - 60° turn costs 1 MP (and chains)
   - Min-cost path chosen when alternatives exist
   - Unreachable → `null` (occupied hex, out of MP, blocked by red threat hex)
3. **Turn-start reset**: `movementPointsAvailable` resets to `computeEffectiveMovement` with formation multiplier; `actionsAvailable` resets to 2.
4. **Action deduction** per row of the action cost table (pure delta math).

Prior art: `unitCombat.test.ts` (pure functions, seeded RNG), `tokenUtils.test.ts`, `weaponParser.test.ts`.

Not tested (manual QA): the End Turn button flow, realtime `current_turn_alliance` propagation across clients, undo of an END_TURN, tooltip rendering.

## Out of Scope

- **Enforcement** — blocking actions when points are exhausted. Explicitly not wanted ("going over never stops the user").
- Initiative / initiative order / simultaneous turns.
- Restricting *who* may press End Turn (anyone in the session can, by design).
- A GM-configured turn order (initial version cycles groups in fixed friendly → enemy → neutral order, skipping empty boxes).
- Turn timer / auto-advance.

## Further Notes

- The existing `movementPointsAvailable` proportional scaling on formation change (`useGameEngine.ts:216-219`) is preserved.
- `actionsAvailable` currently defaults to `0` at spawn (`useSupabaseSync.ts:372`) — it should default to `2` (or be set by the first turn reset).
- Routed / Scattered units still track MP and actions; their movement is already governed by their special BFS branch.
