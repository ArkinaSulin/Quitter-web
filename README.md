# QuiTTER — Quick Terrestrial Tactical Encounter Rules

A hex-map **mass-combat wargame for D&D 5e groups**. One GM and a handful of
players run big battles on a shared board — units, formations, cavalry,
heroes, morale and routing, spells, fog of war — in real time over the web.

**Stack:** Next.js 14 (TypeScript/React, Tailwind) · HTML5 canvas hex map ·
Supabase (Postgres + RLS + Realtime websockets).

## Run it

```bash
npm install
npm run dev        # http://localhost:3000
npm test           # vitest (pure rule-lib tests)
npx tsc --noEmit   # typecheck
```

Requires a Supabase project (see `src/lib/supabaseClient.ts` / `.env.local`)
with the schema + migrations under `supabase/migrations/` applied.

## Documentation

Documentation is reorganized under **`docs/`**:

- **[docs/README.md](docs/README.md)** — master menu.
- **[Technical menu](docs/dev/README.md)** — how the system works (for
  developers and future agent sessions): architecture, every subsystem
  (`moveCost`, `unitCombat`, `unitMorale`, effects, fog, replay, editors…),
  schema/migrations, command-log & undo, realtime. The code is canonical.
- **[Player manual](docs/players/player-manual.md)** — one book: how to play
  + rules reference + worked examples + GM chapters, ready to become the
  Word/PDF manual.
- **[Session changelog](docs/dev/changelog.md)** — append-only history of
  every work session (newest first).

The app is a single flow: the **Lobby** (`/`) → **Scenario Map**; plus four
authoring pages: **Unit Library** (`/unit-editor`), **Map Library**
(`/map-editor`), **Archfar's Shipyard** (`/ship-editor`, ship builder —
engine pending), and the **Effect Editor** (`/effect-editor`, reusable effect
templates). Roles gate everything: players browse read-only; DMs and admins
edit.

## Repo layout (quick map)

```
app/            routes (/, /unit-editor, /map-editor, /ship-editor, /effect-editor)
src/lib/        PURE game-rule modules (movement, combat, morale, effects,
                fog, routing/pursuit, weapon parsing, ship stats, …)
src/hooks/      React bridges (useGameEngine, useSupabaseSync, useReplay,
                useScenarios, useMessageSync, …)
src/components/ Lobby, UnitEditor, ScenarioMap/*, TokenRenderer/*,
                ShipEditor/*, MapEditor/*
src/types/      gameProtocol.ts (Unit, Formation, UnitTemplate, effects …)
supabase/       migrations/ 001…075 + RPCs + RLS
docs/           this documentation tree
```
