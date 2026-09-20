# 18 — Map Structures

Authored map features — walls, archer spikes, gates, gate towers, watch towers —
split into a **template library** (authored once) and **placed instances** (on a
map), exactly like weapons/effects split authored vs placed.

> **Status.** Slice 1 shipped (migration **093**): the template table, the
> Structure Editor, and the reusable `enter_org_max` effect kind. **Placement and
> gameplay consumption are not built yet** — see "Pending" at the bottom. Existing
> edge walls (Phase 1/2) still live in `map_data.walls` and will be unified into
> this model in Slice 3.

## Template vs instance

| | Storage | Shape |
|---|---|---|
| **Template** | `map_structure_templates` table | `StructureTemplate` (`src/types/structure.ts`) |
| **Instance** (pending) | `maps.structures` / `scenarios.map_data.structures` jsonb | `{ templateId, hp?, maxHp?, dt?, doorHp?, outside? }` |

Instances will be keyed by anchor: `"q,r,dir"` for edges, `"q,r"` for hexes. A
placed instance may override the template's durability (maxHp / hp / dt / doorHp)
so the GM can drop a reinforced gate without authoring a new template.

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
- `src/types/structure.ts` — `StructureTemplate` / `StructureInstance`.
- `src/lib/structureTemplates.ts` (+ test) — row mappers, sanitizers, defaults.
- `src/components/StructureEditor/StructureEditor.tsx` — the editor page body.
- `src/components/StructureEditor/StructurePreview.tsx` — edge/hex preview with
  the battlement square-wave and a preview flip.
- `app/structure-editor/page.tsx` — route gated on
  `can_view_structure_editor` / `can_use_structure_editor`.
- `src/lib/effectTemplates.ts`, `src/components/EffectEditor/EffectModifierFields.tsx`,
  `src/lib/unitEffects.ts` — the `enter_org_max` modifier kind.

## Pending (roadmap)

- **Slice 2 — library authoring**: `maps.structures` jsonb, a **Structures** tab in
  the Map Editor (template palette, edge/hex painting, click-a-side to set the
  outside / flip the battlement, cost labels drawn on the edge), `MapCanvas`
  rendering hex structures.
- **Slice 3 — scenario unification**: `scenarios.map_data.structures`, derived
  runtime structures, `STRUCTURE` command-log sub-steps (per-key merges instead of
  whole-object writes), wall unification + wipe of `map_data.walls`, movement
  consumption of `enter_org_max`, edge-structure attacks (Phase 2 retargeted).
- **Slice 4 — hex structures**: door-first combat resolution, tower aura
  materialization (occupancy effects via the zone reconcile path), hex rendering
  with HP/door badges, and a **target-picker prompt** when a drop lands on a hex
  with ≥2 targetables (unit, structure, targetable effect, …).
- Deferred by decision: structure **range bonuses**, gate open/close state.
