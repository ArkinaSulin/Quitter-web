# 13 — Maps, Terrain & `map_data`

## Two layers of "map"

1. **Map Library** (`maps` table, migration 074): reusable, *authored* boards.
   Each row: `name`, `description`, `image_url` (from the `map_images`
   storage bucket), `offset_x/y`, `scale`, `grid_radius`, `terrain_costs`
   jsonb (`{"q,r": 0..9}`), and reserved `hex_effects`.
2. **Scenario copy** (`scenarios.map_data`): a live scenario's composite board.
   It holds several layers merged together and persisted as one blob:
   - `backgroundConfig` (image url + offset + scale + grid radius),
   - `terrainCosts` (per-hex entry MP the GM painted),
   - `groundEffects` (see `10`),
   - `mapId` (provenance — which Map Library board it was snapshotted from).

`persistMapData` always **merges all layers** so no writer drops another.

## Terrain costs & movement

`terrain_costs` map `"q,r" → 0..9` (sanitized by `parseTerrainCosts`):
- **0 = free** entry (1 hop, no MP),
- **1 = default/clear**,
- **2–9 = difficult** — each costs that much MP to enter.

`computeReachableMap` takes a `costOfHex` (`terrainCostOf` clamps to 0) and
caps reach by **MP and by hex-count hops** — a 0-cost chain can't roam
unbounded (`07`). Charges cannot enter/pass cost > 1 hexes (they stay flat).

## Edge walls & barriers

A wall sits on the shared **edge** between two hexes (`src/lib/walls.ts`). Each
edge has two **faces** — one belongs to each of the two hexes — and a face can:
- **replace** the destination hex's terrain MP cost when crossing INTO that side
  (`moveCost`), or be **impassable** (`block`);
- grant **melee AC** / **ranged AC** to the unit standing on that side when
  attacked across the edge.

Stored once, canonically, under the endpoint hex with the smaller `(q, r)` tuple,
keyed `"q,r,dir"` (dir = `HEX_DIRS` index) so the two neighbours can't desync.
Rendering: with the pointy-top layout, edge `dir` is the segment between hex
corners `dir` and `dir+1`.

- **Movement**: `computeReachableMap` / `computeChargeReachable` pass the
  *from*-hex to `costOfHex` (a wall face replaces terrain) and take an optional
  `blockedEdge` predicate. `mapGeometry.makeCostOfHex` / `makeBlockedEdge` /
  `makeChargeBlockedEdge` build these from the scenario's terrain + walls.
  Charges cannot cross ANY wall edge.
- **AC**: `resolveCombatSequence` takes an optional `walls`; the crossed face's
  melee/ranged AC is added to the defender. Adjacent edges are exact; ranged uses
  `hexLine` (`src/lib/hexLine.ts`) to find the edge the shot enters through.
- **A wall is alive between attacks that cross it** — it is not a LoS blocker (yet).

## Editors

- **Standalone Map Editor** (`/map-editor`, `MapEditor/`): header (New/Delete/
  Main Menu), left panel with a maps list, an **Image** tab (map_images
  upload/list, name, offsets ~1%, scale, grid radius, description), a
  **Movement cost** tab (0–9 pen + legend), and a **Structures** tab (see `18`):
  pick a structure template from the library, then click/drag to place it on an
  edge or hex; click a placed edge again to flip its battlement; the selected
  instance exposes Max HP / DT / Door HP / battlement-side + Remove.
  Click/drag paints every crossed hex; **right-click clears** to 1 MP. Every edit
  **debounce-autosaves** to `maps`. Canvas paints terrain shading + structure
  segments (with battlements) + hex structures + edge move-cost labels +
  hover-coordinate chip.
- **In-scenario Movement tab** (`TerrainPaintPanel` + `StructurePaintPanel`): the
  same 0–9 pen paints on the scenario copy, and the structure brush places
  barriers/towers live (pick a template, click an edge or hex); the GM keeps
  adjusting the map live at the table.


## Assigning a map to a scenario

ScenarioMap's Map tab = **MapPickerList** (assign/clear) above the retained
placement panel (`MapEditorPanel`). Assigning **snapshots** the chosen board
into `scenarios.map_data` (background keys + `terrainCosts` + `structures` +
`walls` + `mapId` provenance), so the battle is independent of later edits to the
library board. Edge structures are converted to the runtime `walls` shape via
`structuresToWalls` on assign, so movement/combat keep working until the scenario
is fully structure-native (Slice 3). Access caps (migration 074):
`can_view_map_editor` / `can_use_map_editor` (admin + dm) with matching
`user_has_access` cases and RLS on `maps` (read = view, write = use).
Migration **089** added `maps.walls`; **094** replaces it with `maps.structures`.

## Destructible walls (Phase 2)

A structure instance may carry `maxHp` / `hp` / `dt` (damage threshold). Authored
in the Structure Editor as template defaults, overridable per placed instance
(Structures tab + `StructurePaintPanel`: **Max HP** / **DT**); an authored `maxHp` with
no `hp` starts at full health. A segment with no `maxHp` is indestructible scenery.

**Attacking a barrier** is a drag onto the edge (`useHexGrid.hoveredEdge` via
`nearestWallEdge`, threshold 0.38·hexSize): `canAttackWallEdge` gates the drop
(unit reach + destructible wall), so dropping onto a legal move hex still moves.
Reach (`wallCombat.wallAttackKind`) is **melee** when the attacker stands on
either edge hex, else **ranged** when its weapon's `maxRange` covers the nearer
edge hex. There is **no to-hit roll** — reaching the edge is the hit; the
attacker rolls weapon damage and `applyWallDamage` compares it to `dt` (at or
below = no effect, above = full damage off HP). Attacking costs **1 action** and
counts toward the attack cap (soft-confirmed when over), with no AGR/retaliation.
`hp <= 0` removes the segment.

Persistence rides the command log: the command is `ATTACK` with a **`STRUCTURE`**
sub-step (`{ field: 'structures', key, from, to }`), applied by `apply_substeps`
(migration **095**) as a per-key merge into `scenarios.map_data.structures` —
undo/redo/realtime/replay restore wall HP with the rest of the command.
`useGameEngine.setStructureLocal` paints the optimistic result.

## Reserved

`hex_effects` (per-hex authored effects on library boards) is **reserved** —
the map-effects pass is a future feature. Ground *effects* painted live in a
scenario already work (see `10`). Still planned on top of structures (see `18`):
the hex-structure pass (door-first combat, tower auras, target-picker) and
`enter_org_max` movement consumption; later, temporary (magic) structures with a
caster/duration ticked at END_TURN like ground zones.

