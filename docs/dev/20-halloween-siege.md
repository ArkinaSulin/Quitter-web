# Halloween Siege (minigame)

A DM-authored scenario minigame: weighted monster waves spawn at the grid rim on
Enemy turns. The DM then runs those monsters with the normal AI assist (or
manually). Everything else — combat, morale, fog, structures, undo/replay —
continues to work normally.

## Rules (implemented)

- Monsters spawn only into teams assigned to the **enemy** alliance. Neutral
  teams are never used by the siege (the AI planner does not target from
  neutral).
- The siege is armed from the DM's **Scenario Settings → Minigames → Halloween
  Siege** window. Saving a valid configuration arms it from the next Enemy turn.
- A wave lasts `turnsPerWave` Enemy turns. On every one of those turns, the
  wave's `count` monsters spawn (respecting the wave's percentages).
- A single **break turn** follows each wave: no spawns, the badge reads
  `wave: [next wave] turn: break`.
- There is **no break after the final wave**. Once the last wave's turns are
  spent, the siege is complete and the wave badge disappears.
- If no team is assigned to the Enemy alliance while the siege is active, End
  Turn is blocked with a DM error until the DM assigns one in Alliances.
- Each wave's percentages must total exactly 100% before the window can save.

## Wave timeline

Let `N = turnsPerWave`, `M = waves.length`, and `A = nextSpawnAtTurn` (the
first Enemy turn of the siege). Enemy turn numbers start at `1`.

```
E = enemyTurnNumber - A
cycleLength = N + 1            (N spawn turns + 1 break)
total = M * cycleLength - 1    (no trailing break)
waveIndex = floor(E / cycleLength)
position  = E % cycleLength
```

- `E < 0` → `before` (no badge).
- `E >= total` → `complete` (no badge).
- `position < N` → wave `waveIndex + 1`, turn `position + 1 / N`.
- `position === N` → break, upcoming wave `waveIndex + 2`.

The badge is shown for every player (not just the DM) and is derived from the
round's Enemy turn number, so it stays stable through the friendly / enemy /
neutral activations of that round. It is hidden in free play (turn 0) and in
replay.

## Persistence

`scenarios.halloween_siege` (JSONB, migration 133):

```ts
{
  enabled: boolean;
  turnsPerWave: number;
  waves: { id: string; count: number; entries: { templateId: string; percent: number }[] }[];
  nextSpawnAtTurn: number | null;
  lastSpawnedTurn: number | null;
}
```

- `nextSpawnAtTurn` is recomputed on Save: `turnNumber + 1` in free play, the
  current round's `turnNumber` during a friendly turn, and `turnNumber + 1`
  during an enemy/neutral turn.
- `lastSpawnedTurn` is the idempotency marker. The GM writes it before spawning
  so a re-render, reload, or End Turn redo cannot duplicate the wave. It is not
  undone with the command log.
- Settings are written with `updateScenarioField` (outside the command log),
  matching the other scenario toggles. The migration must be applied in
  Supabase.

## Spawning

On an Enemy turn with `kind === 'wave'` and `lastSpawnedTurn !== turnNumber`,
the GM client:

1. Computes the enemy teams (`TEAMS` whose alliance is `enemy`) and distributes
   the wave round-robin (e.g. 7 monsters over 2 teams → 4 / 3).
2. Loads `unit_templates` (hero templates are excluded) and picks each monster
   by weighted percentage.
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
  weighted picks, team split, rim selection, spawn plans.
- `src/packages/world/tests/halloweenSiege.test.ts` — 11 unit tests.
- `src/components/ScenarioMap/HalloweenSiegeWindow.tsx` — DM configuration
  window (waves, percentages, drag/drop monster picker).
- `src/components/ScenarioMap/ScenarioMap.tsx` — load/save, End Turn guard, GM
  spawn effect, top-bar status.
- `src/components/ScenarioMap/TopBar.tsx` — public wave/turn badge.
- `src/hooks/useUnitTemplates.ts` — shared template fetch (used by the modal,
  spawner and Unit Selector).
- `supabase/migrations/133_halloween_siege.sql`.

## Limitations

- Spawns are not atomic and the marker is not part of the command log. Undoing
  the `PLACE` commands and redoing the End Turn will not respawn the wave; a
  failed spawn is not retried automatically (re-save the configuration to
  re-arm).
- Monsters are enemy-only by design.
- Hero templates are excluded because the AI never controls heroes.
- If the rim and all inner rings are full, only the available monsters spawn.
