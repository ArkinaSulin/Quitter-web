# 18 — Map Structures

Authored map features — walls, archer spikes, gates, gate towers, watch towers —
split into a **template library** (authored once) and **placed instances** (on a
map), exactly like weapons/effects split authored vs placed.

> **Status.** Slices 1–2 shipped (migrations **093**–**094**): the template
> table + editor, the `enter_org_max` effect kind, and **library authoring** —
> `maps.structures` with a Structures tab in the Map Editor (paint edge/hex,
> flip the battlement, HP/DT overrides). Scenario-side placement/combat
> consumption is not built yet — see "Pending" at the bottom. Edge structures are
> converted to the runtime `Walls` on assign so wall gameplay is unchanged.

## Template vs instance

| | Storage | Shape |
|---|---|---|
| **Template** | `map_structure_templates` table | `StructureTemplate` (`src/types/structure.ts`) |
| **Instance** | `maps.structures` jsonb (library); `scenarios.map_data.structures` snapshot | `{ templateId, hp?, maxHp?, dt?, doorHp?, outside? }` |

Instances are keyed by anchor: `"q,r,dir"` for edges, `"q,r"` for hexes
(`src/lib/mapStructures.ts`). A placed instance may override the template's
durability (maxHp / hp / dt / doorHp) so the GM can drop a reinforced gate
without authoring a new template. On assign, edge structures are converted to the
runtime `Walls` shape via `structuresToWalls` (inside/outside mapped by
`outside`) so the existing movement/combat/render model is untouched until the
scenario is migrated (Slice 3).

## Anchors

- **Edge** (`anchor='edge'`) — sits on the shared edge between two hexes.
  Directional, one face per side:
  - **Inside face (A)** / **Outside face (B)** — each has `block`,
    `moveCost` (replaces the entered hex's terrain when crossing INTO that face),
    `meleeAc` / `rangedAc` (cover for the unit standing on that side).
  - `battlement` draws a crenellation (square wave) on the **outside** face.
  - A placement's `outside` flip maps the template's inside/outside onto the
    canonical `a`/`b` sides — one control that swaps the directional stats and
    moves the battlement.
- **Hex** (`anchor='hex'`) — occupies a whole hex:
  - `hexMoveCost` = extra MP to enter (`NULL` = normal).
  - `doorHp` = optional destructible door (`NULL` = no door). The door uses the
    template `dt`; damage resolves **door-first**, then the structure HP.

## Durability

`maxHp` (default **30**) and `dt` (damage threshold, default **15**): a single
hit at or below `dt` does nothing; above it deals full damage. Wood templates use
`dt` 15, stone 20. Non-destructible scenery is expressed as `maxHp 0` in a future
pass (today the columns are non-negative with a 30 default).

## Effect modifiers

The template's `modifiers` list is a standard `EffectModifier[]`
(`effectTemplates.ts`), so a structure can grant occupants things like:

- `advantage` — the occupant's own attacks take the higher of 2d20.
- `grant_disadvantage` — attackers targeting the occupant take the lower.
- `entry` — one-time damage when a unit enters (archer spikes alternative).
- `enter_org_max` — **reusable gate**: only formations whose organization level
  is `≤ value` may enter. The same kind can be put on a ground zone. (Consumption
  in movement is pending; authoring works today.)

## Key files

- `supabase/migrations/093_map_structure_templates.sql` — caps, RLS, table, seeds.
- `supabase/migrations/094_map_structures.sql` — `maps.structures` (drops `maps.walls`).
- `src/types/structure.ts` — `StructureTemplate` / `StructureInstance`.
- `src/lib/structureTemplates.ts` (+ test) — row mappers, sanitizers, defaults.
- `src/lib/mapStructures.ts` (+ test) — parse placed instances, `structuresToWalls`.
- `src/lib/structureTemplateCache.ts` — session cache of the template library.
- `src/components/StructureEditor/StructureEditor.tsx` — the editor page body.
- `src/components/StructureEditor/StructurePreview.tsx` — edge/hex preview with
  the battlement square-wave and a preview flip.
- `src/components/MapEditor/{MapEditor,MapCanvas}.tsx` — the Structures tab + canvas.
- `app/structure-editor/page.tsx` — route gated on
  `can_view_structure_editor` / `can_use_structure_editor`.
- `src/lib/effectTemplates.ts`, `src/components/EffectEditor/EffectModifierFields.tsx`,
  `src/lib/unitEffects.ts` — the `enter_org_max` modifier kind.

## Pending (roadmap)

- **Slice 3 — scenario unification**: `scenarios.map_data.structures` (snapshot
  landed in Slice 2; the runtime still derives `walls`), `STRUCTURE` command-log
  sub-steps (per-key merges instead of whole-object writes), wall unification +
  wipe of `map_data.walls`, movement consumption of `enter_org_max`, edge-structure
  attacks (Phase 2 retargeted), in-scenario structure painting.
- **Slice 4 — hex structures**: door-first combat resolution, tower aura
  materialization (occupancy effects via the zone reconcile path), hex rendering
  with HP/door badges in `useCanvasDraw`, and a **target-picker prompt** when a
  drop lands on a hex with ≥2 targetables (unit, structure, targetable effect, …).
- Deferred by decision: structure **range bonuses**, gate open/close state.

## Slice 2 — library authoring (shipped)

`maps.structures` (migration **094**; `maps.walls` dropped) with a **Structures**
tab in the Map Editor:

- Template palette (list from `map_structure_templates`); arm a template, then
  click/drag to place. Edge templates paint on the nearest edge; hex templates
  paint the hex.
- Clicking an already-placed edge structure selects it; clicking it **again flips
  its battlement (`outside`)** to the other side.
- Selected-instance editor: Max HP / DT overrides (blank = template default),
  Door HP for hex structures with a door, the battlement-side Flip, and Remove.
- `MapCanvas` renders edge segments (styled by block/cost, with the battlement
  square-wave on the outside) and hex structures (colour tint + artwork + HP
  badge); move-cost numbers are drawn on the edge per face.
- `assignMap` snapshots structures into `map_data.structures` and derives
  `map_data.walls` for the current runtime.
