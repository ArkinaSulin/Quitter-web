# 06 — Turn System

## Model

- One **scenario turn** is one full cycle of the active alliance groups.
- Cycle order: **friendly → enemy → neutral**, skipping any group that has no
  team assigned in `team_alliances` (`getActiveGroups`). Teams default to
  `friendly` (migration 054 seeds friendly rows), so friendly is always active
  and a fresh scenario cycles friendly → friendly.
- `scenarios.current_turn_alliance`: `null` = **free play** (turn 0), or one of
  the three groups. `scenarios.turn_number`: increments **only** when a full
  cycle wraps, or when leaving free play into Turn 1.
- Pure helpers: `src/lib/turnState.ts` (`ALLIANCE_ORDER`, `getActiveGroups`,
  `advanceTurn` → `{ next, wrapped }`), 11 cases tested in `turnState.test.ts`.

## Free play (turn 0)

- New scenarios start with `free_move = true` and `current_turn_alliance =
  null`. Everything is set-up: role-scope gates only, moves cost no resources,
  formation changes/rotates free.
- GM End Turn while `free_move` on a null turn = **leaving free play**: sets
  `current_turn_alliance = friendly`, `turn_number = 1`, `free_move = false`
  (all in one `END_TURN` SCENARIO step so undo restores free play). If the DM
  re-enables free move manually later, ending from there behaves the same.

## The End Turn button

- Enabled for the **GM always**; for players only when their alliance holds the
  turn: `isGM || (currentTurnAlliance !== null && myAlliance ===
  currentTurnAlliance)`. Free play (null) is GM-only. Server re-validates
  (SCENARIO steps are GM-only for non-holders; migration 052 relaxed END_TURN's
  SCENARIO step so a player on their own alliance can end it).
- Label colors by the active group (friendly blue / enemy red / neutral gray).
- In free play the label reads "End Turn (Free Play)".

## One `END_TURN` command does:

1. **SCENARIO sub-step** → `current_turn_alliance = next`, `turn_number` (on
   wrap/free-play exit), `free_move=false` on exit.
2. **Charge forfeit** → every unit in the *ending* group still `isCharging`
   clears its charge and drops one organization level (`CHARGE_END` steps).
3. **Reset the *next* group** (the one about to act) — per unit on a team of
   that group:

   | Type | turn start state |
   |---|---|
   | Hero | `movementPointsAvailable` = full effective max, `actionsAvailable` = 5 (`hero_actions_per_turn`), `attacksUsed` = 0 |
   | Unit | MP = `turn_start_mp` (0), actions = `actions_per_turn` (2), `attacksUsed` = 0 |
   | Both | `archerReactionUsed = false` (revives the reaction bow) |

4. **Effect sweep** (`computeEndTurnEffects`, see `10-temporary-effects.md`)
   → DoT damage/expiry for effects whose caster is in the incoming group,
   folded in as `EFFECT` sub-steps of the same command (undo restores them).
5. Scenario realtime broadcast → all clients see the new turn state.

`endTurn` returns the absolute `newTurnNumber`; `handleEndTurn` sets it
explicitly (idempotent — avoids double-increment races with the realtime
UPDATE).

## Scenario settings toggles (GM, Scenario Settings modal)

`scenarios` columns toggled live (each an `updateScenarioField` + SCENARIO or
direct scenario update — see `useScenarios.updateScenarioField`):
- `archer_reaction_enabled` — opportunity fire on/off (see `08`).
- `mounted_charge_enabled` — Charge! availability for mounted (see `08`).
- `verbose_combat` — per-scenario roll detail in messages (`verboseCombat.ts`).
- `fog_of_war` + `sight_radius` — see `11-fog-of-war.md`.

## Permission gates recap (turn-aware)

`canActOnUnit` (scenarioPermissions) — free play/free-move: role scope only;
Turn 1+: player may only act on units of the current alliance during that
alliance's turn. GM bypasses. See `03`.
