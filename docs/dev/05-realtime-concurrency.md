# 05 — Realtime & Concurrency

Supabase Realtime is used three ways: **postgres_changes** (DB row events),
**broadcast channels** (ephemeral events like chat/log lines and replay
cursor), and **presence** (who's online). Plus deliberate polling fallbacks.

## Channel inventory

| Channel | Kind | Purpose | Subscribers |
|---|---|---|---|
| `presence:{scenarioId}` | presence | Lobby "DM Online/Offline" badge; join gate (`checkDMOnline`) | lobby + map clients |
| `realtime: postgres_changes` on `command_log` | postgres_changes | Every client sees executed/undone commands → reaction offers, undo-state refresh, debug panel | map clients |
| `realtime: postgres_changes` on `scenarios` | postgres_changes | Turn counter / current alliance / free_move / settings toggles | map clients |
| `realtime: postgres_changes` on `units` | postgres_changes | Direct unit row changes (GM stat edit etc.); command-driven writes arrive via the command_log path + refetch | map clients |
| `realtime: postgres_changes` on `team_alliances` / `scenario_participants` / `replay_state` | postgres_changes | Alliance/roster/replay-state changes | map clients |
| `messages:{scenarioId}` | broadcast (`self:false`, event `game-message`) | Global game log lines (combat, rout, move, undo, errors) — see `useMessageSync` | map clients |
| `replay:{scenarioId}` | broadcast (event `mode`) | Replay co-watch: pass-the-clicker, follow seeks, "controller is driving" | map clients |
| Magic-cast channel | broadcast | Placed area shape + rotation synced while the caster aims | map clients |
| Ping/lock channel | broadcast | `usePing` ephemeral attention rings; unit drag soft-lock | map clients |

**Shared-registry pattern**: broadcast channels are registered once per
(scenario, topic) in a module-level registry and reused, so a subscriber
reconnect can't double-register and received broadcasts dispatch exactly once.
This is the pattern in `useMessageSync` (messages) and `useReplay`
(replay). Pre-subscribe messages buffer and flush on `SUBSCRIBED`.

## DM presence & the join gate

- The **lobby** subscribes one read-only presence channel per scenario and
  flips `dmOnlineByScenario[id]` as a GM enters/leaves → "Room Open / Closed"
  badge on cards (plus a separate DB `room_open` state).
- `joinScenario` calls `checkDMOnline(scenarioId)`: it **reuses the existing
  lobby presence channel** (`presenceState()` + short poll) instead of opening
  a second channel on the same topic — opening a duplicate topic then calling
  `channel.on('presence')` after `subscribe()` throws, which used to make
  joins silently fail.
- **In a scenario**, every client subscribes to the map presence channel; if
  the GM's presence leaves, non-GM clients set `dmGone → controlsLocked`
  (read-only: no drag/attack/context, Undo/End Turn hidden, left panel hidden,
  modals no-op; pan/zoom/tooltip/Exit stay). Hard-disconnect detection is the
  server default (~20 s); graceful exits are instant.
- **DM heartbeat**: the GM also writes `scenarios.dm_heartbeat_at` every ~5s
  via an RPC (migration 057); clients poll it as a cross-check for the DM
  being alive (used by the lobby badge + join gate fallback).

## Polling fallbacks

`postgres_changes` delivery has proven unreliable for some tables in this
stack, so the app does not trust it alone:
- `useTeamAlliances` / `useParticipants`: re-fetch every 10 s and on window
  focus/`visibilitychange` → team/alliance/role changes catch up within
  seconds regardless of realtime delivery.
- `UndoDebugPanel`: realtime + 5 s interval + focus.
- If realtime stops firing for a table, check publication membership:
  ```sql
  SELECT tablename FROM pg_publication_tables
  WHERE pubname='supabase_realtime' AND schemaname='public';
  ```

## The unit drag soft-lock

When a client starts dragging a unit it broadcasts a lock (unit id + user).
Other clients disable their own drag on that unit until the lock releases (drop
or timeout). This prevents two people fighting over the same token. Note the
map is otherwise **not** turn-constrained for input capture — the *permission
gates* (`03`) decide whether an action is legal; a simultaneous conflicting
action is resolved by the server (last `seq` wins the authoritative write).

## Messages (game log) sync

`src/hooks/useMessageSync.ts`:
- Local producers call `MessageContext.addMessage/addError`.
- The hook mirrors every message onto the `messages:{scenarioId}` broadcast
  channel (`self:false`) and forwards inbound messages into the same context.
- Because a shared registry holds one channel per scenario, a message produced
  on your own client broadcasts to others but is not re-added locally
  (self:false), and every client renders the same log.

## Concurrency invariants

- **Single writer for rules**: commands go through `execute_command`; the DB is
  authoritative and the returned rows drive every client's refetch.
- **Replay drives itself**: co-watch broadcasts the mode/cursor; the persisted
  `replay_state` row (debounced upsert) lets late joiners land in replay too.
- Avoid opening two Supabase channels with the same topic for different
  purposes — `channel()` reuses by topic and mixing `presence`/`broadcast`/
  `postgres_changes` bindings on one joined channel is the source of several
  past bugs.
