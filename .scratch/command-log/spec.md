Status: done

# Command Log & Undo System

## Problem Statement

Players make mistakes during a session — misclicks, wrong hex, accidental rotate, unwanted unit placement. All game actions on the scenario map (move, rotate, formation change, attack, hide, placement, heal, cast) must be reversible, and the full session must be replayable afterward.

**Architecture note (2026-08-18):** the original design kept a client-side `GameEngine` stack in each browser that mirrored the `command_log` and stayed in sync via realtime. That mirror could go stale (missed/out-of-order realtime events, ordering ties on `(created_at, id)`), and each action did **two non-atomic client writes** — a `units` update followed by a `command_log` insert — so the units table and the log could diverge (an undo then reverted the wrong state, or an un-logged write became permanently un-undoable). The current design removes the client stack entirely and makes the server authoritative for both execution and undo/redo. This spec describes the current design.

## User Stories

1. As a player, I want every action I take (move, rotate, formation, team, hide, attack, heal, cast, place, end turn) executed against the game state, logged with a clear human-readable description, and reversible.
2. As a player, I want to undo my most recent action via an Undo button in the top bar, so that the game state before that action is restored.
3. As a player, I want the Undo button disabled when there is nothing I can undo (nothing on top, or another player's action is on top and I'm not the GM).
4. As a player, I want Ctrl+Z to trigger undo and Ctrl+Y redo, matching standard desktop shortcuts.
5. As a player, I want a chain of linked sub-steps (e.g. an attack that deals damage, triggers retaliation, and routs) to undo in one click.
6. As a GM, I want to undo any player's most recent action, so that I can correct mistakes for the whole table.
7. As a session participant, I want the action log persisted in a `command_log` DB table so a full session can be replayed.
8. As a session participant, I want undo/redo to stay correct even when several players act concurrently, from different browsers, without any client keeping an undo stack.

## Solution

Every player action is a **command**: a `command_log` row whose `sub_steps` carry field-level `from`/`to` deltas against `units`, `team_alliances`, and `scenarios`. The DB is the only place undo/redo state is derived from — nothing is computed from a client mirror.

1. `execute_command` applies the deltas **and** inserts the log row in one transaction.
2. `undo_commands` reverts the live top chain (its `from` deltas) and soft-deletes the rows in one transaction.
3. `redo_commands` undeletes the newest deleted batch and re-applies its `to` deltas in one transaction.
4. `undo_state` computes "what can be undone/redone right now" from the log alone, so the client only needs a cache, never a stack.

The live top chain is ordered by a monotonic `command_log.seq` (no more `created_at`/uuid tie-breaks). Undo is sequential LIFO: only the global top chain may be undone, and only by its owner(s) or the GM.

## Implementation

### Migration 051: `command_log.seq`

```sql
ALTER TABLE command_log ADD COLUMN seq BIGSERIAL;
-- backfill by (created_at, id), then setval past the max
CREATE UNIQUE INDEX idx_command_log_seq ON command_log(seq);
CREATE INDEX idx_command_log_scenario_seq ON command_log(scenario_id, seq);
```

`seq` is the total order for the live top chain and the newest-deleted batch.

### Helpers (internal, no client grant)

- **`live_top_chain(p_scenario_id)`** → `uuid[]`: recursive walk from the max-`seq` live row down while rows are `chained`. Returns the chain anchored-first (ascending `seq`). NULL when the log is empty.
- **`newest_deleted_batch(p_scenario_id)`** → `uuid[]`: the rows of the most recent undo (`deleted_at` = MAX over deleted rows), ascending `seq`.
- **`unit_field_to_column(fld)`**: camelCase sub-step field → `units` column (mirrors `updateUnit()`). Unknown → NULL so callers fail loudly.
- **`apply_substeps(p_scenario_id, p_steps, p_use_to)`** (SECURITY DEFINER): applies each sub-step's deltas to the target table.
  - `p_use_to = true` (execute/redo): applies `to` values, steps in array order.
  - `p_use_to = false` (undo): applies `from` values, steps and changes in **reverse** order.
  - `ALLIANCE` step (`unitId` = team) → `team_alliances` upsert on `(scenario_id, team)`.
  - `SCENARIO` step → `scenarios` row: `current_turn_alliance` / `turn_number` / `free_move` (unknown field → `RAISE`). Always bumps `scenarios.updated_at` (keeps Lobby recency).
  - Unit step → per-change `UPDATE units SET <col> = <value>` via `format('%I' / '%L')` (text casts to the column type); `hex` expands to `hex_q/r/s`; `current_formation` also derives `organization_level`; bumps `units.updated_at`.
  - Unknown unit field → `RAISE EXCEPTION` (never silently skip).

### RPCs (SECURITY DEFINER, `SET search_path = public`)

- **`execute_command(p_scenario_id, p_player_id, p_player_name, p_action_type, p_description, p_sub_steps, p_chained)`** → `SETOF command_log`:
  1. `auth.uid() = p_player_id` (can't act as someone else).
  2. Caller is a participant; **ALLIANCE / SCENARIO sub-steps require the GM**.
  3. `apply_substeps(..., true)` then insert the log row (server-generated `id`, default `created_at`) — atomic.
  4. Returns the inserted row (realtime INSERT propagates it to every client).
- **`undo_commands(p_scenario_id, p_target_ids)`** → `SETOF command_log`:
  - Computes `live_top_chain`; rejects unless `p_target_ids` is exactly that chain (length + set equality). A stale client can never undo something that isn't the live top.
  - Permission: GM, or the caller owns every row in the chain.
  - `apply_substeps(..., false)` per row in `seq DESC`, then `deleted_at = now()` — atomic. Returns the rows ascending.
- **`redo_commands(p_scenario_id, p_target_ids)`** → `SETOF command_log`:
  - Redo target = `newest_deleted_batch` (LIFO across undo-then-undo chains).
  - Same length/set-ownership checks as undo.
  - **Invalidation**: rejected if any *live* command has `seq` greater than the batch's max (a new action anywhere clears redo).
  - `apply_substeps(..., true)` per row ascending, then `deleted_at = NULL` — atomic. Returns the rows.
- **`undo_state(p_scenario_id)`** → `jsonb` (STABLE): `{ undo: { ids, count, description, playerName, canUndo } | null, redo: { ids, count, description, playerName, canRedo } | null }`. `canUndo/canRedo` = GM, or the caller owns the whole chain/batch (redo also checks the invalidation rule). Participant-only.

### React Hook (`useGameEngine`)

- No `GameEngine` class. `engineRef` is gone; `src/game/GameEngine.ts` deleted.
- **`execute(...)`**: calls `execute_command`; on success applies the sub-step `to` deltas locally via `updateUnit`/`updateAlliance`/`updateScenarioField` (optimistic UI; realtime confirms), broadcasts the description, refreshes the undo cache. On rejection: error message, no state applied.
- **`undo()` / `redo()`**: call the RPC with the ids from the `undo_state` cache; on success apply `from`/`to` deltas optimistically (undo newest-first); on rejection show a message and refresh the cache — **nothing is pre-popped, so nothing needs reconciling**.
- **`undoState` cache**: set by `refreshUndoState()` (`undo_state` RPC), called on mount, on every `command_log` realtime INSERT/UPDATE (`subscribeToCommandLog` now just refreshes the cache), and after each action. `canUndo()`/`canRedo()`/`peekUndoChainLength()` read the cache synchronously.
- Types moved to `src/lib/commandLog.ts` (`ActionType`, `UnitChange`, `SubStep`, `CommandEntry`, `CommandLogRow`, `parseSubSteps`, `rowToEntry`, `UndoState`).

### Command log shape (unchanged from original)

```sql
CREATE TABLE command_log (
  id UUID PRIMARY KEY,
  scenario_id UUID NOT NULL REFERENCES scenarios(id) ON DELETE CASCADE,
  player_id UUID NOT NULL,
  player_name TEXT NOT NULL DEFAULT '',
  action_type TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  sub_steps JSONB NOT NULL DEFAULT '[]',
  chained BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  seq BIGSERIAL
);
```

RLS: `insert_own_action` (player_id = auth.uid()), `select_scenario_log` (participants), `update_own_or_gm`. All game writes go through the SECURITY DEFINER RPCs, which add their own participant/GM/ownership checks.

### Replay (unchanged)

`buildReplayTimeline` / `replayStateToUnits` / `useReplay` / `ReplayOverlay` build a net timeline from the log head (soft-deleted rows skipped), seeding units from PLACE payloads. `commandHistory.ts` keeps only these helpers plus `rowToEntry`/`parseSubSteps` (re-exported from `commandLog.ts`).

## Testing Decisions

The pure-`GameEngine` seam no longer exists (the undo logic lives in the RPCs). Client-side tests now cover the pure lib modules that remain:
- `src/lib/commandHistory.test.ts` — replay timeline (net of deleted rows, PLACE seeding, chained grouping), `parseSubSteps`/`rowToEntry`.
- The command apply/undo/redo RPCs are SQL — verified by running migration 051 against a local Supabase DB and exercising the four RPCs (unit/ALLIANCE/SCENARIO steps; chained chains; undo-then-undo → redo LIFO; redo invalidated by a new action; non-GM rejection of SCENARIO/ALLIANCE; ownership rules).

## Out of Scope

- Non-logged direct writes (e.g. the GM free-move toggle, `unit_templates` editing) remain outside the command log and stay non-undoable — same as before.
- Unit placement still inserts the unit row (`addUnitFromTemplate`) before logging PLACE; folding that insert into `execute_command` is possible future work.
- Per-entry undo buttons in the MessagesPanel — a single Undo button is sufficient.

## Further Notes

- `undo_stack_size` (migration 047) and `DEFAULT_UNDO_STACK_SIZE` are now unused (no client stack) and left in place; the client no longer caps history — the DB is the cap.
- Pre-051 rows have backfilled `seq` at the bottom of the chain. They are unreachable by normal undo (only the top chain is touched) and can be kept or cleared freely.
