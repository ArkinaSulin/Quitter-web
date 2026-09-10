# QuiTTER — Documentation

QuiTTER ("Quick Terrestrial Tactical Encounter Rules") is a hex-map mass-battle
wargame for D&D 5e groups. One home page (`/` = Lobby → Scenario Map) plus three
authoring pages (Unit Library, Archfar's Shipyard ship builder, Map Library) on a
Next.js 14 + Supabase stack.

This tree is the single home for all documentation. It has two audiences:

| Menu | Audience | Content |
|---|---|---|
| [`dev/`](dev/README.md) — **Technical menu** | Developers & future agent sessions | How the system actually works: architecture, every subsystem, schema, migrations, command/undo pipeline, realtime sync. Written **from the code**, with `file:line` pointers. |
| [`players/player-manual.md`](players/player-manual.md) — **Player manual** | Players & GMs | Instructions + rules reference + worked examples. One book, sized to become the Word/PDF manual. GM-only rules are flagged. |
| [`dev/changelog.md`](dev/changelog.md) — **Session changelog** | Developers | Reverse-chronological log of every work session (was `handover.md`). Append here at the end of each session. |
| [`dev/outstanding.md`](dev/outstanding.md) — **Backlog / roadmap** | Developers | What's left to build (effects images, Full AI, Spelljammer engine, docs refresh, migrations). |

## Reading order

- **Players:** open the [player manual](players/player-manual.md). Its table of
  contents and the screenshot manifest are at the top of the file.
- **New developer / agent session:** read the [technical menu](dev/README.md)
  first, then the specific subsystem chapter you touch.
- **Continuing work:** skim the top entries of the
  [changelog](dev/changelog.md) for the most recent state, then the relevant
  technical chapter. The code is always canonical — a doc that disagrees with
  `src/lib` is wrong.

## How this documentation is maintained

- **Rules chapters must match code.** Every numeric rule in these docs was
  verified against `src/lib` (and its unit tests). If you change a rule, change
  the tests, then update the chapter that cites it. `.scratch/game-logic-map.md`
  is the dense one-page logic reference and is promoted into `dev/` chapters.
- **Screenshots.** Player-manual screenshot placeholders point at
  `players/screenshots/<id>.png`. The manifest (what each screenshot must show,
  framing notes) is a checklist table near the top of the player manual.
- **The changelog is append-only.** New session entries go at the top of
  `docs/dev/changelog.md` (newest first, date-stamped, one entry per feature/fix
  with a Files line), mirroring the historical `handover.md` format.
- **Product name.** One spelling everywhere: **QuiTTER** (capital Q, capital
  TTER). Long form: Quick Terrestrial Tactical Encounter Rules.

## Where the old docs went

- `handover.md` (session history) → `docs/dev/changelog.md`
- `HANDBOOK.md` (mixed tech + stale design prose + player outline) →
  `docs/dev/legacy/HANDBOOK.md` — kept for mining history; superseded by this
  tree. Do not treat it as current.
- `NOTEBOOK.md` (combat worked examples) → `docs/dev/legacy/NOTEBOOK.md`; its
  examples were mined into the player manual and **re-verified** against the
  current formulas.

## Related reference

- `src/lib/*` — pure game-rule modules (the canonical source).
- `.scratch/*/spec.md` — per-feature design specs (some `status: done`, some
  pending). The most useful current one is `.scratch/game-logic-map.md`.
- `AGENTS.md` — work summary + agent workflow notes at the repo root.
