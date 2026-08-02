Status: done

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
2. **Reset on turn start.** When a group's turn starts, every unit whose team is in that group resets to **2 actions / 0 MP**:
   - `movementPointsAvailable` → **0** (MP is not granted up front)
   - `actionsAvailable` → **2** (each unit gets 2 actions per turn)
   - MP is **materialized only when a move converts an action** into a full pool (`computeMovePool`).
3. **Spending.** Each player action records the points it costs in its command sub-steps. Points may go negative — **tracking never blocks an action**. "No one is exempt" (GM, heroes, routed units all track); "going over never stops the user from doing more" (per explicit requirement — tabletop flexibility, no enforcement exceptions).
4. **Movement cost** (rule set, already in the BFS code):
   - **1 MP** per hex entered from the front arc
   - **1 MP** per 60° facing change
5. **Overlay.** The drag overlay shades the pool a move would create: `computeMovePool(unit, effectiveMax)` — a **full pool when actions ≥ 1** (an action converts to MP at move start), falling back to leftover `min(effectiveMax, floor(movementPointsAvailable))` when 0 actions. The executed move still accepts any hex within the full action budget, so dropping beyond the shaded area just refills into the next pool.

## User Stories

1. As a player, when my team's turn starts, I want all my units at **2 actions / 0 MP** (each action converts to a full move), so I have a clear per-turn budget.
2. As a player, I want an "End Turn" button that advances to the next team, so turns alternate between teams.
3. As a player, I want a visible "Current turn: {team}" indicator so I know whose turn it is.
4. As a player, I want each move to deduct the actual movement cost (front-arc steps + facing turns), so positioning and facing are meaningful.
5. As a player, I want the reachable-hex overlay to show one action's worth of movement (a full pool), not my entire action budget.
6. As a player, I want an attack to consume 1 action, so a unit can't act indefinitely in one turn.
7. As a player, I want the tooltip to show remaining actions (`Actions: n/2`) next to the existing move display.
8. As a player, I want to still be able to act when my budget is exhausted (the tracker records negative values but never blocks me), so the GM keeps tabletop freedom.
9. As a GM, I want undo/redo to restore spent movement and actions along with the hex/formation/HP changes, so the command log stays the single source of truth.
10. As a developer, I want the movement-cost computation as a pure function with a seeded RNG-free signature, so it is fully testable.

## Implementation Decisions

> **Final ruling (post-dry-run):** MP is an **integer** — formation rescaling just `floor()`s; no fractional column, no migration needed. **One action = one full MP pool** (`maxMP`): units reset to **2 actions / 0 MP**, and a move's cost is spent from **already-materialized MP first**; only when MP is exhausted does an action convert into a fresh full pool. Rotate/formation cost **MP only** for non-hero units — **heroes ignore** rotate/formation MP; attach/detach cost the **hero's** MP, not the host unit's. Insufficient budgets are **soft-enforced**: a move/attack that would exceed the budget (`isMoveAffordable` false) shows a confirm modal, and proceeding pushes a **red notification** to the message log. It is never hard-blocked.

### Action cost table

| Player action | Command | Action cost | MP cost | Notes |
|---|---|---|---|---|
| Move (drag to hex) | `MOVE` | 1 per full pool converted (when MP exhausted) | path cost (front steps + turns) | spends materialized MP first; action converts a fresh pool when MP runs out |
| Attack (drag onto enemy) | `ATTACK` | 1 | 0 | spent even on AGR failure |
| Rotate (context menu) | `ROTATE` | 0 (1 only if MP < 1 triggers a refill) | 1 | **units only — heroes ignore** |
| Formation change | `FORMATION` | 0 | org-level steps + proportional rescale (floor) | **heroes skip MP**; integer MP, clamped to [0, newMax] |
| Attach / Detach hero | `ATTACH_HERO` / `DETACH_HERO` | 0 (1 only if hero MP < 1) | 1 — **from the hero, not the host unit** | detach may also place hero on a free adjacent hex |
| Hide / Assign team / Delete / Place | `TOGGLE_HIDE` / `TEAM` / `DELETE` / `PLACE` | 0 | 0 | GM/utility actions |
| Rout (morale-induced) | `ROUT` | 0 | 0 | forced, not a player action |

### Schema

- `scenarios`: add `current_turn_alliance text` (nullable, `CHECK IN ('friendly','enemy','neutral')`) and `turn_number integer NOT NULL DEFAULT 0`. `null` = free play / no active turn; `turn_number` increments once per full cycle.
- `movement_points_available` and `actions_available` already exist on `units` (sync code reads/writes them) — **no column migration needed**; `movement_points_available` stays `INTEGER`.

### Types (`src/types/gameProtocol.ts`)

- `Scenario.currentTurnAlliance: AllianceGroup | null`
- `Scenario.turnNumber: number`

### Movement cost (`src/lib/moveCost.ts` — new, pure)

Replaces `getReachableHexes` (deleted from `ScenarioMap.tsx`):

```
computeReachableMap(unit, maxMP, occupied, threatHexes): Map<"q,r", { cost, path, finalFacing }>
```

- State space `(hex, facing)`; 1 MP per front-arc step, 1 MP per 60° turn (unchanged).
- Threat hexes are reachable as destinations but never passed through; occupied hexes are never reachable.
- Routed / Scattered units move in any direction at 1 MP per hex (no facing).
- The drag overlay and the executed move cost both derive from this map, so they can never disagree. `maxMP` for the overlay is `effectiveMaxMovement × max(1, actionsAvailable)` (`computeMoveBudget`).
- **Action accounting** (`applyMoveCost`): the cost is spent from `movementPointsAvailable` first; each full pool beyond that converts one action. Final MP = remainder of the last pool (0 on exact pool); final actions = unconverted pools left. `applyMpSpend` handles single-MP spends with an action→full-pool conversion when MP is insufficient.

### Formation rescale (`src/lib/formationCost.ts` — new, pure)

```
applyFormationChange(currentMP, steps, oldMax, newMax): number
```

- `steps` = `|getOrganizationLevel(old) − getOrganizationLevel(new)|` (1 MP per org-level step), then proportional rescale `(currentMP − steps) × newMax/oldMax`, `floor`ed and clamped to `[0, newMax]`.
- Replaces the old `Math.round`-based proportional-only logic in `changeFormation`.

### Command integration (`src/hooks/useGameEngine.ts`)

Each command's sub-steps gain `movementPointsAvailable` / `actionsAvailable` deltas so undo restores them automatically (the engine already replays `from`/`to` per field):

- `moveUnitRecorded(unit, targetHex, cost)`: adds `actionsAvailable` (n → n−1) and `movementPointsAvailable` (from → from − cost).
- `rotateUnit`: adds `movementPointsAvailable` (n → n−1). No action.
- `changeFormation`: uses `applyFormationChange` for `movementPointsAvailable`. No action.
- `attachHero` / `detachHero`: add `movementPointsAvailable` (n → n−1).
- `onAttack` in `ScenarioMap.tsx`: an `ATTACK` sub-step adds `actionsAvailable` (n → n−1) to the ATTACK command, spent even when AGR fails.

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

- Drag overlay: `maxMP = computeMovePool(unit, effectiveMax)` — a full pool when actions ≥ 1 (an action converts to MP at move start), else leftover MP only.
- Tooltip: `Actions: {unit.actionsAvailable}/2` (red when ≤ 0) with a `(1 = full move)` hint; `Move: {floor(unit.movementPointsAvailable)}/{max}` (actual materialized MP, drains per pool).
- **Soft enforcement (never hard-blocks):**
  - `handleUnitMove` computes the executed cost from `computeReachableMap` over the budget `movementPointsAvailable + maxMP × max(1, actions)`. Hex unreachable within that budget → rejected with a message. A move **not affordable** (`isMoveAffordable` — cost exceeds leftover MP + action pools, so actions would go negative) → confirm modal; on confirm, the full cost is deducted (may go negative) and a **red error notification** (`addError`) is pushed to the message log.
  - `onAttack`: attacker with `actionsAvailable < 1` → confirm modal; on confirm, the action is deducted (may go to −1) and a red notification is pushed.
  - Rationale examples: hero detach + reposition may exceed the engine-chosen budget; haste can grant a double attack.
- Spawn (`useSupabaseSync.ts`): **2 actions / 0 MP** — freshly placed units can move (an action converts to a full pool) or act immediately.

## Testing Decisions

Pure-function tests only; no async/DB/React integration.

1. **`turnState.test.ts`** (done): active-group derivation (friendly-only default, canonical order, all three groups), advance/skip/wrap, null start, single-group wrap.
2. **`moveCost.test.ts`** (done, 21 cases):
   - Front-arc step costs 1 MP; 60° turn costs 1 MP; min-cost path chosen
   - `maxMP` honored; occupied hexes excluded
   - Threat hex reachable as a destination, never appears in an intermediate path hex
   - Routed / Scattered move in any direction at 1 MP/hex; 0 MP → empty map
   - `computeMoveBudget`: `maxMP × actions` (1 pool min at 0 actions for soft-confirm)
   - `applyMoveCost`: spends materialized MP first, action converts a pool only when MP exhausted, exact-pool ends at 0 MP, leftover MP stays usable, negative actions when over budget
   - `applyMpSpend`: sufficient-MP spend, action→full-pool refill at 0 MP, negative without actions
   - `isMoveAffordable`: true within action budget, false at 0 actions
3. **`formationCost.test.ts`** (done, 6 cases): step deduction then proportional floor rescale, clamp to `[0, newMax]`, never negative (user's 4→2→1→0 Scattered→Open→Close→Phalanx trace).
4. **Turn-start reset**: `movementPointsAvailable` resets to `computeEffectiveMovement` with formation multiplier; `actionsAvailable` resets to 2.
5. **Action deduction** per row of the action cost table (pure delta math).

Prior art: `unitCombat.test.ts` (pure functions, seeded RNG), `tokenUtils.test.ts`, `weaponParser.test.ts`.

Not tested (manual QA): the End Turn button flow, realtime `current_turn_alliance` propagation across clients, undo of an END_TURN, tooltip rendering, the over-budget confirm modals.

## Out of Scope

- **Hard enforcement** — blocking actions when points are exhausted. Explicitly not wanted ("going over never stops the user"); instead soft-enforced via confirm modal + red notification.
- Initiative / initiative order / simultaneous turns.
- Restricting *who* may press End Turn (anyone in the session can, by design).
- A GM-configured turn order (initial version cycles groups in fixed friendly → enemy → neutral order, skipping empty boxes).
- Turn timer / auto-advance.

## Further Notes

- `actionsAvailable` now defaults to **2** at spawn (`useSupabaseSync.ts`).
- Routed / Scattered units still track MP and actions; their movement is already governed by their special BFS branch.
- **Remaining:** migration 013 (`turn_tracking.sql`, `current_turn_alliance` + `turn_number`) is written but still needs to be applied to the DB (`supabase db push` / manual apply).
