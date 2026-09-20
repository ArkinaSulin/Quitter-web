# 18 — Map Structures

Authored map features — walls, archer spikes, gates, gate towers, watch towers —
split into a **template library** (authored once) and **placed instances** (on a
map), exactly like weapons/effects split authored vs placed.

> **Status.** Slices 1–3 shipped (migrations **093**–**095**): the template
> table + editor, the `enter_org_max` effect kind, library authoring
> (`maps.structures` + Map Editor tab), and scenario-native structures
> (`scenarios.map_data.structures` as the source of truth, per-key `STRUCTURE`
> command sub-steps, in-scenario painting, edge-structure attacks). Still
> pending: `enter_org_max` movement consumption and the hex-structure pass
> (Slice 4).

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
- `supabase/migrations/095_structure_command_log.sql` — `STRUCTURE` per-key substep.
- `src/types/structure.ts` — `StructureTemplate` / `StructureInstance`.
- `src/lib/structureTemplates.ts` (+ test) — row mappers, sanitizers, defaults.
- `src/lib/mapStructures.ts` (+ test) — parse placed instances, `structuresToWalls`.
- `src/lib/structureTemplateCache.ts` — session cache of the template library.
- `src/components/StructureEditor/StructureEditor.tsx` — the editor page body.
- `src/components/StructureEditor/StructurePreview.tsx` — edge/hex preview with
  the battlement square-wave and a preview flip.
- `src/components/MapEditor/{MapEditor,MapCanvas}.tsx` — the Structures tab + canvas.
- `src/components/ScenarioMap/StructurePaintPanel.tsx` — in-scenario GM structure brush.
- `app/structure-editor/page.tsx` — route gated on
  `can_view_structure_editor` / `can_use_structure_editor`.
- `src/lib/effectTemplates.ts`, `src/components/EffectEditor/EffectModifierFields.tsx`,
  `src/lib/unitEffects.ts` — the `enter_org_max` modifier kind.

## Slice 3 — scenario-native structures (shipped)

`scenarios.map_data.structures` is the scenario's source of truth (the legacy
`map_data.walls` is no longer written). Edge structures are still converted to the
runtime `Walls` (`structuresToWalls`) so movement/combat/render are unchanged.

- **Command log**: a `STRUCTURE` sub-step merges **one** structure per change
  (`{ field:'structures', key, from, to }`; a null `to` deletes the key) via
  `apply_substeps` (migration **095**), so two concurrent structure edits can't
  clobber each other. `useGameEngine.setStructureLocal` applies the optimistic
  result; the `WALL` branch is retained only for historical commands.
- **In-scenario painting**: `StructurePaintPanel` (LeftPanel Map tab) mirrors the
  Map Editor — pick a template, click/drag to place on an edge or hex, click a
  placed edge again to flip its battlement, edit HP/DT/door, right-click removes.
  These authoring writes go straight to `map_data.structures` (like terrain/zones).
- **Edge-structure attacks**: the Phase 2 drag-onto-the-edge attack now reads the
  derived `walls` and writes a `STRUCTURE` change back (destroyed = delete key).

## Pending (roadmap)

- **`enter_org_max` consumption**: movement must block a hex/edge whose zone or
  structure carries `enter_org_max` for a mover above the level (authoring works
  today; the movement gate is not wired).
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
- `assignMap` snapshots structures into `map_data.structures`; the runtime derives
  `walls` continuously from structures (Slice 3).
