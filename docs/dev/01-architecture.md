# 01 — Architecture & Data Flow

## App shell

A single-page feel with three authoring sub-pages. Routing is Next.js App
Router; there is **no multi-page game flow** — the Scenario Map is reached from
`/` once a `session` exists.

| Route | Page | Role | Access gate |
|---|---|---|---|
| `/` | `app/page.tsx` | `Home`: no session → `<Lobby>`; session `{scenarioId, replay}` → full-screen `<ScenarioMap>` | — |
| `/unit-editor` | `app/unit-editor/page.tsx` | Unit Editor / Unit Library | `canViewUnitEditor` view, `canUseUnitEditor` edit (`useProfile`) |
| `/map-editor` | `app/map-editor/page.tsx` | Map Library (reusable authored maps) | `canViewMapEditor` / `canUseMapEditor` |
| `/ship-editor` | `app/ship-editor/page.tsx` | Archfar's Shipyard (ship builder) | `canViewShipEditor` / `canUseShipEditor` |
| `/effect-editor` | `app/effect-editor/page.tsx` | Effect Editor (reusable effect templates) | `canViewEffectEditor` / `canUseEffectEditor` |
| `/weapon-editor` | `app/weapon-editor/page.tsx` | Weapon Editor (reusable weapons library) | `canViewWeaponEditor` / `canUseWeaponEditor` |

`app/layout.tsx` wraps everything in `MessageProvider` (the game-log
context), so Messages state survives page switches.

## Lobby

`src/components/Lobby.tsx` — scenario CRUD, presence badges, role-based
buttons, admin panel, settings. Data flows through `src/hooks/useScenarios.ts`
(`fetchScenarios`, `createScenario`, `joinScenario`, presence subscriptions,
`updateScenarioField`, screenshot refresh). Auth state comes from
`useAuth` (synchronous `INITIAL_SESSION` hydration), profiles/capabilities
from `useProfile`.

## Scenario Map (the big orchestrator)

`src/components/ScenarioMap/ScenarioMap.tsx` owns the live session:
- **State**: units (from `useSupabaseSync`), alliances (`useTeamAlliances`),
  participants/roles (`useParticipants`), scenario row (turn/free_move/room),
  pending-* confirm modals, reaction mode, replay.
- **Rendering**: `useHexGrid` canvas + `useCanvasDraw` (tokens, overlays, fog,
  ground shading) + `useOverlay` (reachable/charge/range overlays).
- **Actions**: pure libs are called from the click/drag handlers; results are
  applied by `useGameEngine.execute(...)`.

### The unit-state pipeline (every unit mutation)

```
UI handler ──► execute('ACTION', subSteps, description, {chained})
      │          │
      │          ├──► optimistic local apply of the sub-step deltas
      │          ├──► RPC execute_command(scenario_id, …)     (server)
      │          │       └─ apply_substeps writes units + log ATOMICALLY
      │          │          + realtime broadcast of the new command_log row
      │          ▼
      │     rows[0] (returned row incl. seq) ──► applyDeltas('to')
      │     refreshUnitsByIds(touched)   ← authoritative DB truth
      │     addMessage/addError; refreshUndoState
      ▼
   other clients: command_log INSERT realtime → re-derive + refetch
```

Undo/redo are the same shape via RPCs (`undo_commands`/`redo_commands`) and
`applyDeltas('from')`. **Detail:** `04-command-log-undo-redo.md`.

### Key hooks

| Hook | Job |
|---|---|
| `src/hooks/useGameEngine.ts` | Command entry point. `execute`, `undo`, `redo`, `endTurn`, all the typed actions (`moveUnitRecorded`, `performAttack` helpers, `rotateUnit`, `changeFormation`, `attachHero`…). Reads `undo_state` for the Undo/Redo buttons. |
| `src/hooks/useSupabaseSync.ts` | Units ↔ DB. Row↔`Unit` mapping (`mapRowToUnit`/`mapUnitToRow`), `updateUnit`, `placeUnit`, spawn from template, realtime `postgres_changes` handler, `commandSeq` ordering. |
| `src/hooks/useScenarios.ts` | Scenario CRUD, presence (DM online), join gate (`checkDMOnline`), screenshot upload trigger. |
| `src/hooks/useReplay.ts` | Replay timeline + co-watch (see `12-replay.md`). |
| `src/hooks/useTeamAlliances.ts` | `team_alliances` (team → friendly/enemy/neutral) with periodic refresh. |
| `src/hooks/useParticipants.ts` | `scenario_participants` roster (roles, teams) with periodic refresh. |
| `src/hooks/useProfile.ts` | Global `profiles` row + the `access_roles` capability matrix (module-cached). |
| `src/hooks/useMessageSync.ts` | Bridges local `MessageContext` to the shared `messages:{scenarioId}` broadcast channel. |
| `src/hooks/useMagicCast.ts`, `useCastActions.ts`, `useCombatActions.ts`, `useMoveActions.ts`, `useReactionActions.ts` | Split the click/drag flows into testable action hooks (cast window, attack requests, move handling, archer reaction). |

### Draw pipeline

`useHexGrid` renders hexes + captures mouse input; the actual token painting is
a `customDraw` callback (from `useCanvasDraw`) that `await`s each
`drawToken()` sequentially — one unit's `ctx.save()/rotate/restore` scope
completes before the next, so transforms never leak. The screenshot path
preloads every unique image URL into the module image cache before the loop so
the first capture is complete. See `15-token-rendering.md`.

## The left panel (tabbed, dockable)

`src/components/ScenarioMap/LeftPanel.tsx` declares tabs declaratively:
Map (GM) · Movement (GM) · Effects (GM) · Players (GM) · Alliances (GM) ·
Unit Selector (GM) · Messages (all) · Undo debug (all).
`PanelsContainer.tsx` renders the tab bar + stacked panels, resize handles and
the dock toggle (left/right edge). A new tab = one entry in the `panels` array.
`ScenarioMap` passes GM-ness via `requiresGM`.

## Message bus

`src/contexts/MessageContext.tsx`: `messages: GameMessage[]` where
`GameMessage = { text, tone: 'default'|'error' }`. `addMessage` (normal) and
`addError` (rendered red) — the latter is used by every soft-enforcement
over-budget notification. Messages panel auto-scrolls; rows can be copied.

## Concurrency model (short form)

- **Command log is the timeline.** Units are a projection of `command_log`
  plus live placements. Realtime publishes `command_log`, `scenarios`,
  `units`?, `team_alliances`, `scenario_participants`, and a set of broadcast
  channels (`messages:`, `replay:`, magic-cast placement, ping).
- **Soft locks:** dragging locks the unit so other clients don't fight the
  drag; DM presence (`dm_heartbeat_at`, RPC every ~5s) drives the "GM has
  left" control lock. Polling fallbacks (10s + window focus) refresh
  participants/alliances when realtime events are missed.
- See `05-realtime-concurrency.md` for the full channel inventory.

## Screenshot flow

On GM exit (`ScenarioMap.tsx`), the map is zoomed to content, drawn to a
canvas blob, and uploaded to the `scenario_screenshots` bucket under
`scenario_{id}.png` (upsert). Lobby cards show the latest thumbnail.

## Invariants worth knowing

- A unit is never hard-deleted; delete writes `isDeleted` (undo restores).
- Units store denormalized display names/urls (race/armor/mount copied from the
  template) so replay and spawning never need a live join.
- All rule numbers come from pure libs — never re-derive them in components.
