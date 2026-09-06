# 12 — Replay (Read-Only Playback)

Replay is a **pure function of the command log**: `buildReplayTimeline(rows)`
(`src/lib/commandHistory.ts`) skips soft-deleted (undone) rows, sorts by
timestamp, groups each root command with its `chained` followers into a
"beat", and folds the sub-step deltas into per-unit / per-alliance /
per-scenario state. PLACE sub-steps carry a full unit snapshot in `payload`,
so replay starts from an empty world and never needs live templates or a
baseline. Each beat stores a `ReplayState` snapshot.

## Entry modes

1. **Standalone**: Lobby → "Replay Scenario" opens the map with `replayMode`.
2. **In-session**: the GM toggles "Replay scenario" in the live top bar,
   flipping the whole session into replay ("Back to Play" returns).
   `useReplay` exposes `mode: 'play' | 'replay'`; ScenarioMap swaps its display
   via `displayUnits/displayAlliances/displayTurnNumber` and follows the acting
   alliance's fog.

## Playback (`src/hooks/useReplay.ts`)

- `cursor` (index into the timeline), `playing`, `speed` (0.5/1/2/4).
- Play / Pause, seek (slider), frame-step ◀ ▶.
- `replayUnits` / `replayAlliances` / `replayTurnNumber` at the cursor
  (0 = empty world).
- `turnOneIndex` = first step whose state has `turn_number ≥ 1`; the overlay
  draws a small amber ▲ under the slider there.
- Late joiners auto-enter replay: `useReplay` reads the persisted
  `replay_state` row (mode + cursor + playing) on mount and applies the cursor
  once the timeline loads.

## Co-watch (shared-registry broadcast)

The shared-registry broadcast channel `replay:{scenarioId}` is used for live
sync:
- "Pass the clicker": anyone (with the view permission) can grab control;
  others **follow** seeks but keep their own speed.
- The `mode:'replay'` broadcast handler mirrors the local setMode (resets
  cursor/playing + bumps `reloadKey`) — fixes players landing on an empty 0/0
  timeline when the DM enters replay.
- Local mode/cursor/playing are **debounced-upserted** to `replay_state`
  (skipped for broadcast-derived state to avoid self-echo). A live realtime
  subscribe on `replay_state` was deliberately dropped — it fought an actively
  playing local clock; the broadcast channel handles live sync.

## Read-only

While in replay: `controlsLocked` — no drag/attack/context menu/undo/keyboard/
modals; pan/zoom/tooltip/Exit stay. The read-only path is shared with the
DM-gone lock (`useHexGrid.readOnly`). Pending users can replay (`canViewReplay`,
migration 024 extended SELECT to pending profiles; the "GM has left" banner is
suppressed in replay because pending viewers have no live controls anyway).

## ReplayOverlay UI

Amber REPLAY frame + banner; bottom playback bar: play/pause, scrubber,
frame-step, speed, and "controller is driving / step N of M"; "Back to Play"
+ "Exit to Lobby" buttons (top bar). Persisted via `replay_state` table
(migration 052).
