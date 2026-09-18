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
  **Movement cost** tab (0–9 pen + legend), and a **Walls** tab (arm the wall
  tool; click/drag near a hex edge to place, right-click removes; the selected
  edge shows a face editor per side: MP / block / melee AC / ranged AC).
  Click/drag paints every crossed hex; **right-click clears** to 1 MP. Every edit
  **debounce-autosaves** to `maps`. Canvas paints terrain shading + wall segments
  + hover-coordinate chip.
- **In-scenario Movement tab** (`TerrainPaintPanel` + `WallPaintPanel`): the same
  0–9 pen paints on the scenario copy, and the wall tool places barriers live;
  the GM keeps adjusting terrain live at the table.


## Assigning a map to a scenario

ScenarioMap's Map tab = **MapPickerList** (assign/clear) above the retained
placement panel (`MapEditorPanel`). Assigning **snapshots** the chosen board
into `scenarios.map_data` (background keys + `terrainCosts` + `walls` + `mapId`
provenance), so the battle is independent of later edits to the library board.
Access caps (migration 074): `can_view_map_editor` / `can_use_map_editor`
(admin + dm) with matching `user_has_access` cases and RLS on `maps` (read =
view, write = use). Migration **089** adds `maps.walls`.

## Reserved

`hex_effects` (per-hex authored effects on library boards) is **reserved** —
the map-effects pass is a future feature. Ground *effects* painted live in a
scenario already work (see `10`). Planned on top of walls (not yet built):
per-segment HP/DT destruction (attack an edge explicitly), and temporary
(magic) wall effects with a caster/duration sharing the same edge mechanic.

