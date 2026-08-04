Status: done

# Command Log & Undo System

## Problem Statement

Players make mistakes during a session — misclicks, wrong hex, accidental rotate, unwanted unit placement. Currently there is no way to reverse any action on the scenario map. All context menu actions (rotate, formation change, team assignment, hide) only log text to the message panel without actually executing the underlying unit state change. The game worker is an unused stub. The message log is a flat string array with no structure, no player attribution, and no persistence. When a player places multiple units of the same type (e.g. five Town Guards), there is no way to distinguish them in the log.

## Solution

A command/undo system where every player action is:

1. Validated, executed against Supabase, and the unit's state is updated immediately
2. Recorded as a structured `CommandEntry` in an in-memory undo stack (capped at 50 entries)
3. Persisted to a `command_log` DB table for session replay and crash recovery
4. Reversible via a single Undo click — the entry's field-level deltas are reversed and the entry is removed (rewind semantics, not counter-action)
5. Undone entries are soft-deleted in the DB (`deleted_at` timestamp)

Each unit instance is given a sequential `#N` suffix (e.g. "Town Guards #3") when placed, so players can identify individual units in messages and on the map.

Undo follows a linear LIFO stack — no skipping. A player can only undo their own most recent command. A GM can undo any entry on top of the stack. For complex actions (e.g. an attack that deals damage, triggers retaliation, and routs a target), sub-steps are stored as a single linked group so the whole action undoes in one click.

## User Stories

1. As a player, I want to rotate a unit from the context menu, so that its facing changes on the map.
2. As a player, I want to change a unit's formation from the context menu, so that the unit's dot layout updates.
3. As a player, I want to assign a team color to a unit from the context menu, so that it renders with the correct team on the map.
4. As a player, I want to hide or unhide a unit from the context menu, so that it becomes invisible or visible on the map.
5. As a player, I want to remove a unit from play via the context menu, so that it is hidden without deleting it from the database (undoable).
6. As a player, I want to place a unit by dragging from the unit selector onto the hex grid, so that it appears on the map at the chosen hex.
7. As a player, I want to drag a unit across the hex grid to a new hex, so that it moves.
8. As a player, I want every action I take logged in the message panel with a clear, human-readable description.
9. As a player, I want to see a sequential #N identifier on each unit of the same type (e.g. "Town Guards #3"), so that I can tell them apart in messages and on tokens.
10. As a player, I want to undo my most recent action via an Undo button in the top bar, so that the game state before that action is restored.
11. As a player, I want the Undo button to be disabled when there is nothing I can undo (my undo stack is empty or another player's action is on top).
12. As a player, I want Ctrl+Z to trigger an undo, matching standard desktop shortcuts.
13. As a player, I want to undo a placed unit so that it disappears from the map (becomes hidden).
14. As a player, I want to undo a hidden unit so that it becomes visible again.
15. As a player, I want to undo a moved unit so that it returns to its previous hex.
16. As a player, I want to undo a rotated unit so that it returns to its previous facing.
17. As a player, I want to undo a team assignment so that the unit returns to its previous team.
18. As a player, I want to undo a formation change so that the unit returns to its previous formation.
19. As a player, I want to undo a "remove from play" action so that the unit reappears (unhidden).
20. As a player, I want redo (Ctrl+Y) to restore the last undone action, so that I can recover from an accidental undo.
21. As a GM, I want to undo any player's most recent action, so that I can correct mistakes for the whole table.
22. As a GM, I want an End Turn button that increments the turn counter and logs the turn boundary in the message panel.
23. As a session participant, I want the action log to persist in a `command_log` DB table, so that a full session can be replayed after the game.
24. As a developer, I want the game engine to be a pure TypeScript class with no React or Supabase dependencies, so that it can be unit tested in isolation without a browser or database.
25. As a developer, I want the undo stack to hold at most 50 entries, so that memory is bounded.
26. As a developer, I want the `command_log` table to use RLS policies so that players can only insert and soft-delete their own entries, and GMs can soft-delete any entry in their scenario.

## Implementation Decisions

### Module: GameEngine

A pure TypeScript class owning the undo stack. It has no React or Supabase imports.

- `execute()` accepts an action type, a list of sub-steps (each with `{ type, description, unitId, changes: { field, from, to }[] }`), a description, and player info. It builds a `CommandEntry`, pushes it to the stack, evicts the oldest entry if the stack exceeds 50, and returns the entry.
- `undo()` checks permission (player must own the top entry unless they are GM), pops the entry, and returns it.
- `canUndo()` / `peekUndo()` / `getStackSize()` for UI queries without mutation.

The `ActionType` union covers all current and planned actions: `MOVE | ROTATE | FORMATION | TEAM | HIDE | TOGGLE_HIDE | PLACE | ATTACK | DAMAGE | HEAL | ROUT`.

Key type shape (from prototype):

```ts
interface CommandEntry {
  id: string;
  timestamp: number;
  playerId: string;
  playerName: string;
  scenarioId: string;
  actionType: ActionType;
  description: string;
  subSteps: SubStep[];
}

interface SubStep {
  type: ActionType;
  description: string;
  unitId: string;
  changes: UnitChange[];
}

interface UnitChange {
  field: string;
  from: any;
  to: any;
}
```

### Module: React Hook (useGameEngine)

A React bridge that holds a `GameEngine` ref and exposes action methods.

- Each action method (`moveUnitRecorded`, `rotateUnit`, `changeFormation`, `assignTeam`, `toggleHide`, `placeUnit`) constructs the appropriate sub-steps, calls `engine.execute()`, applies each sub-step's `→to` field values via `updateUnit()`, inserts a row into the `command_log` DB table, and pushes a message to the message context.
- `undo()` calls `engine.undo()`, applies each sub-step's reverse (`→from`) field values via `updateUnit()`, soft-deletes the `command_log` row, and pushes an "Undid: ..." message.
- `canUndo()` / `peekUndo()` delegate to the engine.
- The PLACE action stores `{ field: 'hidden', from: true, to: false }` so that undo sets `hidden: true` (the unit disappears from the map).
- All changes are applied via the existing `updateUnit()` function which handles both local state update and Supabase persistence.

### DB Migration: `command_log` table

```sql
CREATE TABLE command_log (
  id UUID PRIMARY KEY,
  scenario_id UUID NOT NULL REFERENCES scenarios(id),
  player_id UUID NOT NULL,
  player_name TEXT NOT NULL DEFAULT '',
  action_type TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  sub_steps JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);
```

RLS policies:
- `insert_own_action`: authenticated users can insert rows where `player_id = auth.uid()`.
- `select_scenario_log`: authenticated participants of the scenario can select rows.
- `update_own_or_gm`: the row owner or any GM of that scenario can update (soft-delete) rows.

### Schema extension: unit instance numbering

When a unit is placed from a template, its `unitName` is suffixed with ` #N` where N = (count of existing units with the same `templateId` in this scenario) + 1. The counter is computed from the in-memory `units` array, so it is session-local and does not require an extra DB query.

### Component: ScenarioMap

- Context menu callbacks (`onRotate`, `onChangeFormation`, `onAssignTeam`, `onToggleHide`) call the corresponding game engine methods instead of only calling `addMessage()`.
- `onDeleteUnit` sets `hidden: true` instead of performing a database DELETE. This makes the action reversible via undo and keeps the unit in the database for scenario teardown.
- Drag-to-place records a PLACE command entry. Canvas drag-move records a MOVE command entry.
- An Undo button is rendered in the top bar alongside the turn counter. It is styled amber when active and gray/disabled when `canUndo()` returns false.
- The turn counter displays the current turn number. A GM-only "End Turn" button increments it and logs the turn boundary.
- `playerId` and `playerName` are derived from the authenticated `currentUser` object and passed to `useGameEngine`.

### MessagesPanel

The message panel continues to display the flat `string[]` from the message context. Each game engine call pushes a human-readable description (e.g. "Town Guards #3 rotated left", "Undid: Town Guards #3 rotated left"). No structural changes to the message panel are required for the MVP.

### Keyboard shortcuts

- Ctrl+Z: trigger `undo()` (not yet implemented — marked as a ticket).
- Ctrl+Y: trigger redo (not yet implemented — marked as a ticket).

### Removed

The unused `src/workers/gameWorker.ts` was removed. Its stub handlers were never wired into the application. All game logic now lives in `GameEngine.ts` and `useGameEngine.ts`.

## Cross-Session Undo, Realtime Sync & Replay

The command log is the single source of truth for undo **and** replay.

### Cross-session undo (hydrate)
- **`buildStackFromLog(rows)`** (`src/lib/commandHistory.ts`): rebuilds the engine's undo stack from persisted `command_log` rows — ordered by `created_at`, `chained` grouping preserved, capped at 50, JSON `sub_steps` parsed.
- **`useGameEngine.hydrateFromLog(scenarioId)`**: fetches non-deleted rows for the scenario and `loadStack`s them into the engine. Called once on ScenarioMap mount after units load.
- Because the log is scenario-scoped, every client hydrates the **same full timeline** — so the sequential-LIFO rule (own-actions only, DM any, no skipping) is enforced against the global top, not just the local client's own commands.

### Realtime sync
- **`useGameEngine.subscribeToCommandLog(scenarioId)`**: subscribes to `postgres_changes` INSERTs on `command_log` (filtered by `scenario_id`) and appends remote entries via `GameEngine.pushExternal` (deduped by entry id, respects the 50 cap). Keeps every client's undo stack current mid-session.
- `GameEngine` gained `loadStack(entries)` (replace stack + clear redo) and `pushExternal(entry)` (dedupe append). `SubStep` gained an optional `payload` (JSONB-safe) used to carry full unit snapshots on PLACE for replay — ignored by the live DB-apply path.

### Replay (read-only playback)
- **`buildReplayTimeline(rows)`** (`src/lib/commandHistory.ts`): builds a net timeline (soft-deleted/undone rows skipped) from the log head alone — each step is one command group (a non-chained entry + its chained follow-ups) with a full `ReplayState` snapshot (units map, alliances, scenario fields). No baseline snapshot is needed: every unit is seeded by its full-snapshot PLACE payload, so replay is immune to template edits and unit deletion.
- **`replayStateToUnits(state)`**: converts a step's unit map into a renderable `Unit[]`.
- **`useReplay(scenarioId)`** (`src/hooks/useReplay.ts`): fetches the log → timeline; playback state (`cursor`, `playing`, `speed` 0.5/1/2/4, seek/play/pause/step fwd/back); derives `replayUnits`/`replayAlliances`/`replayTurnNumber` at the cursor (cursor 0 = empty world). Co-watch via a shared-registry realtime broadcast channel `replay:${scenarioId}` (StrictMode-safe like `useMessageSync`): anyone can grab the clicker and broadcast `seek`/`play`/`pause`/`mode`; viewers follow seeks but keep their own speed.
- **ReplayOverlay** (`src/components/ScenarioMap/ReplayOverlay.tsx`): amber REPLAY frame + banner + playback bar (play/pause, scrubber, frame-step, speed). Distinct from live play so there's never ambiguity.
- **Two entry modes**: Mode 1 — Lobby "Replay Scenario" button opens the map with `replayMode` prop (standalone read-only). Mode 2 — GM-only "Replay scenario" toggle inside a live session (`replay.setMode('replay'/'play')`) pulls the whole session into replay together; "Back to Play" restores gameplay.
- **`useHexGrid` `readOnly`**: pan/zoom/hover enabled, but unit drag-move, attack, and context menu disabled — used by both replay and DM-gone lock.
- Migration 019 adds a `select_log_any_approved` SELECT policy so any approved user can watch replays of any scenario.

## Testing Decisions

**Seam**: The `GameEngine` class is the highest-value testing seam. It is pure logic with zero dependencies (no React, no Supabase), making it testable with simple unit tests. This follows the existing pattern in the codebase: `weaponParser.test.ts` and `templateMappers.test.ts` test pure functions with Vitest.

**What makes a good test**: Tests should verify external behavior — what goes in and what comes out — not internal stack implementation details. Each test creates an engine, calls `execute()` and `undo()`, and asserts the returned entries have the expected structure and that permission checks behave correctly.

**Which modules will be tested**:
- `GameEngine` class (in `src/game/`)

**Non-goals for unit tests**:
- Do not test `useGameEngine` (React hook — would require a test harness).
- Do not test the DB layer (Supabase integration requires a live database).
- Do not test UI rendering (MessagesPanel, Undo button state).

**Prior art**:
- `src/lib/weaponParser.test.ts` — tests a pure parser/formatter module with `describe`/`it`/`expect`.
- `src/lib/templateMappers.test.ts` — tests pure mapper functions with roundtrip assertions.
- `src/components/TokenRenderer/tokenUtils.test.ts` — tests a pure utility module with Vitest.

**Test cases**:
1. `execute()` returns an entry with the correct action type, player info, and sub-steps.
2. `undo()` returns the top entry and removes it from the stack.
3. `undo()` returns `null` on an empty stack.
4. `undo()` rejects an entry owned by a different player when caller is not GM.
5. `undo()` returns an entry owned by a different player when caller is GM.
6. `undo()` returns the player's own entry.
7. `canUndo()` returns `false` when the stack is empty.
8. `canUndo()` returns `false` when the top entry is owned by another player (non-GM).
9. `canUndo()` returns `true` when the top entry is owned by the caller.
10. `canUndo()` returns `true` for GM regardless of ownership.
11. The stack evicts the oldest entry when it exceeds 50 entries.
12. `peekUndo()` returns the top entry without removing it.

## Out of Scope

- Combat resolution (damage, retaliation, morale checks, rout) — deferred until the game rules are fully defined.
- Weapon selection execution — currently only logs a message; the actual weapon system is not yet built.
- Redo (Ctrl+Y) — the `command_log` stores the data needed for redo, but no UI or keyboard shortcut exists yet.
- Session replay UI — the `command_log` table persists the complete action history, but there is no replay viewer.
- Per-entry undo buttons in the MessagesPanel — a single Undo button in the top bar is sufficient for MVP.
- Edit history for GM manual overrides — acknowledged as a future concern but not part of this spec.
- The `gameWorker.ts` worker was removed; a web worker wrapper around `GameEngine` can be added later if main-thread performance becomes a concern.

## Further Notes

- `useSupabaseSync.addUnitFromTemplate()` was changed to return the new unit's ID (`string`) on success instead of `boolean`, enabling PLACE command recording.
- The context menu's "Delete Unit" action was changed from a database DELETE to setting `hidden: true`. This makes undo possible and avoids data loss. Scenario teardown remains the only place that performs a real DELETE on units.
- The drag ghost (yellow dashed ellipse) is rendered both when dragging a unit from the panel and when dragging a token on the canvas, using a shared `DragGhost` component.
- The `#N` counter for unit instances was initially implemented with `#` prefix, then changed to a space prefix based on user feedback that the `#` glyph was too thick visually.
