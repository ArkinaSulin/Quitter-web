# 04 — Command Log, Undo/Redo (Server-Authoritative)

## Why it exists

Every game mutation goes through **one shared pipeline** so that undo is always
legal, replay is exact, and clients can never drift from the DB. The command
log is the *timeline*; units/alliances/scenario rows are a *projection* of it.

```
UI handler → execute(type, subSteps, description, {chained})
   → RPC execute_command(scenario_id, action_type, description, sub_steps, chained)
        server: apply_substeps (same transaction as the log row)
        server: returns the row (incl. seq) → optimistic local apply + refresh
   → command_log INSERT broadcast → all clients refetch touched units
Undo/Redo → RPC undo_commands / redo_commands → inverse apply → refetch
```

## Vocabulary

- **Command row** (`command_log`): one logical action. Columns:
  `id`, `scenario_id`, `player_id`, `player_name`, `action_type`,
  `description`, `sub_steps jsonb`, `chained bool`, `created_at`,
  `deleted_at` (soft delete = undone), `seq BIGSERIAL` (total order).
- **Sub-step** (`SubStep` in `src/lib/commandLog.ts`): `{ type, description,
  unitId, changes: UnitChange[], payload? }`. A command usually has 1–N
  sub-steps (e.g. ATTACK may carry `ATTACK` action/attack-cap deltas,
  `DAMAGE` hp/troop deltas on both units, plus chained ROUT).
- **`UnitChange`**: `{ field, from, to }` — a camelCase unit field delta. The
  server maps it through the `unit_field_to_column()` allowlist; SCENARIO and
  ALLIANCE sub-steps change `scenarios`/`team_alliances` rows instead.
- **`chained`**: marks a command as a direct consequence of the previous one
  (e.g. a MOVE that routes units → each ROUT chained to the MOVE). Undo
  collects the top chain (a `chained=false` root + its consecutive
  `chained=true` followers) and reverts the whole batch in one call.

## Server-side application (`execute_command`, migration 051)

- Requires the caller to be a **participant** of the scenario.
- `ALLIANCE` and `SCENARIO` sub-steps are **GM-only** (they write
  `team_alliances` / `scenarios`).
- `apply_substeps` writes unit deltas + the log row **in one transaction**;
  unknown fields `RAISE` (never silently dropped). Undoing replays `from`
  deltas in **reverse order**.
- `created_at`/`updated_at` are maintained on target tables (keeps Lobby
  recency ordering).

## Undo / Redo RPCs

- **`undo_state`** (read-only): derives `{undo:{ids,count,description,
  playerName,canUndo}, redo:{...}}` from the log alone. Drives the Undo/Redo
  buttons — there is **no client stack** (the old `GameEngine` stack was
  deleted; `undo_stack_size` setting 047 is unused now but harmless).
- **`undo_commands(p_scenario_id, p_target_ids)`**: recomputes the *live top
  chain* from the log (walk back from the last `deleted_at IS NULL` row
  through consecutive `chained`), rejects unless `p_target_ids` matches that
  chain exactly, rejects unless the caller is the GM or owns every row, then
  soft-deletes + applies the inverse deltas. Idempotent.
- **`redo_commands`**: redo target = the newest soft-deleted batch; owner-or-GM;
  **invalidated when any live command has `seq` above the batch's max** (a new
  action clears redo). LIFO-correct across undo-then-undo.
- A rejected undo no longer corrupts anything: it just shows "Cannot undo —
  another player has moved since…" and refreshes `undo_state`.

## Chain semantics examples

```
MOVE (chained=false) → ROUT(A) (chained=true) → ROUT(B) (chained=true)
   one undo reverts all three (the cascade from one move).
MOVE → MOVE → ROUT(true): 1st undo reverts ROUT+MOVE; 2nd undo reverts the
   first MOVE alone.
```

## Client hooks

- `src/hooks/useGameEngine.ts`: `execute(...)` optimistic-applies sub-step
  deltas, calls the RPC, then `refreshUnitsByIds` from the authoritative rows
  returned/refetched; refreshes `undoState` (mount + each command_log realtime
  INSERT/UPDATE + after every action). `undo`/`redo` mirror this with
  `applyDeltas('from')`.
- Command-log realtime subscription appends remote rows so every client tracks
  the same global timeline (which enforces sequential LIFO undo).
- `UndoDebugPanel` (left-panel tab) renders the log oldest→newest with
  `---`/`undid` status from `deleted_at`, live.

## Replay reads the same log

`buildReplayTimeline(rows)` (see `12-replay.md`) skips `deleted_at` rows,
sorts by timestamp, groups root+chained into beats, and folds sub-step deltas
to per-unit state. PLACE sub-steps carry a full unit `payload` snapshot so no
baseline/template lookup is needed.

## Action types (the vocabulary)

`ActionType` in `src/lib/commandLog.ts`: MOVE · ROTATE · FORMATION · TEAM ·
HIDE · TOGGLE_HIDE · PLACE · ATTACK · DAMAGE · HEAL · ROUT · DELETE · ALLIANCE
· ATTACH_HERO · DETACH_HERO · SWAP_HERO_POSITION · END_TURN · SCENARIO ·
CHARGE · CHARGE_END · WEAPON_SELECT · CAST · EDIT_UNIT · EFFECT ·
ARCHER_REACTION.

## Key invariants

- One logical action = one command row; undo reverts whole chains only.
- Units and the log can never diverge (same transaction).
- Undo is "rewind", never a counter-action — it replays stored `from` values.
- A unit DELETE writes `isDeleted` (undo restores it); there is no hard delete
  from normal play.
