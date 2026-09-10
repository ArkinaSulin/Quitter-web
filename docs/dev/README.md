# QuiTTER — Technical Menu

How the system actually works. Each chapter below explains one subsystem: its
role, the mechanics (as implemented), the key files, the database/migrations
that back it, and the invariants/tests that keep it honest.

> **Canonical source:** the code. Every chapter was written against `src/lib`,
> `src/hooks`, `src/components`, and `supabase/migrations`. If prose here
> disagrees with code, the code wins — update this doc.
>
> **Numbers:** settings defaults quoted here match the code fallbacks AND the
> migration seeds (`supabase/migrations/041…060`). Formation-row numbers that
> live only in the live DB are flagged "verify against `formations` table".

---

## System map (start here)

```
                    ┌────────────────────────────────────────────────┐
   Browser          │ Next.js 14 app                                 │
 ┌──────────┐       │                                                │
 │ Lobby    │──────►│  /  (Scenario Map)                             │
 │ /unit-editor    │    useHexGrid  (canvas)                         │
 │ /map-editor      │    ScenarioMap  (orchestrator)                 │
 │ /ship-editor     │      ├─ useOverlay / useCanvasDraw (draw)      │
 └──────────┘       │      ├─ useGameEngine  (commands)              │
                    │      ├─ useSupabaseSync (units ↔ DB)           │
                    │      └─ useReplay (timeline)                   │
                    │                                                │
                    │  Pure rule libs: moveCost · unitCombat ·       │
                    │  unitMorale · formationRules · unitEffects ·   │
                    │  fogOfWar · routedRetreat · spellDamage · ...  │
                    └──────────────────┬─────────────────────────────┘
                                       │  REST + Realtime (ws)
                              ┌────────▼─────────┐
                              │  Supabase         │
                              │  Postgres + RLS   │
                              │  RPCs (SECURITY   │
                              │  DEFINER):        │
                              │  execute_command, │
                              │  undo/redo,       │
                              │  undo_state       │
                              └───────────────────┘
```

Two big ideas make the whole system coherent:

1. **One action = one `command_log` row** carrying sub-step field deltas.
   Every mutation (move, attack, formation, effect tick, end turn…) is a row;
   the server applies the deltas and the log update **in one transaction**
   (`execute_command`). Undo/redo soft-delete/restore rows. Replay is a pure
   function of the surviving rows. See `04-command-log-undo-redo.md`.
2. **Rules are data-driven + cached.** `formations`, `settings` (JSONB),
   `access_roles`, `scenario_role_capabilities`, `size_categories` are all
   lookup tables read through session caches; code fallbacks keep behavior
   correct before the first fetch. See `03-access-permissions.md`,
   `08-combat.md`, `14-editors.md`.

---

## Chapter index

| # | Chapter | What it explains | Key files (start here) |
|---|---|---|---|
| [01](01-architecture.md) | Architecture & data flow | Routes, layout, the unit/command lifecycle, optimistic apply + realtime confirm, screenshot flow | `app/page.tsx`, `src/components/ScenarioMap/ScenarioMap.tsx`, `src/hooks/useSupabaseSync.ts` |
| [02](02-schema-and-migrations.md) | Schema & migrations | Every table; migration 001→075 with **applied / awaiting-DB** status; RLS & RPC inventory | `supabase/migrations/*`, `src/types/gameProtocol.ts` |
| [03](03-access-permissions.md) | Access, roles & permissions | Global `profiles`/`access_roles`; per-scenario `scenario_role_capabilities` + `scenario_permissions.ts` gates | `src/lib/scenarioPermissions.ts`, `src/hooks/useProfile.ts`, migrations 016/025/030/050/059/074 |
| [04](04-command-log-undo-redo.md) | Command log, undo/redo | Sub-steps, `apply_substeps`, chains, `seq`, undo/redo RPCs, soft delete, redo invalidation | `src/lib/commandLog.ts`, `src/lib/commandHistory.ts`, migration 051 |
| [05](05-realtime-concurrency.md) | Realtime & concurrency | Presence (lobby DM badge, `dm_heartbeat`), broadcast channels, postgres_changes, polling fallbacks, shared registries | `src/hooks/useScenarios.ts`, `useMessageSync.ts`, `useReplay.ts`, migration 052/057 |
| [06](06-turn-system.md) | Turn system | Alliance cycle friendly→enemy→neutral, free play (turn 0), END_TURN resets, turn counter | `src/lib/turnState.ts`, `src/hooks/useGameEngine.ts` |
| [07](07-movement-economy.md) | Movement economy | Reachable map (wedge/grey), 1-action = 1 pool, hero proration, terrain MP, formation multipliers, charge corridor | `src/lib/moveCost.ts`, `src/lib/formationCost.ts` |
| [08](08-combat.md) | Combat resolution | AGR, reach & simultaneity, arcs matrix, row/attack capacity, damage, hero split/caps, magic/heal, reactions | `src/lib/unitCombat.ts`, `unitStats.ts`, `formationRules.ts`, `spellDamage.ts`, `archerReaction.ts` |
| [09](09-morale-routing-pursuit.md) | Morale, routing & pursuit | Threat rating & ratios, effective morale, rout trigger, retreat/rout-through, mandatory pursuit, rally | `src/lib/unitMorale.ts`, `routedRetreat.ts`, `formationCost.ts` |
| [10](10-temporary-effects.md) | Temporary effects | Buff/debuff/DoT semantics, ground zones, caster-activation clock, END_TURN fold-in | `src/lib/unitEffects.ts`, `src/lib/commandLog.ts`, migration 073 |
| [11](11-fog-of-war.md) | Fog of war & visibility | Graded reveal, darkvision, per-alliance view, attack gate, replay follow | `src/lib/fogOfWar.ts`, `src/hooks/useCanvasDraw.ts`, migrations 071/072 |
| [12](12-replay.md) | Replay | Timeline from command log, co-watch, persisted cursor, replay overlay | `src/lib/commandHistory.ts`, `src/hooks/useReplay.ts`, `ReplayOverlay.tsx`, migrations 019/024/052 |
| [13](13-map-entities-terrain.md) | Maps, terrain & map_data | Reusable `maps`, terrain entry costs (0 MP free), snapshot into scenario, layered persistence | `src/lib/mapEntities.ts`, `src/components/MapEditor/*`, migration 074 |
| [14](14-editors.md) | Editors & data mappers | Unit Editor, weapon CSV string, template/unit mappers, size/visual rules | `src/lib/templateMappers.ts`, `weaponParser.ts`, `src/components/UnitEditor.tsx` |
| [15](15-token-rendering.md) | Token rendering | Token anatomy, team shapes, dots/hearts/action badge, formation layouts, hero tokens, effect pips | `src/components/TokenRenderer/drawToken.ts`, `tokenUtils.ts` |
| [16](16-ship-builder.md) | Ship builder (Shipyard) | Ship stats engine (v8.1 FINAL) + editor/renderer — **engine pending**, devs only | `src/lib/shipStats.ts`, `src/types/ship.ts`, `src/components/ShipEditor/*`, migrations 059/066–070 |
| [17](17-enemy-ai.md) | AI assist (enemy AI) | GM plotting tool: planner gates, preview routes, execute-through-action-path, undo macro | `src/lib/enemyAI/*`, `src/components/ScenarioMap/{AiPanel,aiTypes,useCanvasDraw}.ts(x)`, migration 076 |
| — | [changelog](changelog.md) | Session history (newest first) | append-only |
| — | [outstanding](outstanding.md) | Forward-looking backlog / roadmap for next sessions | statuses: next / later / blocked |
| — | [legacy/HANDBOOK.md](legacy/HANDBOOK.md) | Archived pre-reorg technical doc | read for history only |

## Cross-cutting quick references

- **Weapon CSV string** (single source of truth for weapons on units): see
  `14-editors.md` → "weapon string format". `src/lib/weaponParser.ts`.
- **Action types** (the command vocabulary): `ActionType` in
  `src/lib/commandLog.ts`.
- **Settings keys** (JSONB, editable by an admin in the Lobby → Settings):
  `settingsCache.ts` fallbacks + migrations 041/042/047/049/053/060. The menu
  chapter for each rule cites the exact key.
- **Migration status** (which are applied vs awaiting the DB): `02` chapter
  table.
- **Permission matrix**: `docs/players/player-manual.md` §12 and
  `03-access-permissions.md`.

## How to add a feature (suggested order)

1. Read the affected rule chapter(s) and the newest changelog entries.
2. Change the pure lib + its test first (`src/lib/x.ts` + `x.test.ts`).
3. Wire through `useGameEngine`/`useSupabaseSync` + the ScenarioMap action flow.
4. If a new field or table is needed, write a migration (see `02` for the
   pattern + the `unit_field_to_column` allowlist in `apply_substeps`).
5. Prepend a changelog entry describing the change with a Files line.
