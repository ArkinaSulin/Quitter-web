# 18 — Map Structures

Authored map features — walls, archer spikes, gates, gate towers, watch towers —
split into a **template library** (authored once) and **placed instances** (on a
map), exactly like weapons/effects split authored vs placed.

> **Status.** Complete (migrations **093**–**095**): template library + editor,
> `enter_org_max` (authoring + movement gate), library and scenario authoring
> (`maps.structures` / `map_data.structures`, per-key `STRUCTURE` sub-steps),
> edge- and hex-structure attacks via **Shift + drop**, tower auras, scenario hex
> rendering, hex/edge **info tooltips**, structure **range bonuses**, and gate
> **open/close**. Only known gap: the AI planner ignores structure rules.

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
  - `battlement` draws a crenellation (square wave) on the **outside** face; the
    amplitude is tied to the tooth width so the teeth read as squares.
  - `spikes` draws a triangle (sawtooth) wave — minima on the edge, peaks
    outward, at the battlement amplitude — e.g. **Archer's Stake**.
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
- `src/lib/mapStructures.ts` (+ test) — parse placed instances, `structuresToWalls`, auras, org gates.
- `src/lib/structureCombat.ts` (+ test) — hex reach + door-first resolution.
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

## Slice 3b — `enter_org_max` movement gate (shipped)

Movement now honours `enter_org_max`: `mapGeometry.makeBlockedEdge` takes
`{ structures, templates, zones, orgLevel }` and blocks a step when the crossed
edge / destination hex carries a structure (or a ground zone on the destination)
whose `enter_org_max` is below the mover's organization level. Wired through the
player move path, the drag overlay, and reaction repositioning. Charges are still
blocked by any edge structure. The AI planner ignores it for v1.

## Slice 4 — hex structures (shipped)

- **Tower auras** (occupancy, `mapStructures.structureAuraFlags`): a unit on a
  hex structure gains `advantage`/`disadvantage` (its own attacks) and
  `grant_advantage`/`grant_disadvantage` (attackers against it). Merged into the
  combat copies in `useCombatActions` as synthetic effects so the roll-mode reader
  applies them (no persisted effect, no END_TURN bookkeeping). The AI ignores them.
- **Door-first combat** (`structureCombat.ts`): **Shift + drop** a unit on a
  gate/tower hex to attack it (a plain drop moves). No to-hit roll;
  the DT gates the blow; a standing door absorbs damage until destroyed, then the
  structure HP is exposed; 0 HP deletes the instance. 1 action + attack cap.
- **Rendering**: `useCanvasDraw` draws hex structures (black hex outline + artwork
  + HP badge, and a `door N`/`open` badge; tower HP above, door below).
- **Inspect mode & tooltips**: holding **Shift** hides all unit/corpse tokens and
  disables unit interaction; hovering a **hex** shows a `MapInfoTooltip` (effects
  and hex structure, priority effect → structure; side by side with Shift), and
  hovering near an **edge** shows that barrier's own tooltip, with an enlarged
  edge hit-box while Shift is held. The old "attack vs move" target-picker is gone.
- **Deferred**: none — structure **range bonuses** and gate open/close state are
  now implemented (see "Range & gates" below).

## Range bonuses & gate state (shipped)

- **`range`** is a reusable effect modifier kind (label "Zone/structure: weapon
  range +/-"). `structureRangeBonus(hex, structures, templates)` sums the
  occupant's `range` modifiers; consumed in the attack range gate and the combat
  weapon bands (`useCombatActions`) and in reaction shots
  (`useReactionActions` + `findEligibleReactionArchers`). A watch tower's `range`
  bonus extends (or a negative shrinks) the occupant's reach and shifts the
  long-range disadvantage band. Authorable on zones too (not yet consumed from
  zones — structures only).
- **Gate open/close**: instances carry `open`. An open gate adds no entry MP
  (`structureHexMoveCost` skips it) and **bypasses its door** — attacks hit the
  structure HP directly (`resolveHexStructureAttack` treats it as doorless).
  Closed gates keep their cost and door-first pool. Toggled by the GM in
  `StructurePaintPanel`; both canvases show an `open` badge instead of `door N`.
- **Still deferred**: AI ignores structure auras / range / gates (v1).

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
