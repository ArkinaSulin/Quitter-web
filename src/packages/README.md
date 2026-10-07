# src/packages — deep modules

Every package here is a **deep module**: a lot of behaviour behind a small
interface. A package's public surface is its **entry points** — the files at the
package root (mainly `index.ts`). Everything in a subfolder is **private**.

```
src/packages/<name>/
  index.ts     ← an entry point (public). Import this from outside.
  supabase.ts  ← another entry point (example: side-effectful modules get their own)
  lib/         ← implementation: hidden from outside
  tests/       ← co-located tests
```

## The rules (enforced by `npm run lint:boundaries`, dependency-cruiser)

1. **Entry-point boundary.** Code outside a package (app, `src/components`,
   `src/hooks`, `src/contexts`, `src/types`) may import a package's **entry
   points** only — never anything under its subfolders.
   `import { x } from '@/packages/combat'` ✅ ·
   `import { x } from '@/packages/combat/lib/unitCombat'` ❌
2. **Intra-package freedom.** A package's own files import each other freely.
3. **Tests** may import any package's entry points, and **their own** package's
   `lib/` (relaxed), but never another package's subfolders.
4. **No cycles** (`warn` only): this game's rules are cross-cutting, so a strictly
   acyclic package graph is not achievable yet — tracked as tech debt.

Packages must never import the app/UI layer (`src/components`, `src/hooks`,
`src/contexts`, `app/`) — that is a hard error.

## Prefer several small entry points over one barrel

Do **not** funnel a whole subtree through a giant `index.ts`. Prefer small,
named entry points (`index.ts`, `supabase.ts`, `duel.ts`, …). A package's
`index.ts` may re-export its `lib/` modules, but if it grows unwieldy, split it
into capability entry files instead. (A side-effectful module — one that touches
`process.env`, the network, etc. at import time — MUST get its own entry point,
or it will run whenever any consumer imports the package. See `infra/supabase.ts`.)

## Adding a package

1. Create `src/packages/<name>/{index.ts, lib/, tests/}`.
2. Put behaviour in `lib/*.ts`; expose it through `index.ts`.
3. Import it from outside as `@/packages/<name>`.
4. Run `npm run lint:boundaries`.
