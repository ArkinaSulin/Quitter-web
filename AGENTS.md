# AGENTS.md

## Documentation map

- **Technical reference** (how the system works, per subsystem): `docs/dev/` — start at `docs/dev/README.md`. Code is canonical; chapters cite the module home + migrations.
- **Packages are deep modules** — `src/packages/<domain>/{index.ts, lib/, tests/}`. Import only through a package's entry points; boundaries are enforced by `npm run lint:boundaries`. See `src/packages/README.md` before adding or importing a package.
- **Player manual** (rules for humans): `docs/players/player-manual.md`.
- **Session changelog**: append entries (date-stamped, one per feature/fix, with a `**Files:**` line, newest first) to `docs/dev/changelog.md` — this is the old `handover.md`. Root `handover.md` is a pointer stub.
- **Outstanding backlog**: `docs/dev/outstanding.md` is the forward-looking roadmap (next / later / blocked).

## Work Summary (Anchored)

Newest work first; the authoritative, per-session record is `docs/dev/changelog.md`.
The most recent work completed the **Basic AI current scope** (whole-activation
climb routes, vacant-top/route locks, redundant-wall pathing, rout step limits,
local-only preview markers), the **Halloween Siege** minigame (migration 133),
and the **Spelljammer mass-first overhaul** (migrations 134–150: no ship frames,
regional deck layout, the 24-ship master templates, per-unit weapon/component
cards, derived min/full crew, crew HP/weekly operation cost, cargo simulation,
hull cost, UUID/name ship catalogs, and the Component Workshop).
Prior sessions added **map structures** (migrations 093–095: template library + Structure Editor, edge/hex
instances, door-first combat, tower auras, `range` bonuses, gate open/close,
**Shift + drop** attacks and Shift-held inspect-mode hex/edge tooltips), the
**Map Editor Effects tab** with *permanent* authored board effects, **archer
rules** (front-only ranged arc + indirect-shot LoS, 091), and **destructible wall
segments** (092). Earlier: edge walls (089), the Zone-of-control pursue +
Withdraw economy (090) with a hero command leash, attack-roll effects (088), the
movement economy ("1 action = 1 full MP pool"), combat, effects, fog, and
reusable maps. Here's the state:

### Completed

- **Deployed war machine compact token card (2026-11-26)**: deployed units draw a
  card-in-token with weapon name, authored reload steps, numeric crew, steps n/5
  and a Fire button. Clicking the card's Fire button loads/enters 60° fire mode
  (the map highlights the legal wedge); clicking a hostile ship or land unit in
  arc resolves and spends steps; clicking elsewhere selects the deployed card.
- **Deployed war machine 5-step action model (2026-11-26)**: per-turn step/reload
  state (migration 185), Fire auto-loads/fires/auto-loads leftovers; reload 0 is
  always armed; moving clears deployment and spends the steps. Token Fire UI remains next.
- **Deployed warmachine state (2026-11-26)**: context **Deploy war machine
  (2 actions)**, deployed state persisted (migration 184), 2-action rotation,
  moving auto-clears deployment and sets Scattered. 5-step load/fire and token
  card remain phased.
- **Unit→ship attack damage v2 (2026-11-26)**: per-attack AC→DT; siege/Huge fire
  multiple shots (ship HP + `/10` component tons + one crew hit + Cargo-card
  cargo loss with floating barrels); AoE auto-hits for component damage and 3/2/1
  crew by radius; single-target magic HP only; personal no damage with a message.
  Deployed warmachine remains phased.
- **Explicit unit weapon attack class (2026-11-26)**: weapons carry
  Personal/Magic/Siege; old strings infer Siege from war machine and Magic from
  area magic. Drives ship damage classification; no migration.
- **Unit→ship drop classification/routing (2026-11-26)**: personal / single-target
  magic / AoE / siege / Huge+ classifier, Board/Attack prompt for hostile hero
  drops, non-hero attack prompt when a weapon reaches; ship→unit stays a move.
  Provisional AC→DT ship damage; full pipelines and deployed warmachine are
  phased in `docs/dev/outstanding.md`.
- **Ship occupancy, elevated rendering, ship stats (2026-11-26)**: units and
  ships block each other (no stacking/pass-through; heroes board instead);
  airborne atmosphere ships use the flying-unit offset + ground shadow; ships
  appear in Scenario Statistics as one-troop level-less rows with ship HP and
  ship weapon kills. Crew rows deferred.
- **Unused ship catalog image URLs and notes removed (2026-11-25)**: dropped
  Image URL, component Effect/note and weapon Note from catalog rows, types,
  mappers, the Component Workshop and card/editor display; built-in card notes
  remain. Migration 183 drops the four catalog columns.
- **Ship ground movement + MP/FP + claw threat (2026-11-25)**: atmosphere ships
  get MP and FP (MP 0 without sails/legs; sails MP=FP; terrain-legs component MP
  authored + MC 0 grounded). Ground moves use MP, takeoff/landing uses FP, pools
  drain at a settings ratio; structure entry allowed when ship elevation ≥ top.
  Claw weapons carry threat 10 each and project a grounded one-hex ZoC. Migration
  182 adds component/weapon/runtime fields.
- **Ship area weapons, ram formula, Damage-only weapons, atmosphere speed
  (2026-11-25)**: area ship weapons open the shared magic window on a unit hit
  (attack first, editable saves, realtime); ram is `floor(effectiveMass/10)d
  (turnsSinceFacing)` (dice 1–16, faces 1–12); the weapon damage formula field is
  removed (migration 181) so all other weapons use Damage; atmospheric speed
  defaults to acceleration and is written on Ship Editor save when 0.
- **Signed ship modifiers (2026-11-25)**: negative skill values display as
  `-1` (never `+-1`) in hovers, Crew Adjust, card hovers and Best in ship skill;
  added the `signedBonus` helper. No migration.
- **Captaincy display, command-bonus action cost, space-only acceleration
  (2026-11-25)**: Captaincy is `Int + PB − 5` on every surface (crew keep +2
  CrewSkill); Command bonus also costs one captain action (negative-action
  approval when none); ship hover shows Acceleration only in wildspace. No
  migration.
- **Ship hover tooltip (2026-11-24)**: hovering a ship image shows name,
  HP current/max, effective acceleration, effective MC (after trim) and the mode’s
  speed (Declared in wildspace / Atmosphere in atmosphere). Uses the rotated hull
  hit box; units win on overlap, hidden/fogged ships are skipped. No migration.
- **Ship skill checks say what they do and use DC (2026-11-24)**: sail max/trim,
  repair’s component check and ram now name the action in the plain message and
  use `vs DC` in verbose detail (attack rolls keep `vs AC`); command/undo
  descriptions name the action too. No migration.
- **Repair uses deck targeting (2026-11-24)**: Hull Repair enters a targeting
  mode like Command bonus; damaged cards show a Repair overlay (one ton) and the
  Hull card repairs HP only. Negative-action approval reuses the shared confirm
  dialog; the old picker modal is gone. No migration.
- **Scenario Statistics HP columns + resizable window (2026-11-24)**: Starting,
  Lost and Kills now show Troop / Lv / HP per unit and per alliance; intro HP
  snapshots with intro troops, `hpLost` is gross, `killHp` uses the killer
  payload. The shared text mirrors it. The modal has a bottom-right resize
  handle clamped to the viewport. No migration.
- **Spelljammer Int captaincy + Helmsman max(Wis, Int) (2026-11-24)**: the Bridge
  **Command bonus** button awards `Int + PB − 5` (may be negative) to a card for
  one Bridge card step; one pending gold badge per card, consumed by its next d20
  roll and expiring at end of turn. Helm control, ram, barrel dodge, crew fill
  priority and Best-in-ship Helmsmanship use `max(Wis, Int)`. Sail trimming DC is
  now `20 − effective MC`; sail max/trim succeed once per turn and `mcReduction`
  lasts until end of turn. Cha captaincy is documented only. No migration.
- **Station names in undo/redo messages (2026-11-24)**: silent hero station
  moves, Fill and Empty now name the station in their command descriptions;
  duplicate weapon names include the deck region (and an ordinal when needed).
  No migration.
- **Silent free station actions (2026-11-24)**: hero card moves, Fill station and
  Empty station no longer post Messages entries (`execute` gained `silent`);
  server writes/undo/replay remain. No migration.
- **Scenario banner reserved for Halloween Siege (2026-11-24)**: removed bottom
  toasts from sail maxing, rudder trim, repair, ram, and weapon load; those now
  use Messages only. The toast banner remains only for Halloween Siege wave
  completion. No migration.
- **Campaign ships in the Ship Selector (2026-11-24)**: campaign cards stay first
  but scroll with the library (not pinned) and now show the latest version's ship
  image plus total mass, matching library ship cards. No migration.
- **Repair dice + DC 15 component checks (2026-11-24)**: repair verbose shows
  `4d8` faces/bonus and a `D20 vs DC 15` component check; failure consumes the
  kit/card step but restores no ton. Sail maxing, rudder trim, ram and barrel
  dodge/collision verbose notes now show their `D20`/damage faces. No migration.
- **No-crew max-target roll + effective cargo display (2026-11-24)**: ship
  weapons only roll `max_targets` when living crew are on the struck card;
  cargo shows `used / effective (design)t` after Cargo-card damage (window live,
  dry dock from the version's damage, library editor full). Cargo boxes are
  sampled without replacement (6/12, 5/11, 4/10 in the 6-in-12 example); empty
  boxes still consume a hit. No migration.
- **Reordered verbose ship-fire report (2026-11-24)**: verbose messages now list
  hit header, attack roll, damage roll, boxes destroyed, card destroyed,
  crew roll/hits/kills, then cargo; crew uses
  `{1d3: 3} → 3 crew hit (names) 3 killed`. Plain messages unchanged. No
  migration.
- **Barrel contents in the right-click menu (2026-11-24)**: cargo-debris hexes
  show “Floating cargo” plus `50% of [merged items]` in the right-click menu;
  removed the Manage all… header and Move up/down buttons. Full per-hex editing
  remains on Shift + double-click. No migration.
- **Merged floating-cargo barrels (2026-11-24)**: cargo boxes destroyed in one
  hex merge into one `cargo_debris` zone with summed same-name contents and a
  `barrelCount`; the marker draws 1/2/3 barrels (3 in a triangle) with rotations
  seeded by the hex coordinate. One collision check per hex and no count badge.
  No migration.
- **Shared unsaved-changes guard for every library editor (2026-11-24)**: added
  `useUnsavedChanges` + `UnsavedChangesModal`; Component Workshop (components/
  weapons/armors), Structure Editor, Effect Editor and Weapon Editor now prompt
  Save/Discard/Cancel on tab/row/New/Clone/Main Menu and warn on reload. Ship and
  Unit editors retain their existing dirty dialogs. Map Editor autosaves. No
  migration.
- **90° firing sectors + destroyed-card occupant cleanup (2026-11-24)**:
  `shipTargetArc` now uses four ~90° bearing sectors (bow ±45°, starboard,
  stern, port) matching the dial. A card losing its last box clears its crew to
  reserve and hero station keys (heroes fall back to Deck/Cargo), zeroes its crew
  slots, and blocks Fill/movement/auto-assign; cleanup is part of the damage
  command. No migration.
- **Larger ship-window hero tokens (2026-11-24)**: hero tokens on the ship deck
  are 20% larger (`min(card width, card height) × 1.2`) and keep the 200%-zoom ×
  DPR backing canvas, so they are easier to read and stay crisp at max zoom. No
  migration.
- **Cargo barrels + crisp hero tokens + free-fire preview (2026-11-24)**:
  floating cargo draws as a barrel; hero-token canvases render at 200% max deck
  zoom × DPR so they are crisp at max zoom and scale down with the deck; selecting
  a ship weapon paints the free-fire area (white normal, amber disadvantage,
  nothing below min range/out of arc/beyond max). No migration.
- **Destroyed Bridge/Helm access, non-shrinking deck, arc dial (2026-11-24)**:
  destroyed Bridge/Helm cards grant no captain/helmsman role, no reveal-all/
  manage-all, and no command fallback; the hero sees only that card. Deck rotation
  no longer scales down (cards keep size, use pan/zoom) and the weapon firing-arc
  dial rotates with facing while card text stays upright. No migration.
- **Ship no-op moves, serial labels, facing-rotated deck (2026-11-24)**: dropping
  a ship back on its current hex does nothing (no command/message/crate dodge).
  Every ship message uses `name + alphaLabel(serialNumber)` (e.g. Gunboat E).
  The runtime deck rotates in 60° steps with `ship.facing` while cards and region
  labels counter-rotate to stay upright; the editor/dry dock stays north-up.
  No migration.
- **Panel lists no longer scroll the map (2026-11-24)**: moving a hero between
  ship cards posted a message, and `MessagesPanel`'s `scrollIntoView` could scroll
  the document up by the top-bar height (banner disappeared until F11 reset).
  `MessagesPanel`/`UndoDebugPanel` now scroll their own containers directly, and
  the Halloween Siege wave list scrolls within its list. `docs/dev/19` records the
  no-`scrollIntoView` rule. No migration.
- **Hero tooltip actions (2026-11-24)**: the ship-window hero token tooltip now
  replaces the raw STR/DEX/CON/INT/WIS/CHA line with `Actions: unused/total`
  (red at 0, `hero_actions_per_turn`) and keeps the six skill bonuses. No
  migration.
- **All-hero Best in ship skill + canonical skill order (2026-11-24)**: Best in
  ship skill now includes every living boarded hero (not only Deck/Cargo), and
  Captaincy (INT) appears in hero/NPC hover summaries and the Crew Adjust block.
  Every surface uses one order — Repair (STR), Weapon (DEX), Sail maxing (CON),
  Captaincy (INT), Sail trimming (INT), Helm (WIS) — with the 2-column grids
  ordered Repair/Captaincy, Weapon/Sail trimming, Sail maxing/Helm. Crew cost and
  Proficiency/CrewSkill moved to their own rows. No migration.
- **Verbose ship-fire dice breakdown (2026-11-24)**: ship shots always record a
  verbose message; verbose mode shows the d20 attack roll(s) (both dice on
  disadvantage), damage faces/total, the `max_targets` roll with capped crew
  count and names, component tons, cargo lost, and floating crates. Plain
  messages are unchanged; unit targets omit the ship-only max-target roll. No
  migration.
- **Ship weapon component/crew damage + cargo loss/crates (2026-11-24)**: a
  penetrating hit destroys `floor(damage/10)` tons on the struck card (capped at
  its remaining boxes) and independently rolls `1..max_targets` living occupants,
  each taking the full shot damage. `ship_weapons.max_targets` defaults to 1
  (Mangonel seeded to 3; migration 180 pending). Cargo packs into
  `capacity − destroyed Cargo boxes`, full one-ton groups first with leftovers
  last; each cargo ton rolls a shrinking box pool, lost cargo is named in the
  message, and each non-empty destroyed box leaves a `cargo_debris` ground zone
  showing `50% of [items]`. Ships entering a crate hex roll Helm dodge
  (`d20 + best helm Dex`) vs DC 15; failure takes `mass d speed` and destroys the
  crates, which never stop the ship. DM removes crates from the hex-effects list;
  recovery is manual. **Apply 180 in Supabase.**
- **Compact cargo header/rows for the Ship Window (2026-11-23)**: the shared
  cargo frame renders **Cargo** / **manifest** on two lines so the capacity badge
  and Add cargo button stay vertically centred and un-squeezed in the fixed 210px
  Ship Window panel. The Category column is gone (dialog + name hover title), and
  Qty shows only the number (unit in the dialog/Qty title), freeing width for the
  name. Crew roster header and rows share one grid gap, with the **Level** label
  nudged left over its values. No migration.
- **Unified crew/cargo add buttons (2026-11-23)**: the shared crew frame now has
  a single **+ Add crew** in its header (green/yellow, disabled when read-only);
  the editor's duplicate header button and the full-width row add are gone, so
  editor, dry dock, and Ship Window share one control. Ship Window **Auto**/
  **Clear** moved to a footer row. The shared cargo frame has **+ Add cargo** top
  right, the **used / total capacity** fraction centred between the title and the
  button, and no row add; the over-capacity warning is inline in the load badge.
  No migration.
- **Shared sail/rudder manning + damage-scaled hardware (2026-11-23)**: minimum
  crew is one helm plus `max(1, ceil((sails + 2 × rudders) / 4))` — one crew mans
  4 sails or 2 rudders, and spare capacity covers the other group (2 sails + 1
  rudder needs 1 crew). Card capacity uses `ceil` for sails. Auto assign fills
  only the combined demand (empty Sail → empty Rudder → Rudder), while card slots
  remain the manual maximum. Destroyed boxes shrink hardware: a Sail box is one
  sail; combined Rudder cards use `ceil(survivingTons / 1.5)` so a rudder is not
  destroyed until its full mass is gone (10.5 t − 1 t → 9.5/1.5 = 6.33 → 7;
  requirement drops only at 7.5/1.5 = 5). New `shipManning.ts` derives effective
  counts and `effectiveShipStats` (acceleration **and** MC), wired into
  ScenarioMap move/turn/declare checks and SpeedDeclarationPanel; the Ship Window
  shows an **Undermanned** note. No migration.
- **Station crew: per-card capacity + exactly-one-vacancy pull (2026-11-22)**:
  Helm/Command bridge card capacity now uses the card's own crew (not the
  ship-wide helm/bridge count), fixing hero-plus-crew and two-crew Helm states.
  Auto-pull fires only with a living reserve **and exactly one empty slot**
  (`needsStationReplacement`); hero entry trims excess crew to capacity. No
  migration.
- **Browse campaign versions in the dry dock (2026-11-22)**: the version
  ‹ ›/dropdown loads a historical version’s stored design into the middle/right
  panels in **read-only preview** (save bar hidden); the left panel shows its
  details and a **diff/cost against the previous version** (labour + equipment;
  the root shows no comparison). The current version stays editable; leaving a
  dirty current version asks before switching; after a fork the view jumps to the
  new current version. New `campaignPreviousVersion` helper + tests. No migration.
- **Toasts at the map bottom + top-bar-aware left panel + DM auto-editor
  (2026-11-22)**: toasts are bottom-centre (above the reaction toolbar), have a
  **×**, and stay until dismissed/replaced (no auto-hide). `TopBar` reports its
  measured height; the left panel sits at `topBarHeight + 8`, so it drops when
  the bar wraps instead of being covered. The DM auto-acquires the dry-dock editor
  lease when it is free, so the builder starts editable. No migration.
- **Dry-dock success messages use the Messages log (2026-11-22)**: “Save refit”,
  “Save as new version” and “Make/Convert Campaign Ship” post `addMessage`
  instead of a centered toast, so they no longer cover the top banner bar. Toasts
  remain for exceptional events. No migration.
- **Fix ambiguous `numeral` in `fork_campaign_version` (2026-11-22, migration
  179)**: “Save as new version” failed with `column reference "numeral" is
  ambiguous` because the PL/pgSQL variable matched `ship_campaign.numeral` inside
  the family CTE. Renamed the variable to `new_numeral` and the CTE column to
  `family_numeral`; behaviour unchanged. **Apply 179 in Supabase.**
- **Dry dock keeps the left panel + both lower resize handles (2026-11-22)**: the
  game left panel is hidden only for replay / DM-gone, not for the dry-dock pause,
  so Messages/participants stay usable. Unit/ship/campaign-ship drags are refused
  with “The table is paused while the dry dock is open.” The dry-dock window now
  defaults beside the panel (side-aware) and `DraggablePanel` has a bottom-left
  resize handle (right edge fixed) alongside the bottom-right one, covering both
  the dry dock and the ship window. No migration.
- **Windowed dry dock, no local hide (2026-11-22)**: `DryDockWindow` is now a
  movable/resizable `DraggablePanel` (z 150, per-client `quitter.dryDock.size`,
  viewport-clamped restore/resize) with **End dry dock** in the title bar. The
  local dismissed state and Reshare are removed: the window is visible for the
  whole session, the DM's close/Cancel ends it for everyone, and players see
  “The DM ends the dry dock”. Fixes Cancel hiding the window while leaving the
  table locked. `DraggablePanel` gained `closeLabel`, `bodyClassName`,
  `initialSize` and size clamping. No migration.
- **Server-authoritative campaign numbering (2026-11-22, migration 178)**: the
  dry dock now receives the whole family (`campaignFamilyOf`), not the current
  version, fixing a second refit reusing “II”. `fork_campaign_version` derives
  the numeral (`max(family)+1`, or 1 when renamed) and builds the display name
  with a new SQL `roman_numeral`; the family label is the root’s base name with
  no scenario. The Campaign Ship Manager gained an owner-only **Renumber** repair
  (creation order 1..N + carrier name refresh). **Apply 178 in Supabase.**
- **Structure instances snapshot their template (2026-11-22)**: every placed
  structure stores a full `template` snapshot, written by the Map Editor brush and
  the in-scenario Structure brush and copied into `scenarios.map_data.structures`
  on map assignment. Runtime lookups use
  `structureTemplatesWithSnapshots(structures, library)`, so editing or deleting a
  library template cannot change or break structures already placed on another
  DM's map. Legacy instances without a snapshot fall back to the live library. No
  migration (jsonb only).
- **Creator-locked editor content (2026-11-22, migration 177)**: every
  authoring table now stores `owner_id` (unit templates + lookups, ship
  templates/catalogs, maps, effect/structure templates, siege presets). A row
  trigger allows only the creator or an admin to update/delete; `owner_id NULL`
  (legacy/seed/system) is admin-only; inserts force `auth.uid()` and ownership
  cannot transfer. Scenario tokens are exempt — map editing keeps its turn/team
  rules. Each editor gained an owner filter (default **All content**), owner
  chips, a read-only notice with **Clone to edit**, and an admin-only “Owner
  deleted” filter. **177 applied.**
- **Campaign ships (2026-11-22, migration 176)**: `ship_player*` is dropped and
  replaced by `ship_campaign`, where a row **is a version** of a ship family
  (`parent_id` tree, root = family name). A scenario copy lives in
  `ship_spelljammer`; only the instance flagged `campaign_carrier` mirrors its
  runtime into the campaign row via a trigger. Deployment opens a popup (version
  + Full/Latest + “make this a new campaign ship”); Yes adds a `CAMPAIGN` sub-step
  to the placement command, No creates an instance only. A version may have one
  un-superseded child per scenario (`occupies_slot` + partial unique index).
  Dry dock has Save / Save as new version (sealed, non-undoable: the old row
  freezes) / Cancel, shows a live labour+equipment summary with no stored invoice,
  and excludes crew/cargo cost. The declaring DM owns the family; a new
  `/campaign-ships` **Campaign Ship Manager** lists Active / Frozen / Orphaned
  versions with rename and delete. `release_idle_player_ships` is gone, so a
  reload can no longer make a ship generic. **176 applied.**
- **Weapon firing arcs + header messages (2026-10-31, migration 150)**: weapon
  cards carry a four-sector firing-arc dial (Bow/Port/Starboard/Stern). Non-Body
  frames protect their default arc; Body starts at 360° and any arc can be
  removed. The card context menu adds/removes arcs and includes fan direction
  icons. The deck menu now has Add slot/Remove slot on the current frame.
  Errors, success, and derived warnings appear in a centered title-bar stack.
  Migration 150 adds `ship_templates.weapon_arcs`.
- **Ship deck remove-slot command (2026-10-31)**: the deck context menu has
  **Remove slot** below the region-move commands, separated by a divider. It
  removes the bottom-most empty slot in that region down to the one-row minimum
  (Bow 1 center, Port 1, Starboard 1, Body 2, Stern 1). Occupied slots are never
  removed.
- **Ship deck reshaped (2026-10-31)**: Bow 4 (reverse T), Port/Starboard 4,
  Body 8 (two columns), Stern 3. Legacy layouts reshape on load and removed-slot
  cards are re-placed. Overflow still adds +1 Port/+2 Body/+1 Starboard.
- **Mass-scaled ship weapon damage (2026-10-31, migration 149)**: ship weapons
  may store `damage_formula`; the supported form is `{mass/10}d10`, resolved
  against the carrying ship's total mass with the die count rounded up. Literal
  `damage` is the fallback. The Component Workshop edits the formula, and the
  Ship Editor weapon selector shows the resolved damage. Migration 149 adds
  `ship_weapons.damage_formula`.
- **Ship image hex preview + finer map offsets (2026-10-31, migration 148)**:
  the Ship Editor image section is a dark 7-hex board (50 ft radius) with stars.
  The image keeps aspect ratio, scales to authored Keel length (default 100 ft),
  and uses `image_offset_y` in feet (positive = up); overhang is allowed.
  Migration 148 adds `keel_length` / `image_offset_y`. Map Editor offset sliders
  now step 0.5% of the scaled image and gain −/+ nudge buttons.
- **Manual ship weapon order + card layout polish (2026-10-31, migration 147)**:
  weapon selector options are alphabetical; child rows are manually ordered with
  ▲/▼ arrows and `ship_template_weapons.sort_order`. Weapon direction labels use
  Bow / Body / Port / Starboard / Stern; direction badges render only on weapon
  cards. Bow/Stern use 3 centered card columns over the 4-column middle, so all
  cards keep the same width and the hull narrows at the ends. **Apply 146 + 147
  in Supabase.**
- **Ship cards per unit + wider Body + no Ram slot (2026-10-31, migration 146)**:
  weapons always get one card per unit; Helm/Command bridge get one card per
  unit; other components use `ship_components.can_combine` (true = aggregate,
  false = per-unit). The Component Workshop exposes the flag. The weapon child
  list is manually ordered with ▲/▼. The deck is now Bow 4 / Port 4 / Body 8
  (two columns) / Starboard 4 / Stern 3; legacy layouts reshape on load and an
  overflow middle row adds +1 Port, +2 Body, +1 Starboard. The Ram slot and all
  Ram restrictions are removed; every slot is generic. **Apply 146 in Supabase.**
- **Ship summary + cargo simulation (2026-10-31)**: mid-panel summary is now
  three rows: Ship Mass / Armor / HP / DT; Cargo / Crew min-full / Ship cost /
  Weekly operation; Atmospheric speed / Space Acceleration / MC. Unlisted
  summary cells were removed. Full crew is
  `max(minCrew × 2, minCrew + weaponCrew)`. Weekly operation cost is
  `round(0.4% × ship cost + Σ crew weekly cost)`. A 0→max-cargo simulation
  slider defaults to allocated cargo and only changes
  `performanceMass = totalMass − maxCargo + simulatedCargo`; cargo allocation,
  cost, and saved cargo stay unchanged. Space Acceleration and MC use the
  simulated performance mass. Formula panel updated.
- **Ship crew HP/weekly cost + responsive weapon rows + helm cost (2026-10-31,
  migration 145)**: `ship_crews` gains authored `hp`; weekly `cost` is required
  (default `level² × 2 + 2`); new crew defaults are HP `10 + 7 × (level − 1)` and
  stats `12-14-14-10-14-10`. The Add/Edit modal exposes HP and weekly cost, and
  roster rows show `Name — Level N, HP N, S-D-C-I-W-C, N Gp`. The weapon child
  list is now full-width/responsive (no table inset). Helm cost is
  `max(0, helm − 1) × helm component cost`; the first helm is included in the
  hull price. **Apply 144 + 145 in Supabase.**
- **Ship master templates + derived crew/cost rules (2026-10-31, migration
  144)**: replaced all old ship templates with the 24-ship master list, dropped
  obsolete `crew_count`/`passengers`, set Sail crew to 0, and kept
  `atmospheric_speed` + ship-minimum `damage_threshold`. Min crew now excludes
  weapon handling crew; helm crew is one per helm; rudder crew stays 0.5 and
  rounds up per group. Full crew = min × 2. The roster is actual crew
  (`ship_crews` length), uncapped, but saving is blocked while it exceeds
  quarters capacity. Ship card DT = `max(ship DT, component/weapon DT)`.
  Composition costs are per row: hull = totalMass × 1000gp; weapon capacity row =
  capacity cost; each weapon child row adds its own cost; total sums. New
  templates seed structural values only; weapon tonnage becomes capacity and
  unallocated mass stays Reserve. **Apply 144 + 145 in Supabase.**
- **Region-container ship deck + stable weapon rows (2026-10-31, migration
  143)**: replaced fixed deck cells with five region containers
  (Bow/Port/Body/Starboard/Stern), starting 3×9. Cards can be dragged to
  move/swap; right-click a slot/card to move the slot to another region; a full
  deck adds a middle row above Stern. The **Ram slot** is fixed at Bow row 1
  middle: `max_range = 1` only, cannot leave it, cannot move, arc Bow. Weapon
  rows are one line (weapon/amount/derived direction/cost/remove); direction
  comes from the deck region, `mount_slot` is dropped, and
  `ship_template_weapons.id` is the stable UUID card key. Migration 143 adds
  `ship_templates.deck_layout`, drops `card_placements`, adds the weapon-row UUID
  PK, and drops `mount_slot`. **Apply 142 + 143 in Supabase.**
- **Ship cards v2 + weapon child list (2026-10-27, migration 142)**: added
  per-component/weapon `dt` (default 15); weapons are edited in a child list
  under Weapon capacity with hard capacity limits. Every purchased item becomes
  a layout card (superseded by the 143 region deck). Armor and
  reinforcement do not get cards. Reinforcement is assigned by right-clicking a
  card and shown as a thick silvery border; the first hit destroys the
  reinforcement, the next damages the component. Card = name, mass boxes,
  AC/DT, crew list; no images; rows stretch to the tallest card. **Apply 142 in
  Supabase.**
- **Ship catalog name normalization (2026-10-27, migration 141)**: every
  `ship_components.name` / `ship_weapons.name` is now a display name
  (`command_bridge` → `Command bridge`, `ballista_light` → `Ballista light`).
  `COMPONENT_NAMES` and built-in fallbacks use the new names; catalog saves no
  longer slugify, and pickers/cards display stored names directly. The migration
  aborts on normalized-name collisions. **Apply 141 in Supabase.**
- **Component Workshop cascade delete + usage warning (2026-10-27, migration
  140)**: deleting an optional component/weapon now cascades to
  `ship_template_components`/`ship_template_weapons` instead of failing on the
  FK. `ship_component_usage`/`ship_weapon_usage` RPCs let the workshop list the
  affected ship templates before confirming. **Apply 140 in Supabase.**
- **Merge ship accessories into components (2026-10-27, migration 139)**:
  accessories had the same columns as components, so every `ship_accessories`
  row moves into `ship_components` with its UUID; `ship_components.built_in`
  marks the rule components (edit-only), optional components are
  `built_in = false`. The join table is renamed
  `ship_template_accessories` → `ship_template_components` (`component_id`);
  `ship_accessories` is dropped. The Component Workshop is now
  Components/Weapons (no Accessories tab); New/Clone/Delete only for optional
  components. The Ship Editor’s **+ Add component** lists optional components
  and stores selections in `ship_template_components`. **139 applied; apply 140
  in Supabase.**
- **Component Workshop + ship catalog UUIDs (2026-10-27, migrations 137–138)**:
  ship catalogs (`ship_components`, `ship_weapons`, `ship_accessories`,
  `ship_armors`) now use UUID `id` + unique `name`, with template/join FKs
  migrated; built-in components are looked up by name. Added
  `/component-editor` (Components/Weapons/Accessories tabs) with admin/dm edit
  and everyone-view access. `ship_components.effect`; `weapon_large` removed;
  `weapon_small` → `weapon_capacity`, linked to the Ship Editor capacity row as
  per-ton metadata. `ship_weapons` gains `mass`/`min_range`, renames
  `range_std`→`range`, `range_dis`→`max_range`, `fire_cycle_rd`→`fire_cycle_step`,
  drops `mount`; authored mass controls ship mass, fire cycle is in steps, all
  weapons hittable. The Ram slot filters to `max_range = 1`. UI/docs/code use
  “mass” (unit “ton”). **Apply 135–138 in Supabase.**
- **Ship Editor v2 (2026-10-27, migration 136)**: kept the 3-panel editor. Middle:
  name/mass, authored atmospheric speed + damage threshold, summary (armor,
  HP, DT, atmo speed, wild-space acceleration, cargo, min crew/capacity, cost,
  weapon capacity), and a composition table (Hull read-only, Helm, Command
  bridge, Sail, Rudder, Weapon capacity, Armor, Reinforcement, Crew quarter,
  Cargo, accessory rows). Right: `ship_images` upload/preview, square
  component-slot layout (`ShipRenderer/ShipLayout` + `ShipComponentCard`: image/
  placeholder, boxes = tons, AC, hollow crew circles), placed-weapon list and
  crew roster. Weapon capacity is authored tons, counts toward mass, and limits
  placed small (1t)/large (2t) weapons. Catalog rows gained optional `image_url`
  + `ac` (armor uses table AC, others default 10). Sticky footer mirrors
  UnitEditor (Create/Save, Clone, Delete). Migration 136 adds the template fields,
  catalog columns, `hull` component, and `ship_images` bucket. **Apply 135 + 136
  in Supabase.**
- **Spelljammer mass-first overhaul (2026-10-27, migrations 134–135)**: no ship
  frames. The player designates a total mass; `hullMass = totalMass ×
  (10% + totalMass/500)`, `armorMass = totalMass × armor.massPct`,
  `HP = (totalMass × 3 + 40) × hpMult`, `accel = (sails + rudders)/totalMass ×
  15`, and `MC = x = rudders×10/totalMass` (`x<1 → 1/x+2`, else `4−x`) with
  effective MC `−1/0/+1` at speeds `0–2/3–7/8–12`, **clamped at 0** (Racer has
  MC 0). **Mass rounds each group to the nearest whole ton** (hull 2.8→3,
  rudder 4.5→5), so the five reference templates sum exactly. **Minimum crew
  ceils each component group separately** (Shuttle 3, Damselfly 13). **Crew
  quarters are authored tons** (capacity = tons × 5), not auto; passengers are
  authored default 0. Armor: Wood 0% AC15 ×1, Ceramic 5% AC13 ×2, Plate 10%
  AC17 ×1, Metal 20% AC19 ×1, Stone 30% AC17 ×2 (Star Moth 220 base → 440).
  Components: helm 1t/1, command bridge 3t/5, sail 1t/½, rudder 1.5t/½,
  reinforcement 1t (+10 temp HP, target later), cargo 1t, quarters 1t/5;
  weapons selected directly (large 2t, small 1t). Hit boxes are 1 ton = 1 box,
  no box HP (one hit destroys one box), hull + armor safe.
  `shipStats.ts`/types/mappers/editor/renderer rewritten; migration 134 drops
  `ship_frames`, reshapes `ship_armors`, reseeds `ship_components`, adds
  `total_mass`/`helm`/`command_bridge`/`reinforcement`; migration 135 adds
  `crew_quarters`/`passengers`. `tsc`, tests, depcruise (pre-existing warnings),
  build pass. **134 applied; apply 135 + 136 in Supabase.**
- **AI assist current scope + Halloween Siege docs (2026-10-26)**: Basic AI only;
  whole-activation climb objectives with a session-only top + base/crossing lock,
  redundant structure-edge wall pathing, wall-stat climb profile, rout <=2 MP per
  entered hex with one friendly pass-through and no voluntary AI drop. Preview
  routes/marks/`T` objectives are **local to the AI client** (not broadcast or
  persisted). Halloween Siege shipped for current scope (waves, break/arm/cancel,
  public badge, completion toast, non-atomic spawn limitation). Known limitation:
  parked Gnoll AO `(6,-4)`/`(7,-4)` approach oscillation. See `docs/dev/17`, `09`,
  `20`, player manual, and changelog.

- **Basic AI rewrite (2026-10-23)**: the battle-role/frontage/reserve planner was
  **replaced** by a small rule-based brain (`src/packages/ai/lib/{types,board,
  marks,planner}.ts`). Independent per-archetype marks (melee dynamic up to 6,
  ranged unlimited, flying 1, mounted 1 + a non-mounted friendly mark); melee
  stages at
  2–3 hexes and upgrades before attacking; ranged scatters within 6, travels
  Open and closes to shoot; flying prioritizes airborne targets (ranged at max
  range, else paid melee; no air swoop), otherwise climbs by movement
  (10 ft/hex, descent free), swoops ground targets and retreats to 20 ft/≥2
  hexes; mounted marks only outer-rim targets,
  scans for a legal rear charge each activation, otherwise paths to the closest
  valid charge-start point within pool + 1 (start need not be rear; only the
  landing must be rear-adjacent), with a hard 5-hex safety
  gate (3 when the hostile is in a friendly kill zone; target excluded), holds
  only at a valid start, ends facing the next charge lane, and only rear-charges
  when the landing is legal from its final front arc. A charge/swoop consumes
  **1 action converted to a full movement pool** (ground or fly) added to current
  MP; it may be the first or a later action (1+ action; no fly-point threshold),
  with the gate re-checked after any facing turn. The free attack needs no extra
  action. The AI plots at most one charge/swoop per activation, then remaining
  resources disengage/evade. Units spend all actions (melee/ranged
  attack twice; mounted is the charge → free attack → disengage exception).
  Executor gained
  `climbAttack`/`charge`/`swoop`/`chargeEnd`/`weapon` and move `elevation`;
  pure swoop validation moved to `combat/lib/swoop.ts`. Deleted
  `battleLine.ts`/`reserve.ts`/`roleMarkers.ts`; the Advanced AI project was
  cancelled (DB column retained only for compatibility). **Follow-up:** non-flying units starting in
  a hex-structure footprint or edge-wall enclosure cannot cross the perimeter
  (flyers exempt); flying/mounted charges use the canonical `chargeStanceFor`
  gate and the scenario **Charge and Swoop** toggle. Fully upgraded melee may
  enter hostile ZoC to attack; blocked marks retarget (engage → stage →
  progress), flank safety is adjacency-only, formed units consider all six
  facings, and a boxed-in unit can drop to Scattered to loose-move. Melee mark
  cap is dynamic (up to 6 reachable surrounding hexes); approaches use remaining
  path cost and the target is locked per activation. Adjacency is all six hexes
  and overrides farther targets; formation-up uses leftover MP to face adjacent
  hostiles; climbing is committed and cost-sequenced with no action reservation,
  and is **vertical-only** (no horizontal movement along a wall; a finished
  structure top moves normally). Melee finds free top gaps and climbs into a
  complex to fight interior top targets; mounted/flying are exempt. Routed
  enemies are fallback-only: ignored while any non-routed enemy exists;
  mid-execution attacks retarget to the next legal non-routed unit. **Preview**
  runs the full plot in a one-shot Web Worker with hydrated game settings; the
  UI stays responsive, Cancel/Reset terminates immediately, and a 30s watchdog
  only reports a genuine hang. A hanging unit is hard-locked to its top exit
  (free top first, then weakest threat) and routed hanging units drop down;
  structure-top defenders hold the wall and fight. Melee units do not reposition
  after an attack and hold against adjacent unreachable enemies. Climbs require a
  real action + strict MP capacity; the executor blocks negative actions/MP.
  Melee structure takeover assigns vacant top hexes first (quickest access), then
  defender marks only after vacancies are exhausted. No migration.
  `npm run check` passes.
- **Off-grid tokens are out of play (option 2)**: `isHexOnGrid` uses the axial
  `max(|q|,|r|,|s|) <= gridRadius` rule. Normal moves, withdraws, routs, and AI
  plans may cross the rim; afterward non-DM players and the AI cannot control
  the token, and off-grid tokens cannot be targeted or attack (DM/effective GM
  is exempt for recovery only). `withdrawDestinations` and
  `routRetreatPath` no longer clamp to the rim. No migration.
- **Historical AI assist Pass 1 + 2a + 2b (migration 130, commits `009a6b1`,
  `f4e3695`; superseded by the Basic rewrite):** the Advanced/stance path was
  removed. The legacy `ai_assist_advanced` / `ai_assist_players` columns remain
  DB-only.
  **Pass 1**: multi-maneuver one-pool movement (mounted move/turn/charge path
  allowed), no generic contact tax, no-attack turn surcharge, conditional target
  exclusion, line-bearing penalty, per-unit step budget
  `max(5, ceil(computeMoveBudget))`. **Pass 2a**: leftover-MP movement with a
  scored hold; line-order target/lane assignment (order-independent) and
  assigned-lane plan order; neutral hex-hash tie-break; cohesion (1–2-hex line +
  8-hex isolation) scaled by AGR; test-85 red-line and yellow/black 6-vs-6
  regressions. **Pass 2b**: aggressive simple self-protect tie-break; aggressive
  advance low-AC/isolated priority + non-lethal melee-lock penalty; defensive
  simple 1.6× safety weighting + stronger ranged ZoC; defensive ranged posture
  (Close far/no fire → Open/Scattered under fire → Scattered before melee);
  defensive cluster capped to the slowest member (slowest planned first).
  **Strict no-turn policy**: a 0-turn attack/charge always beats a rotation;
  turns are allowed only when they enable an attack/charge, and no turn is
  planned after an attack (AGR failure still spends the action). Defensive melee
  advances finish in one plan: a melee unit outside contact with actions/MP left
  takes the best no-turn progress move instead of holding, post-move attack
  checks use real `applyMoveCost` accounting, and the defensive cluster cap is
  measured from the initial plan snapshot so a fast member cannot escape it. The
  executor drops a unit's remaining steps if a turn becomes unaffordable.
  **Battle roles**: front-line-only pairing (enemy reserves one ring behind do
  not consume frontage slots), candidate windows can shift; fast surplus units
  (e.g. 4-MP wolf riders over 3-MP warriors) get flank/rear (aggressive) or
  rear-rank reserve (defensive) roles, with a same-end pair bonus; near-equal
  plans use `Math.random` (undo/redo preserves the committed plan). Defensive
  frontage **pairs the whole enemy front line first**: it uses the leading rank,
  promotes rear-rank melee units only when the leading rank is short, and shifts
  the frontage window laterally to the enemy front span. Only true surplus after
  full coverage becomes a reserve. Roles are dynamic: a unit that is not paired
  and not engaged behaves as a reserve; an engaged/melee-locked reserve is front
  line until freed, then returns to reserve duty. Aggressive
  rear attacks skip AGR and add rout-threat value; there is **no reserve in
  aggressive stance**, every unpaired unit flanks. **Fastest surplus units are
  forced to flank/rear when removing them leaves a contiguous frontage** (e.g.
  wolf riders O/P flank, G–L keep the line); interior fast units stay frontage
  if pulling them out would break contiguity, and the scoring strongly prefers
  fast end units as extras. Flankers **do not queue**: they retarget to the
  closest enemy locked by a frontage/structure unit, stage **at least three
  hexes from every hostile and never closer than the friendly front line**, and
  keep circling behind it. Once the main body locks a target — **including a
  same-plan lock** — they dash to its flank/rear and may attack that turn. They
  never attack a front arc and never front-charge.
Defensive reserves hold a **central station ~2
  hexes behind the line** (staggered, and split into sector groups on a very long
  line), optionally in **Scattered** while uncommitted. Reserves never take a
  normal front-line pairing slot; their mission is to face flank/rear threats
  and fill frontage gaps/holes. They react to the whole
  line: rear/flank threats in the hostile forward band first, then interior gaps
  and routed/dead frontage slots. Paired front-arc enemies already adjacent to
  the line are left to the frontage; a reacting reserve is exempt from the
  defensive speed cap.
  **Anti-idle**: a frontage/structure/committed-reserve unit adjacent to an enemy
  takes the best near-breakeven attack (`-8` floor) even with multiple actions;
  if its assigned lane is blocked/unreachable it advances toward the nearest
  reachable enemy instead of holding. A **defensive melee unit** turns to face
  the most dangerous adjacent flank/rear enemy before an attack that would
  expose it, even if that costs the attack; the facing decision is made once per
  activation so it cannot oscillate. An uncommitted reserve keeps holding
  and never advances on the line. Rout paths re-evaluate after
  each pushed-through friendly and rout movement maximises hostile-mass
  distance. Ranged-only units stand off and never enter contact; archer-reaction
  holds score clear LoS/range/arc lanes using only leftover actions. Structure
  defenders hold a standing hex/edge structure in every stance unless routed.
  Frontage/structure and committed reserves upgrade to the highest
  available org level before contact; flankers attack first and may chain two
  formation upgrades (Scattered → Open → Close) in one action; Scattered turns
  are free.
  `npm run check`: tsc, **1142 tests** (68 planner), depcruise, build. No new
  migration for 2a/2b. Superseded by the Basic rewrite; mounted charges, air
  superiority, and off-grid handling are now shipped. Remaining work is listed
  in `docs/dev/outstanding.md` and `docs/dev/17-enemy-ai.md`.
- **`ignore_climb` + `feather_fall` effects; `stairs` retired (migration 113)**: two new amount-less effect kinds authorable in every `EffectModifierFields` surface — **`ignore_climb`** (unit / edge structure / ground zone; waives the climb/elevation cost) and **`feather_fall`** (unit; ignores falling damage). `structureClimbCostBetween` takes a `waiveClimb` mover flag and returns 0 when the crossed edge carries `ignore_climb` (`structureWaivesClimb`); `makeCostOfHex`/`makeBlockedEdge` thread it from every mover call site (move, charge, reactions, overlay), and `handleClimbMove` makes an ignoring unit's climb free. Fall damage (`routeUnit` rout-off-wall, `confirmHeroFall`) is skipped when the faller has `feather_fall`. The old edge `stairs` boolean is **removed** (types, editors, label lists, `structureIsStairs`); the trapezoid-ladder graphic now draws for any edge structure carrying `ignore_climb`. Migration 113 backfills `stairs = true` → `{"kind":"ignore_climb"}` (templates + placed instances) and drops the column. `tsc` clean, 856 tests pass. **Apply 113 in Supabase.**
- **Structure elevation (Phase 2b, migrations 111–112)**: structures carry a top **`elevation`** (default 10; 0 = decorative) + edge **`stairs`**; effects carry `elevation`. **Dynamic ground**: a unit is *flying* only when `elevation > surfaceAt(hex)` (`structureSurfaceAt`), else *grounded*; `movePoolMode`/`moveBudgetUnit` take a surface; `computeOccupiedHexes(units, excludeId, surface=0)` is per-surface. **Climb**: 10-ft steps @ 4 MP (`climbPlan`, `climb_to`), `height/2.5`; stairs waive; mounted can't climb. **Hanging**: a unit climbs adjacent higher hexes staying in its origin hex; `climb_to` target + rising `elevation`; linear (up=target / down=own hex); hover +10 ft if ground occupied; can't retaliate; attacks/ZoC only at the wall top; rout = free-fall (d6/10 ft) + standard picker. **Flight blocking**: `flightBlockedHexes` (structure top > flyer → blocked; destination excluded so the elevation modal clears it; else "structure blocked flight passage"). **Ranged vertical**: reach `dist + climb` (down never extends); band `dist + up − down`. **Rendering**: constant offsets (non-flyer = half, flyer = full; climber toward target), structure/effect elevation badges (north vertex), stair trapezoid-ladder (variant C). Editors (Structure/Effect + placed modal) expose elevation/stairs. `tsc` clean, 851 tests, build clean. **Apply 111/112 in Supabase.**
- **Viewport-bound floating UI (`Floating`) + draggable-modal clamp**: new `src/components/ScenarioMap/Floating.tsx` (portal to `document.body` + `position: fixed` + measured viewport clamp + optional flip + z-index) is now the single primitive for every tooltip/menu — fixes left-panel tooltips trapped by `PanelsContainer`'s `backdrop-blur` (a `backdrop-filter` containing block for `fixed`) and clipped by its `overflow-hidden`. Migrated `UnitTooltip`/`MapInfoTooltip`/`UnitTemplateTooltip`/structure+effect tooltips/`ContextMenu` (measured, flips up, scroll cap)/Messages menu; hover handlers pass viewport coords; removed hard-coded clamps. `UnitEditorModal` draggable but clamped by measured size (no cropped bottom). Standard documented in `docs/dev/19-ui-panels-and-floating.md`. `tsc` clean, 840 tests, build clean. No migration.
- **Fly movement pool + unified flyer drop**: `flySpeed`/`flySpeedAvailable` is now a real aerial pool mirroring ground (**1 action = 1 full fly pool**, raw max; end-turn heroes full / units 0). The pool is chosen by origin/end elevation (`movePoolMode` in `src/packages/movement/lib/flying.ts`, + `flyMax`/`moveBudgetUnit`/`passengerDrain`): airborne start or end = fly, else ground. `moveUnitRecorded` writes `flySpeedAvailable` and drains an attached/rider hero **passively** (`frac = used/hostFlyMax`), never limiting; `rotateUnit`/`changeFormation`/`attachHero`/`swapHeroPosition` spend the fly pool while airborne. Tooltip shows **Ground Move** + **Fly Move** for flyables. Dropping a flyer on a ground-occupied hex opens a **unified modal** — **Move** (hover, min 10 ft; friendly = Move only) / **Swoop attack** (declared Swoop, fly-funded) / **Range attack** (hostile, from current hex); preview follows the origin pool. Withdraw is disabled airborne ("Cannot withdraw during flight."). `tsc` clean, 840 tests pass, build clean. No migration.
- **Swoop drop attack + melee-only free charge**: a declared Swoop (`isCharging && elevation > 0`) dropped on an enemy ground unit prompts — **Attack** = one atomic `ATTACK` command (charge `MOVE` + dive `ELEVATE` to 10 ft + `CHARGE` tick + free melee charge attack; the new `performSwoopDrop`/`planSwoopDrop`, `performAttack` gains `prependSubSteps`), **Cancel** = normal attack from the current hex. Offered only when the target hex is a legal forward-charge destination, enemy, visible, and the total charge distance reaches a full charge; attached heroes excluded; soft-gated. The charge free attack is now **melee-only** (land + swoop: `handleAttackRequest` charge branch gated on `!isRangedThisAttack`); a charging unit's ranged attack is a normal paid attack and the charge stays active. Same-hex melee now allowed (front-arc gate skipped at `dist === 0`). Overlay paints the swoop target amber. `tsc` clean, 836 tests pass, build clean. No migration.
- **Structure/effect editing + command-log structures; terrain cost folded into MP (migration 101)**: structure placement/removal/edit (GM brush + Shift+double-click `StructureEditModal`, which gains **Remove** + **Effects on this hex…**) ride the `STRUCTURE` command, so they are undoable/replayable. Editing a hex's ground effects is now **Shift + double-click** (a persistent per-hex list with Edit/Clone/Remove + **Remove all**, staying open after each remove); the right-click "Effects at hex" menu keeps Move up/down + Drop Effect. The standalone painted MP-cost layer (`maps.terrain_costs` / `map_data.terrainCosts`, the Map Editor "Movement cost" tab and the scenario Movement brush) is **removed** (migration 101 drops the column + strips the key). **The rule:** *the MP cost to enter a hex is the **higher** of every source, per locomotion — a hex structure's `mp_foot_in`/`mp_mounted_in` and the summed `mp_cost` of any ground zones; a negative value is a hard block (`X`); an open/broken door waives the structure MP; edge faces are directional and replace (not max).* `makeCostOfHex` implements "higher of the two"; `world/mapGeometry.hexMpLabelAt` + `useCanvasDraw` print `foot/mounted` (>1 / `X` / `-`). `tsc` clean, 756 tests pass, build clean. **Apply 101 in Supabase.**
- **AC is a derived aura (melee/ranged/rear)**: `ac` effects are no longer materialized into `currentAc` (which is now just the shield-adjusted base); `isStatEffect('ac')` false, `statFieldOf('ac')` null. New `effects/unitEffects.effectAcBonus(unit, isRanged)` (flat/both, or `mode`-scoped) is added by `units/unitStats.effectiveAc(unit, formation, direction, isRanged)` — the single AC source for the tooltip (melee/ranged/rear), combat, verbose, AI planner and reactions. Heroes add it too. Weapon-switch ac-rebase removed. Fixes AC not updating in tooltip/combat when entering a structure or gaining an `ac` effect. `tsc` clean, 742 tests pass, build clean. No migration.
- **Structure doors rework**: door state is now **instance-relative** (`structureDoorState`): `noDoor = doorNow >= hpNow` (fixes the damage loophole where equal pools drifted from template max), `hasDoor`, `intact` (`0<doorNow<hpNow`), `openOrBroken`. **Crossing cost** = base when open/broken (hex: base hex MP; edge: destination/inside hex MP — face cost omitted), else the structure MP. **Pass-through**: a hex structure with a door open/broken may be traversed (not stopped on) even when occupied while `hpNow>0` (`computeReachableMap` `passThrough` set via `doorPassThroughHexes`; wired into move/overlay/reaction). **Door control** (dynamic, own-turn, command-logged as a `STRUCTURE` sub-step): DM always, else the owner of the unit on the door hex (hex = structure hex; edge = inside hex) for an **intact** door only; non-GM gets a restricted Shift+double-click modal (Open/Close only). Doors still never block. `tsc` clean, 740 tests pass, build clean. No migration.
- **`block_attacks` + hex-structure→ground-zone unification**: new amount-less `block_attacks` modifier with `mode` (melee/ranged/both) and `direction` (in/out/both) sub-states — a **hard** block denying attacks into/out of a unit, a hex (ground zone or hex structure), or **through** an edge wall/gate (destroyed structure lifts it); healing exempt, AoE magic not blocked; gate in `src/packages/combat/lib/attackBlock.ts`, wired into `useCombatActions`/`useReactionActions`. Hex structures now expand into permanent ground zones (`movement/mapStructures.structureZones` → ScenarioMap `effectiveZones` fed to the whole zone engine), so all their modifiers run through the one engine; edge structures stay on the edge path; bespoke `structureRangeBonus` consumers removed to avoid double-count. `range` now extends **ranged weapons only** (`maxRange > 1`). Library editors (Unit/Ship/Effect/Structure/Weapon) unified to a persistent **Save / Clone / Delete** bottom bar (left-panel New kept; Save As/Cancel dropped). `tsc` clean, 723 tests pass, build clean.
- **Effects/modifiers one canonical `dice` amount (delta removed)**: `EffectModifier`/`UnitEffect`/`GroundEffect` carry the amount in a single `dice` string (flat number or dice; absent for flag kinds), removing the dual `dice`/`delta` representation that left the editor amount box blank and silently dropped dice on reload. New helpers `modifierAmount(dice)` (flat/signed, for stat+aura consumers) and `isDiceAmount(dice)` (per-troop rolls vs flat once). `parseModifiers`/`parseEffects` normalize legacy numeric `delta` → `dice` on read (no data migration). Editors seed `dice:"1"`; migration 099 presets store `dice`. `tsc` clean, 708 tests pass, build clean.
- **Structure template rework (migration 099)**: `map_structure_templates` is now direction-relative + locomotion-aware. Authored A/B faces + `hex_move_cost` replaced by `mp_foot_in/out` + `mp_mounted_in/out` (MP REPLACES terrain; `_in`=outside→inside, `_out`=inside→outside, hex uses `_in`; NULL=terrain; **negative=hard block**, bypassed by free move/DM). Durability is **two pools damaged simultaneously**: `door_hp` gates passage (`0`=passable), `max_hp` gates modifiers (`<=0`=instance removed); `door_hp` defaults to `max_hp`, `0<=door_hp<=max_hp`; `open` waives the door. One `modifiers` list with optional `mode:'melee'|'ranged'` on `ac`/`advantage`/`disadvantage`/`grant_*` (dropdown in Effect + Structure editors). Charge disabled by any crossing at 2+ MP ("any hex with MP cost 2+ will disable charge"). **Shift + double-click** a placed structure opens `StructureEditModal` (instance HP/door/open/outside + modifier override). Movement evaluation now pools every action as the budget while the hex-step cap stays at one pool ("Option 2": `computeReachableMap` `hopCap`) — units mirror heroes; execution already pooled. `movement/walls.ts`/`world/mapGeometry.ts`/`movement/mapStructures.ts`/`combat/structureCombat.ts`/`StructureEditor`/`StructurePreview`/`MapInfoTooltip`/`MapCanvas`/`useCanvasDraw` updated; 099 wipes instances + reseeds 9 presets. `tsc` clean, 707 tests pass, build clean. **Apply 099 in Supabase.**
- **Consistent table naming (migration 098)**: tables are now subsystem-prefixed, zero behaviour change. `user_*` identity (`user_profile`, view `user_profile_last_change`), `admin_*` global access/audit/settings (`admin_role_access_rights`, `admin_role_changes`, `admin_game_settings`), `scenario_*` runtime (`scenario_command_log`, `scenario_team_alliance`, `scenario_replay_state`, `scenario_role_access_rights`), `unit_*` land-unit system + lookups (`unit_races/_mounts/_weapons/_armors/_formations/_size_categories`; `units`/`unit_templates`/`unit_types` unchanged), `map_*` (`map_effect_templates`; `maps`/`map_structure_templates` unchanged), `ship_*` (`spelljammer_ships` → `ship_spelljammer`). Functions bound to renamed tables recreated; view renamed (OID-bound); client `.from()`/realtime/embedded-select/mapper keys swept; docs updated. Full mapping in `docs/dev/02`. `tsc` clean, 703 tests pass. **Apply 098 in Supabase — after pending 081/093/095, which name old tables.**
- **Map structures + Effects tab (migrations 093–095)**: `map_structure_templates` (edge faces A=inside/B=outside, battlement/spikes, door HP, 30/15 defaults) authored via `/structure-editor`; instances in `maps.structures` / `scenarios.map_data.structures` (per-key `STRUCTURE` command sub-steps; runtime `Walls` derived from edge instances). Map Editor **Structures** and **Effects** tabs; the Effects tab paints permanent `hex_effects` (`GroundEffect.permanent`, expanded on assign via `effects/mapEffects.expandHexEffects`). Attacks are **Shift + drop** (edge walls/spikes and hex gates/towers); **Shift held** hides unit/corpse tokens and shows `MapInfoTooltip` (hex effect+structure, separate edge tooltip; side-by-side with Shift). Tower auras, `range` modifiers and `enter_org_max` gates consumed by combat/movement; gate open/close. `combat/wallCombat.ts` / `combat/structureCombat.ts`; no AGR/retaliation on structures.
- **Archer rules (migration 091)**: formed formations shoot only into the front cone (`arcOfTarget`); any unit on the shot line makes it an **indirect shot** at disadvantage (`combat/lineOfSight.ts` + `RollModeInput.losDisadvantage`). `docs/dev/18` + `08`.
- **Attack-roll effects (migration 088)**: `advantage`/`disadvantage` (carrier's own attacks) and `grant_advantage`/`grant_disadvantage` (attackers vs the carrier) as boolean flag effects; `combat/unitCombat.combatRollMode` unifies them with the long-range band — **any advantage cancels any disadvantage (count irrelevant)** → normal, with a cause note; recomputed per attacker (hero volley uses its own flags via `AttackerHeroProfile`). UI kinds/tooltips show `attack roll`. Seed migration 088.
- **Always-recorded verbose messages (088)**: `GameMessage` gained `verboseText`; producers always build the verbose string and pass it as `execute`'s `verboseMessage`; `MessagesPanel` renders `verboseCombat ? verboseText ?? text : text`, so toggling verbose re-renders the whole history. `useMessageSync` broadcasts both. The command-log description stays plain.
- **Edge walls (migration 089, Phase 1)**: `src/packages/movement/lib/walls.ts` — a wall on the shared edge between two hexes, one **face per side** (`movement/moveCost` replaces the entered hex's terrain / `block` / `meleeAc` / `rangedAc`), keyed canonically `"q,r,dir"`. `src/packages/primitives/lib/hexLine.ts` (cube-lerp) finds the ranged-entering edge. Movement (`computeReachableMap`/`computeChargeReachable` take the from-hex + `blockedEdge`), combat AC (`resolveCombatSequence` optional `walls`), Map Editor **Walls** tab + in-scenario `WallPaintPanel`, snapshot into `scenarios.map_data.walls`. Phase 2 (destructible HP/DT) + Phase 3 (magic-wall effects) pending.
- **ZoC pursue + Withdraw (migration 090)**: leaving a hostile kill zone (`morale/zocDisengage.hostilesLeftZoc` — only real exits; entering/open-ground no longer fires) **scatters** a formed non-hero mover and provokes **one** aggression-gated pursue (`src/packages/morale/lib/pursuit.ts`): candidates ordered attacker → most MaxMP → most avail MP → random, each rolling `d10 ≤ AGR` until one passes (a failed candidate does not move; the selected pursuer always attacks — single AGR, no combat re-roll). Hero **Command-Presence leash** `command_pursuit_permit` (template + placed-unit editable, default **hold**); scenario toggle `zoc_pursuit_enabled`. **Withdraw** = drag a formed unit one hex into a rear hex (overlay paints them white) for 2 actions, keeping facing — never scatters/pursues, can't enter a ZoC; free under free-move. Renamed `opportunity_attack_used` → `pursuit_used`.
- **Earlier (context)**: `src/packages/movement/lib/moveCost.ts` ("1 action = 1 full MP pool" via `computeMoveBudget`/`applyMoveCost`/`applyMpSpend`; hero 5-action proration); `movement/formationCost`; combat (`combat/unitCombat.ts`, `combatRollMode`, hero volley); temporary effects (`effects/unitEffects.ts`); fog/darkvision; reusable maps + terrain (`maps` table + `world/mapEntities.ts`); 5-attack cap + hero actions; message sync broadcast.

- `src/packages/movement/lib/moveCost.ts` + `movement/moveCost.test.ts` (28 tests): `computeReachableMap(unit, maxMP, occupied, threatHexes)` over state space `(hex, facing)` — 1 MP per front-arc step, 1 MP per 60° turn; threat hexes reachable but never passed through; occupied excluded; Routed/Scattered/**Hero** move any direction at 1 MP/hex (loose). Plus the action-refill helpers: `computeMoveBudget` (leftover MP + `maxMP × max(1, actions)`), `applyMoveCost` (spends materialized MP first, converts an action to a full pool only when MP is exhausted; final MP = last pool's remainder, leftover stays usable), `applyMpSpend` (single-MP spend converts an action into a full pool when MP insufficient), `isMoveAffordable`, `computeMovePool` (full pool when actions ≥ 1, else leftover MP). Replaced `getReachableHexes` in ScenarioMap so the drag overlay and executed move cost share one source.
- `src/packages/movement/lib/formationCost.ts` + `movement/formationCost.test.ts` (6 tests): `applyFormationChange(currentMP, steps, oldMax, newMax)` — 1 MP per org-level step + proportional floor rescale, clamped to `[0, newMax]`. MP stays integer.
- `src/hooks/useGameEngine.ts`: `MOVE` via `applyMoveCost` (path MP spent first, action converts a fresh pool only when MP exhausted); `ROTATE` −1 MP via `applyMpSpend`, **non-hero only**; `FORMATION` via `applyFormationChange`, hero skips MP; `ATTACH_HERO`/`DETACH_HERO` −1 **hero** MP via `applyMpSpend` (action only on refill); `ATTACK` adds an action-deduction sub-step (spent even on AGR failure); `END_TURN` resets to **2 actions / 0 MP**. All deltas ride the command log so undo restores them.
- `src/components/ScenarioMap/ScenarioMap.tsx`: `handleUnitMove` reachability uses `computeMoveBudget` (leftover MP + action pools) and gates with `isMoveAffordable` (confirm modal when the move exceeds leftover MP + action pools); drag overlay = `computeMovePool` (one full pool when actions ≥ 1, else leftover MP); `handleDetachHero` uses `applyMpSpend`; shared `computeOccupiedHexes`/`computeThreatHexes` helpers.
- **Units start/reset at 2 actions / 0 MP**; MP is materialized when a move converts an action, and the move cost is spent from leftover MP first (so leftover MP is never wasted — it's the "still have 2mp" fix). `useSupabaseSync.ts` spawn sets `movementPointsAvailable: 0`, `actionsAvailable: 2`.
- Soft enforcement (never hard-blocks): a move exceeding leftover MP + action pools or an attack with 0 actions shows a confirm modal; confirming deducts fully (may go negative) and pushes a red notification.
- `src/contexts/MessageContext.tsx`: `GameMessage { text, tone: 'default' | 'error' }`, new `addError()`; `MessagesPanel.tsx` renders error-tone rows red.
- `src/components/ScenarioMap/UnitTooltip.tsx`: `Move: {floor(movementPointsAvailable)}/{max}` (actual materialized MP, drains per pool) + `Actions: {n}/2` (red when ≤ 0) with a `(1 = full move)` hint.
- `src/hooks/useSupabaseSync.ts`: spawn `movementPointsAvailable: 0`, `actionsAvailable: 2`.
- Earlier completed: combat system (`combat/unitCombat.ts`, 55 tests), size_categories data-driven row caps, `movement_multiplier`/`row_capacity_multiplier` on formations, tabbed left panel (Map → Alliances → Unit Selector → Messages, defaultWidth 400), dock toggle (hollow triangle, mirrored handles docked right), action badge on tokens (`drawActionBadge`/`getActionColor`), brace removed (optional rule in HANDBOOK §7.3).
- Docs: HANDBOOK §6.7/§6.10/§7.9/§7.10, `.scratch/movement-actions-tracking/spec.md` (status done), handover.md. `tsc --noEmit` clean, 145 tests pass.
- Bug fixes: `checkDMOnline` (useScenarios.ts:199) watched an empty `presence_check:` channel — reverted to `presence:${scenarioId}` so non-creators can join when the GM is online; `endTurn`/`handleEndTurn` double-incremented `turn_number` when the realtime event landed before the functional `setTurnNumber(t => t + 1)` — `endTurn` now returns the absolute `newTurnNumber` and `handleEndTurn` sets it explicitly (idempotent, race-free). Migration 013 applied to the DB.
- **Message sync**: `src/hooks/useMessageSync.ts` bridges the local `MessageContext` to a Supabase Realtime **broadcast** channel `messages:${scenarioId}` (`self: false`, event `game-message`) via a **per-scenario shared registry** — ScenarioMap + useGameEngine share one channel so received broadcasts dispatch exactly once; pre-subscribe messages buffer and flush on SUBSCRIBED. Every message producer now routes through it (`useGameEngine` uses the sync hook too), so combat/rout/move/undo messages broadcast, not just ScenarioMap-direct ones.
- **Rear-attack fix**: `combat/unitCombat.ts` — a rear attack now forces `strikerFirst='attacker'` and skips retaliation (was only the AGR skip), so a defender hit from behind can't strike first even with reach.
- **Global display name**: `supabase/migrations/015_profiles.sql` adds `public.profiles` (`id` → `auth.users(id)`, `display_name`, timestamps; RLS: select-all, insert/update own). `src/hooks/useProfile.ts` loads/creates the row from `user_metadata` fallback (`full_name → name → email`) with a module-level cache across mounts; Lobby header name is now a clickable chip opening a Change/Cancel modal; ScenarioMap `playerName` prefers `profiles.display_name` so command-log/message senders use it.
- **Archfar's Shipyard entry point**: migration `059_ship_editor_access.sql` adds `access_roles.can_view_ship_editor` + `can_use_ship_editor` (admin-only, extends `user_has_access` with `view_ship_editor`/`ship_editor`); `useProfile` exposes `canViewShipEditor`/`canUseShipEditor`; Lobby left panel shows an admin-only **Archfar's Shipyard** button opening a placeholder modal (builder gated later by `canUseShipEditor`).
- **Spelljammer v8.1 design files deleted (2026-10-27)**: the frame/parabola/TE
  design and its `.scratch` specs were removed; the mass-first model at the top
  of Completed is canonical.
- **Fog of war + Darkvision** (graded visibility, renamed from night_vision): migration `071_fog_of_war.sql` added `night_vision` + per-scenario `fog_of_war`/`sight_radius`; migration `072_darkvision_rename.sql` **renames `night_vision` → `darkvision`** (guarded) on `races`/`unit_templates`/`units` (kept at all three so nothing is lost; backfill template←race, unit←template — races are the authored source) and adds `darkvision` to the scenario map stack. `src/packages/world/lib/fogOfWar.ts` + tests: `unitSightRadius` = max(base, darkvision); `computeVisibleHexes(units, group, alliances, base)` = hexes within sight of any unit in the alliance group (own hex not counted but always visible); **`computeFog` returns graded `{ reveal, dim }`** — visibility is soft-ringed, not binary: the dim band is **edge-anchored up to 3 rings deep** (`FOG_RING_ALPHAS` = edge `0.6`, next `0.4`, next `0.2`; anything deeper + the unit's own hex crisp) and **hidden units exert no reveal at all**; where several units reveal a hex the **clearest coverage wins** (min alpha). Unseen hexes get the opaque veil for players (`1.0`) or translucent for the DM/replay (`0.8`). ScenarioMap toggles fog in Scenario Settings; `useCanvasDraw` renders the dim map + unseen veil (keys off `effectiveIsGM`, so DM-as-player gets real fog). Reveal follows the viewer's alliance; in replay it follows the acting alliance per step (`useReplay.replayCurrentTurnAlliance`). Hover/context gated by visibility. **Attack gate**: any unit (DM-controlled included) is blocked from attacking a hex its OWN side cannot see (`canAttackInFog` → `canAttackTarget` prop on `useCombatActions.handleAttackRequest` + `useReactionActions.handleReactionAttack`; red error; healing stays LoS-free).

- **Map entities (reusable authored maps)**: migration `074_map_entities.sql` adds `can_view_map_editor`/`can_use_map_editor` (admin + dm), rewrites `user_has_access`, and creates the `maps` table (`image_url` from `map_images`, `offset_x/y`, `scale`, `grid_radius`, `terrain_costs jsonb` `{"q,r": 0..9}` — 0 free, 1 default/clear, 2–9 cost — plus reserved `hex_effects`), RLS read/view + write/use. `src/packages/world/lib/mapEntities.ts` (+ tests): `MapEntity`/row mappers/`parseTerrainCosts`. **Movement now allows 0-MP hexes**: `terrainCostOf`/`movement/moveCost.stepCost` clamp at 0, and `computeReachableMap` caps reach by MP AND by hex-count hops (a 0-cost chain can't roam unbounded). **Map Editor**: Lobby button (`/map-editor`, `src/components/MapEditor/MapEditor.tsx` + `MapCanvas.tsx`) — ScenarioMap-style canvas + left panel with **Image** (map_images upload/list/offsets/scale/grid) and **Movement cost** (0–9 pen, click/drag paints each crossed hex) tabs; every edit **autosaves** to `maps`. **Scenario integration**: LeftPanel Map tab = `MapPickerList` (assign/clear) above the retained placement panel; assigning **snapshots** the map into `scenarios.map_data` (bg keys + `terrainCosts` + `mapId` provenance), `persistMapData` now always merges all layers (bg/terrain/zones/mapId) so no writer drops another; the DM keeps painting terrain costs on the scenario copy with the 0–9 palette. Walls/edges and map-authored hex effects deferred. Migration `074` awaits DB apply (072/073 too).

- **Temporary effects** (buffs/debuffs/DoT on units + ground zones): `units.effects jsonb` (`UnitEffect[]`) + migration `073_effects.sql` (column + `unit_field_to_column` + a jsonb `apply_substeps` branch). `src/packages/effects/lib/unitEffects.ts` + 17 tests: stat kinds `ac`/`morale`/`movement` materialize on the REAL fields (`currentAc`, `currentMoraleModifier`, `movementPoints` base) with a `base` snapshot; `dot` damages HP/troops each tick. Duration counts **activations of the caster** — ticks + DoT land at the start of the caster's activation (END_TURN transitions into its alliance); expires at 0 and restores; caster destroyed ⇒ expire immediately; no same-kind stacking. Ground zones live in `scenarios.map_data.groundEffects`; stat zones materialize as zone-membership effects at the unit's own activation (enter/leave auto), dot zones tick every standing unit; GM/tempo-null effects tick every activation. Commands: `EFFECT` (apply/remove/expiry fold into END_TURN so undo/realtime ride it); weapon switches rebase an active AC buff. UI: context menu → **Effects…** modal (catalog: Bless/Bane ±AC, Haste/Slow ±movement, Rally/Fear ±morale, Burning/Regen DoT; magnitude+duration+tempo), tooltip effect chips with remaining turns, colored pips on tokens, GM palette to paint zones. Migrations `072_darkvision_rename.sql` / `073_effects.sql` applied to the DB.
- **Unit 5-attack cap + hero 5-action economy**: migration `060_attack_cap_hero_actions.sql` (`units.attacks_used`, `movement_points_available` → NUMERIC, settings `unit_attack_cap`/`hero_actions_per_turn`, allowlist `attacksUsed`). `src/packages/combat/lib/attackCap.ts` (soft cap: every ATTACK command counts +1 incl. free/charge/AGR-failed; attacker-at-cap pause+modal+red msg; retaliator-at-cap pause+modal, declined = suppressed via `suppressRetaliation(..., atCap)`, stashed-resume keeps the same dice). `src/packages/movement/lib/moveCost.ts` hero variants: heroes start each turn at **FULL MP + 5 actions** (units 0 MP / 2 actions); each further action converts `maxMP/5` MP (1 decimal, fraction carries, display floors), `applyHeroMoveCost`/`applyHeroMpSpend`/`computeHeroMoveBudget/Pool`/`isHeroMoveAffordable`; attach/detach/swap ask "convert [#] actions to 1 MP?" when MP < 1; `endTurn`/spawn reset heroes to full MP + 5 actions, units 0 MP/2 actions + `attacksUsed 0`; tooltip `Actions: n/5` hero + `Attacks: n/5` units. 334 tests, `tsc --noEmit` clean. Migrations 059/060 applied to the DB.


### Active

- (none)

### Blocked

- (none)

### Pending

- **AI assist current scope complete (2026-10-26)**: whole-activation climb
  routes, session-only vacant-top/base/crossing locks, redundant-wall pathing,
  wall-stat climbs, rout ≤2 MP steps + one friendly + no AI drop, and local-only
  preview markers are shipped. Known limitation: parked Gnoll AO approach
  oscillation (see `docs/dev/outstanding.md`). Non-blocking follow-ups: archers/
  artillery refinements, AI magic/reactions/hero attach, ZoC scatter/pursue,
  some elevation nuances, per-team doctrine toggles; the AI never controls
  heroes.
- **Turn counter desync reported in playtest** (separate from AI roles): reproduce with End Turn / undo-redo before changing turn advancement.
- **Spelljammer module implementation** (mass-first builder/stats/renderer + Ship Editor v2 + Component Workshop + card v2 done in migrations 134–150; no engine code yet): ship engine files (`src/packages/ships/lib/shipMoveCost.ts`/`shipCombat.ts`, `src/hooks/useShipEngine.ts`), scenario instance table `spelljammer_ships` (already in migration 066), `src/components/ScenarioMap/ShipPanel.tsx`, sub-turn toggle engine setting, ship token rendering, reinforcement assignment/combat behavior, command-bridge bonus wiring. Migrations 068 (`ship_*` RLS), 069 (`ship_crews`), 070 (`extra_crew`→`crew_count`), 134–145, 176 and 177 are applied; **apply 146–150 in Supabase**.
- Migration `013_turn_tracking.sql` — applied to the DB (done).
- Migrations 010/011/012 — user applied to the DB.
- `UnitEditor.tsx`: `isHero` toggle should force `'Hero'` formation — postponed until the consolidated interface update.

## Agent skills

### Issue tracker

Issues live as local markdown files under `.scratch/`. See `docs/agents/issue-tracker.md`.

### Triage labels

The five canonical roles map to their default names (e.g. `ready-for-agent`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context repo — one `CONTEXT.md` + `docs/adr/` at the root. See `docs/agents/domain.md`.
