# Archfar's Shipyard — Ship Builder (UI/UX Spec)

Status: **v1 implemented** (2026-08-30). Left + middle panels live at `/ship-editor`
(mirroring `/unit-editor`; `canViewShipEditor` = read, `canUseShipEditor` = edit). Right
panel is a v1 placeholder (hit-box silhouette summary; full art/crew-station/arc layout is
future work). Formulas live in `src/lib/shipStats.ts` (v8.1 FINAL, tested). RLS on the
`ship_*` template tables: migration 068.

Source of truth for stats/formulas: `.scratch/shipyard-formula/shipyard.csv` (v8.1 FINAL) and
`.scratch/spelljammer-mod/spec.md`. Look & feel mirrors the existing **Unit Editor**.

## Layout (3 panels)

- **Left**: template picker — list of `ship_templates` (the 18 presets + any saved builds). Selecting loads it into the middle panel.
- **Middle**: ship stats entry/modification. **Even split with the right panel, or collapsible** (v1: build left + middle; right panel is a placeholder).
  - **Top**: ship stat readout — frame/armor, mass / available space / unclaimed space, accel, top speed, **MC and turn/round bars** (the 1,2,3,2 curve by speed).
  - **Bottom**: the modification area — component count inputs (rudders, sails, L.Weap, S.Weap, hullR, bridge, aux helm, extra crew), accessory toggles, and a **cargo-load slider** so the MC / turn-per-round effect of load is visible live (laden mass → accel + MC recompute).
- **Right**: preview (placeholder in v1). Full design below.

## Right panel (future) — ship preview

Implemented v1 as the shared **`src/components/ShipRenderer/`** module (mirrors `TokenRenderer/`),
used by BOTH the builder's right panel and (future) the ScenarioMap. Builder passes its
build-derived descriptors; the map passes live scenario state. Files:

- `ShipHitGrid.tsx` — the hit-box silhouette (`hitBoxGroups` + render). Builder = full/edited
  build; map = live box pools + damage/destroyed states.
- `ShipFunctionalArea.tsx` — the station board. Top **non-directional functional box** = free
  actions not tied to a firing arc (PC cast-a-spell etc.). Station boxes (Helm Bridge, Command
  Bridge, Aux Helm, Sails, Rudder, Weapons) each carry **hollow crew circles** = crew needed,
  **filled circles** = crew assigned. `ShipStation` descriptors (`{id, label, crewNeeded,
  crewAssigned, arc, destroyed}`) keep the component decoupled from the engine.
- `ShipPreview.tsx` — editor wrapper composing the two (build → `stationsFromBuild`).

## Scenario-map integration (planned — ship engine phase)

- **PC token on a station** (e.g. Helm Bridge) = the hero takes that **ship action** (1 action
  per segment). **PC token on the Free Actions box** = the hero takes a **PC action** (fight,
  cast, move on deck). Dropping a token is a drag-and-drop onto the functional-area board.
- The functional-area board renders live: station pool HP (via visibility rules — Tiny sees all,
  Small+ sees own station only), load progress for crew-allocated weapons, destroyed → blackout.
- **Crew allocation** happens in a **floating window** in the ScenarioMap (per-ship): click from
  the shared crew reserve into a station. Assigned crew automate loading (e.g. a ballista over
  N segments) and get a "weapon ready" reminder. On Tiny ships everyone sees all stations; on
  Small+ only your own station + the Captain's Command Bridge panel.
- The X-quadrant / 360-center arc arrangement renders when the `firing_arcs` toggle is ON;
  arcs come from `ship_template_weapons.mount_slot`.
- The same command-log undo/redo machinery covers ship actions; the random box pick rides the log.

## Interactions

- Every input edit recomputes: mass, available/unclaimed space, accel (laden + unladen), MC band, ship HP, pool HP, cost.
- Cargo-load slider drives the laden state live (what the "Cargo Area" column previews).
- Save → upsert `ship_templates` + join rows (accessories, weapons with mount slots). Gated by `can_use_ship_editor` (admin).

## Data model (what the builder reads/writes)

- Reference: `ship_frames`, `ship_armors`, `ship_components`, `ship_accessories`, `ship_weapons` (read-only seeds).
- Templates: `ship_templates` + `ship_template_accessories` + `ship_template_weapons`.
- Scenario instances: `spelljammer_ships` (per-subsystem pool state, speed stat, loaded cargo, crew).

## Future tasks

- DB name grouping for QuiTTER (all `ship_` tables stay together; broader grouping later).
- Right-panel icons + crew-station X layout + hit-grid editor.
- CSV import/export for templates.
