# Halloween Siege (minigame)

A DM-authored scenario minigame: weighted monster waves spawn at the grid rim on
Enemy turns. The DM then runs those monsters with the normal AI assist (or
manually). Everything else — combat, morale, fog, structures, undo/replay —
continues to work normally.

## Rules (implemented)

- Monsters spawn only into teams assigned to the **enemy** alliance. Neutral
  teams are never used by the siege (the AI planner does not target from
  neutral).
- Save & arm starts **Wave 1** on the next Enemy turn. Every wave lasts
  `turnsPerWave` Enemy turns; on each of those turns the wave's `count`
  monsters spawn (respecting the wave's percentages).
- After a wave, the siege pauses in **break**. The next wave does **not** start
  automatically: the DM must arm it from the top-bar banner. The armed start
  can be cancelled until the next Enemy turn begins.
- There is no break after the final wave; once its turns are spent the siege is
  complete and the badge disappears.
- If no team is assigned to the Enemy alliance while the siege is active, End
  Turn is blocked with a DM error until the DM assigns one in Alliances.
- Each wave's percentages must total exactly 100% before the window can save.
- When the wave's spawn turns are over and no living un-routed enemy remains,
  the GM broadcasts `Congratulations! You completed wave N.` once per wave.

## Wave timeline

Let `N = turnsPerWave`, `M = waves.length`, and `waveStartTurns[i]` be the
Enemy turn on which wave `i` actually began. Enemy turn numbers start at `1`.

```
activeIndex = largest i with waveStartTurns[i] != null and <= enemyTurnNumber
elapsed     = enemyTurnNumber - waveStartTurns[activeIndex]
```

- No started wave → `before` (no badge).
- `elapsed < N` → wave `activeIndex + 1`, turn `elapsed + 1 / N`.
- `elapsed >= N` and another wave exists → `break`, upcoming wave
  `activeIndex + 2`.
- `elapsed >= N` and this is the last wave → `complete`.

Break has **no fixed duration**. It persists across Enemy turns until the DM
arms the next wave. `nextWaveStartTurn` is only the armed start; the actual
`waveStartTurns[next]` is written when the Enemy turn begins.

The badge is shown for every player and is derived from the round's Enemy turn
number, so it stays stable through the friendly / enemy / neutral activations
of that round. It is hidden in free play (turn 0) and in replay.

Banner text:

| State | Text |
|---|---|
| Wave active | `wave: 2 turn: 1/3` |
| Break, not armed (DM can click to arm) | `wave: 2 turn: Will start` |
| Break, armed (DM can click to cancel) | `wave: 2 turn: break` |
| Complete | hidden |

The banner is a button only for the effective DM. Clicking arms or cancels
`nextWaveStartTurn`; the toggle is not undoable, but no wave starts until the
Enemy turn begins. Once the wave starts it cannot be cancelled.

## Persistence

`scenarios.halloween_siege` (JSONB, migration 133):

```ts
{
  enabled: boolean;
  turnsPerWave: number;
  waves: { id: string; count: number; entries: { templateId: string; percent: number }[] }[];
  waveStartTurns: (number | null)[]; // actual starts, one per wave
  nextWaveStartTurn: number | null;  // armed upcoming wave
  lastSpawnedTurn: number | null;
  announcedWave: number | null;      // completion-message dedupe
}
```

- Save & arm sets `waveStartTurns[0] = nextEnemyTurnNumber(...)`, clears
  `nextWaveStartTurn`, and resets `lastSpawnedTurn` / `announcedWave`.
- `nextWaveStartTurn` is set to `nextEnemyTurnNumber(...)` when the DM arms the
  next wave (or cleared on cancel). `beginNextWave` moves it into
  `waveStartTurns[next]` on the Enemy turn.
- `lastSpawnedTurn` prevents duplicate spawns across re-renders/reloads.
- `announcedWave` prevents duplicate completion messages.
- Settings are written with `updateScenarioField` (outside the command log),
  matching the other scenario toggles. Legacy configs with `nextSpawnAtTurn`
  are parsed into `waveStartTurns[0]`.
- Migration 133 must be applied in Supabase.

## Spawning

On an Enemy turn the GM client:

1. If `nextWaveStartTurn` is due, calls `beginNextWave` (actual start) and
   spawns that wave.
2. Otherwise, if `kind === 'wave'` and `lastSpawnedTurn !== turnNumber`, spawns
   the current wave.
3. If the wave's spawn turns are over and no living un-routed enemy remains,
   broadcasts the completion message once.

Spawn steps:

1. Enemy teams (`TEAMS` whose alliance is `enemy`) get the wave round-robin
   (e.g. 7 monsters over 2 teams → 4 / 3).
2. Loads `unit_templates` (hero templates excluded) and picks each monster by
   weighted percentage.
3. Picks free hexes from the grid rim (`hexRing(origin, gridRadius)`), falling
   back to inner rings if the rim is full.
4. Inserts each unit and logs a normal `PLACE` command, then posts a wave
   summary message.

Units are inserted client-side and logged one `PLACE` at a time (the same path
as the Unit Selector drop). The original insert is not itself in the command
log, so undo soft-deletes the placed unit; replay reconstructs it from the
`PLACE` payload. The wave marker is not undone.

## Files

- `src/packages/world/lib/halloweenSiege.ts` — parse/validate, phase math,
  arming/begin/toggle helpers, completion helper, weighted picks, team split,
  rim selection, spawn plans.
- `src/packages/world/tests/halloweenSiege.test.ts` — 18 unit tests.
- `src/components/ScenarioMap/HalloweenSiegeWindow.tsx` — DM configuration
  window (waves, percentages, drag/drop monster picker).
- `src/components/ScenarioMap/ScenarioMap.tsx` — load/save, End Turn guard, GM
  arming/spawn/completion effect, top-bar status.
- `src/components/ScenarioMap/TopBar.tsx` — public wave/turn badge and the
  DM-only arm/cancel button; Settings and Replay scenario live on the right.
- `src/hooks/useUnitTemplates.ts` — shared template fetch (used by the modal,
  spawner and Unit Selector).
- `supabase/migrations/133_halloween_siege.sql`.

## Limitations

- Spawns are not atomic and the markers are not part of the command log.
  Undoing the `PLACE` commands and redoing the End Turn will not respawn the
  wave; a failed spawn is not retried automatically (re-save the configuration
  to re-arm).
- Arming/cancelling and the completion marker are settings writes, not undoable
  commands. Once a wave starts it cannot be cancelled.
- Monsters are enemy-only by design.
- Hero templates are excluded because the AI never controls heroes.
- If the rim and all inner rings are full, only the available monsters spawn.
