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

## Editors

- **Standalone Map Editor** (`/map-editor`, `MapEditor/`): header (New/Delete/
  Main Menu), left panel with a maps list, an **Image** tab (map_images
  upload/list, name, offsets ~1%, scale, grid radius, description) and a
  **Movement cost** tab (0–9 pen + legend). Click/drag paints every crossed
  hex; **right-click clears** to 1 MP. Every edit **debounce-autosaves** to
  `maps`. Canvas paints terrain shading + hover-coordinate chip.
- **In-scenario Movement tab** (`TerrainPaintPanel`): the same 0–9 pen paints
  on the scenario copy — the GM keeps adjusting terrain live at the table.

## Assigning a map to a scenario

ScenarioMap's Map tab = **MapPickerList** (assign/clear) above the retained
placement panel (`MapEditorPanel`). Assigning **snapshots** the chosen board
into `scenarios.map_data` (background keys + `terrainCosts` + `mapId`
provenance), so the battle is independent of later edits to the library board.
Access caps (migration 074): `can_view_map_editor` / `can_use_map_editor`
(admin + dm) with matching `user_has_access` cases and RLS on `maps` (read =
view, write = use).

## Reserved

`hex_effects` (per-hex authored effects on library boards) is **reserved** —
the map-effects pass is a future feature. Walls/edges too. Ground *effects*
painted live in a scenario already work (see `10`).
