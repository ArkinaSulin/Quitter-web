# 21 — Spelljammer runtime

The **builder** (Ship Editor, Component Workshop, deck layout) is documented in
`16-ship-builder.md`. This chapter covers the **scenario runtime**: how a placed
ship is stored, moves, declares speed, and how the command log carries its state.

> Status: schema, instance storage, placement, turn/step engine, and the pure
> movement/declaration math are implemented. The ship window, card functions,
> and combat wiring are the remaining runtime slices (see "Remaining work").

---

## 1. Instance model

One row of `ship_spelljammer` = one ship on the scenario map. The table is the
instance boundary (do not read live template values for a placed ship).

Key columns (migration 155):

| Group | Columns |
|---|---|
| Identity | `id`, `scenario_id`, `template_id`, `name`, `team` |
| Placement | `hex` (text `"q,r"`), `facing`, `image_url`, `keel_length`, `image_offset_y` |
| Frozen design | `snapshot jsonb` — `{ template, build, stats }` captured at placement |
| Combat | `ship_hp`, `ship_hp_max`, `box_state`, `loaded_cargo`, `crew_assigned` |
| Speed/movement | `speed_stat`, `last_speed`, `declared_speed`, `speed_spent`, `turns_since_facing`, `elevation`, `step_budget jsonb` (5 ints) |
| Stations/crew | `stations jsonb`, `crew_state jsonb` |
| Weapons | `reload jsonb`, `card_state jsonb` |
| Visibility | `hidden` (DM hide; players cannot see/interact) |
| Sync | `is_deleted`, `command_seq` |

The **snapshot** is why a later Ship Editor edit never changes a placed ship. A
future persistent "player ship" table can reference `ship_templates` and own the
long-lived record; `ship_spelljammer` stays the per-scenario battle instance.

Placement snapshots the roster as it exists when the ship is dropped: the Ship
Selector's `fetchShipLibrary` joins `ship_crews` (components and weapons too), so
`snapshot.template.crews` / `snapshot.build.crews` include the template crew and
the ship window's roster lists them as available. A ship placed earlier keeps
its frozen snapshot; add crew through the ship window roster, or delete and
re-place the ship to pick up template changes.

Migration 156 enables RLS: scenario participants may read; only the scenario GM
may write directly. Runtime writes go through `execute_command`, which is
`SECURITY DEFINER` and bypasses RLS.

Legacy `scenarios.map_data.ships` is gone. Placement writes a `SHIP` command.
Placement messages and the DM-only crew roster commands (adjust/revive/discard)
stay on the DM's own screen (`execute(..., { localOnly: true })` or the `PLACE`
rule for `isGM`); other clients still receive the ship state through realtime.

---

## 2. Scenario mode

`scenarios.ship_mode` (DM-only, migration 152):

- **`wildspace`**: speed declaration, 5 steps per round, no elevation.
- **`atmosphere`**: atmospheric speed is a flying-point pool; normal turn order;
  elevation uses the flying-unit rules (climb and dive both cost 10 ft/hex).

`scenarios.ship_firing_arcs` (default on) toggles per-weapon arcs; off = every
weapon except the ram fires 360°. When on, a target at **any range** is resolved
to its nearest hex direction and then to the ship’s facing sector: bow (front two
directions, 120°), stern (rear two, 120°), port (left, 60°) or starboard (right,
60°). The resolution uses exact integer cube coordinates, so it is stable at
sector boundaries and identical to the adjacent-hex rule.

New games default to **atmosphere** (migration 159); existing rows keep their
mode. `scenarios.ship_step` (1..5) is the wildspace step counter. **Turn 0 is
free play:** no steps, no speed declaration; ships are placed freely (any
on-grid hex, facing toward the drop).

---

## 3. Wildspace round structure

A round has 5 steps. Alliances cycle every step:

```
friendly step 1 -> enemy step 1 -> friendly step 2 -> enemy step 2 -> ... -> step 5
```

`advanceShipStep(currentStep, allianceWrapped, leavingFreePlay)` in
`src/packages/world/lib/turnState.ts` is the canonical helper. A full alliance
cycle advances the step; step 5 -> 1 increments `turn_number`.

Per-step action economy (`useGameEngine.endTurn`):

- Heroes not on a ship: **1 action per step** (unused is lost).
- Non-hero units: **1 action per step on the first two steps**, any 2 steps,
  capped at 2 per round.
- Atmosphere keeps the existing per-turn refresh (heroes full MP + 5 actions,
  units 0 MP + 2 actions).

---

## 4. Movement pools

A ship may have three pools (`shipMoveCost.ts`):

- **Land MP** — on the ground / structure top, same unit movement/turning rules.
- **FP** — atmosphere airborne; fixed `atmosphericSpeed`. The pilot may spend
  none, part, or all of it during the turn (formed-unit style). Implemented as
  `atmosphericSpeed − speedSpent`; remaining FP is shown on the ship readout.
- **Speed** — wildspace; the declared speed split over the five steps. The pilot
  **must spend the whole current step budget** before the step can pass. The
  whole-turn remaining movement is the current step remainder plus all later
  step budgets.

Atmosphere moves may also change altitude: each hex moved allows up to **10 ft of
free climb or dive** (never more than the path length in hexes), chosen with the
same altitude slider used by flyers on drop. Wildspace remains 2D.

### Ship control

A ship is controlled by its **control team**: the Helm hero’s team; otherwise the
captain’s team when the helm crew belongs to the same alliance. That player (or
the DM) may drag/move the ship during the ship’s alliance turn. Free play keeps
the same piloting rule but has no turn/movement limits. A single click selects a
ship; **double-click opens the ship window** (a unit token on the hex wins the
double-click). While Fire or Ram targeting is active, double-click is ignored so
it cannot open the window mid-shot.

**Free Move / turn 0.** When the scenario Free Move toggle is on (or turn 0 free
play), a controlled ship may be picked up and dropped on any on-grid hex. This is
pure repositioning: **no facing change**, no speed/step-budget/FP spend, and no
declaration or movement-state reset. Rotation in Free Move changes only `facing`
— it spends nothing and does **not** reset the facing-distance counter. Atmosphere
still asks for the drop altitude (free, ±10 ft per hex of distance, clamped at
0 ft); wildspace keeps the current altitude. The whole grid is highlighted while
dragging.

### Right-click ship menu

Right-clicking a ship (with no unit under the cursor) opens the ship context menu:

- **Rotate Left/Right** — 60° for 1 pool point, obeying the MC gate
  (`turnsSinceFacing`). Free play rotates freely. Rotation can spend remaining
  step MP.
- **Hide/Unhide** (DM only) — toggles `hidden`. Players cannot see, click, drag,
  or open a hidden ship’s window; an already-open window closes. Hidden ships are
  dim (0.3 alpha) for the DM. Heroes may remain aboard.
- **Delete Ship** (DM only) — blocked while any non-deleted hero is attached;
  the error names the hero(es). Otherwise sets `is_deleted`.

Undo/redo re-reads ships after any `SHIP` sub-step so a deleted ship is fully
restored (not just a partial local row).

### Persistent player ships

A player ship is a persistent row in `ship_player` linked to a normal
`ship_templates` design. The row carries identity + runtime only: name, shared
serial, HP, damage, crew HP/dead state, cargo and the deployed scenario link.
Heroes are never part of the ship record.

- **Claiming:** the first player ship starts as an ordinary placed ship. The DM
  right-clicks it and chooses **Make Player Ship** at the bottom of the menu,
  then confirms and enters a ship name. `convert_ship_to_player` uses that name
  for the persistent row and current map instance, creates the initial **v1**
  version, links the instance, and allocates the shared A,B…ZZ serial if missing.
- A released player ship appears in **Player Ships**; dragging it onto a map
  re-creates a `ship_spelljammer` instance with `player_ship_id`. Multiple
  **different** player ships can be deployed, each once. Player ships are
  un-teamed like ordinary ships: anyone may board/pilot under the normal
  helm/captain rules.
- The DM can open **Dry Dock** from the ship context menu. This sets
  `ship_spelljammer.dry_dock_open`, shows the shared dry-dock window to all, and
  blocks movement/turning for that ship.
- A dry-dock window has one active editor lease (`editor_user_id` +
  `editor_heartbeat_at`, 30 s stale). Participants click their own name to take
  it; the DM can force-release.
- **Save Ship** restores full HP, records the repair cost (100 gp per missing
  HP, display only), updates the persistent runtime, appends an immutable
  `ship_player_versions` full snapshot, updates the scenario instance, and
  creates a version number. Every save creates a version; nothing is
  overwritten. Design/crew/cargo edits are made in Archfar's Shipyard and are
  re-read into the scenario snapshot on Save.
- Releasing a player ship (DM heartbeat stale, explicit close, deletion) clears
  `deployed_scenario_id` and the editor lease; it never syncs automatically.
  The persistent ship and version history remain visible in the Player Ships
  section.

### Speed declaration

The declaration panel auto-opens at wildspace **step 1**; it can be reopened by
the controller/DM at any step:

- **single-click** a controllable ship whose speed is not declared this round, or
- click the **Speed** row in the ship window’s ship summary (works even after
  a declaration, so a wrong/misdirected declaration can be replaced).

```
declared = previousSpeed ± freeAccel ± spellHexes
```

- `freeAccel` is capped by the **derived** acceleration
  `((sails + rudders) / mass) × 15` from `shipStats.ts`. Gameplay displays and
  rules use `floor(acceleration)` (the Ship Editor keeps the decimal reference).
- Re-declaring preserves `speed_spent`, `turns_since_facing`, and the completed
  step budgets; only the current and later step budgets are rebuilt so the new
  whole-turn remaining equals `newSpeed − alreadySpent`.
- A re-declaration may not go below movement already spent this round:
  `spent = declaredSpeed − wholeTurnRemaining`. The minimum is `spent` (>=, so a
  ship that moved 11 may declare 11, which leaves zero movement). Declaring
  below the minimum is rejected and the old declaration stays.
- `lastSpeed` is the **previous round’s final declared speed** and is not changed
  by a declaration. It advances at the full round boundary (END_TURN) from the
  outgoing `declaredSpeed`. Re-declaring in the same round therefore always uses
  the same base and cannot compound toward 12.
- `spellHexes` is signed; cost = `|hexes| × max(1, round(mass/10))` spell slots.
  The cost is informational for now (helmsman slot tracking is a future task).
- Speed is an integer in `0..12`; round 1 starts from `previousSpeed = 5`.
- **Declaration is mandatory before moving.** Every piloted wildspace ship must
  declare each turn; `0` is valid. Closing the popup accepts the previous speed
  (`accelDelta = 0`, `extraHexes = 0`) so it still counts as a declaration. The
  move/turn error names the ship: “Declare {ship name}’s speed before moving.”
- The popup goes to the **Helm hero → captain with same-alliance helm crew → DM**.
  `declared_round` prevents repeat popups; an undeclared ship keeps `lastSpeed`
  and is checked again next turn.
- The panel previews the resulting **base MC** and applies any rudder trim.

### Step budget / atmosphere

Wildspace uses cumulative rounding (`splitSpeedAcrossSteps`):

```
step_i = round(total × i / 5) − round(total × (i−1) / 5)
8  -> [2,1,2,1,2]
11 -> [2,2,3,2,2]
```

Atmosphere uses the fixed `atmosphericSpeed` pool and reset-per-turn `speedSpent`;
leftover atmosphere MP is allowed.

### Turning / MC

- A facing change costs **1 pool point**.
- It is legal only after the ship has travelled `ceil(effectiveMC)` hexes since
  the previous facing change. The counter resets **only on a real facing change**
  (normal rotation); it persists across End Step/End Turn, speed re-declarations,
  and Free Move.
- MC 0 turns freely (still 1 pool point per turn).
- Base MC comes from the speed band (`mcBands` in `ShipDerivedStats`). The
  rudder trim subtracts `mcReduction` for the turn (`effectiveTurnDistance`).
- **Display:** the in-play ship window and ship tooltip show MC as an **integer
  ceiling** (`ceil` of the band/raw value), matching the turn gate's
  `ceil(effectiveMC)`. The Ship Editor and dry dock keep the decimal, because
  builders use the fraction when tuning rudders (`shipStats` keeps `round1`).
- Movement is forward into the front two arcs (formed-unit style).

`computeShipReachable(start, pool, turnDistance, opts)` returns reachable hexes
with cost, path, final facing, and an `endable` flag. Occupied hexes can be
passed through but not ended on; structures/obstacles can block entry.

### Movement preview

- **Atmosphere:** show the full remaining pool as legal (white fill + movement-left labels).
- **Wildspace:** show the current step’s remaining budget as **legal** (white),
  and the rest of the turn’s step budgets as **potential** (blue, `~movement-left` labels).
- Front movement uses canonical `HEX_DIRS` (facing 0 = north-west/north-east).
  Dropping on a potential-only hex is rejected with an error; potential is for
  planning only.
- **Free play:** whole-grid placement preview.

### Back readout

Each ship draws two large, upright, centered numbers at the **center of its hex**:

- **Line 1** - `whole-turn remaining FP / speed this turn`:
  - wildspace: current-step remainder + later step budgets / declared speed;
  - atmosphere: remaining atmospheric FP / atmospheric speed.
- **Line 2** - hexes travelled since the last facing change
  (`turnsSinceFacing`). The number turns **green** when it reaches the effective
  MC after rudder trim (`effectiveTurnDistance`), i.e. when a turn is legal.

An atmosphere ship with altitude also shows a small `X ft` altitude label above
the two numbers. White text with a black outline; size scales with the ship
image/zoom (roughly double the old stern-label size), so it stays proportional to
the grid. Hidden ships dim with the image for the DM.

### End Step gate (wildspace)

The step cannot pass while a non-destroyed, piloted ship of the current alliance
has speed > 0 and either:
- has not declared speed this turn (“declare speed”), or
- still has current-step MP left.

No-pilot, speed-0, destroyed, atmosphere, and free-play ships are exempt. There
is **no stranded exemption** — ram/dodge are the intended future escapes.

---

## 5. Command log

New `SHIP` sub-step (migration 157):

```ts
{ type: 'SHIP', unitId: shipId, description, changes: [
  { field: 'hex', from, to },
  { field: 'facing', from, to },
  { field: 'row', from: null, to: shipRow }, // placement / full snapshot
] }
```

- Field names are camelCase; `ship_field_to_column` maps them to snake_case.
- `row` upserts (or deletes when `to` is null) the whole instance.
- Undo/redo/replay ride the same deltas, exactly like `STRUCTURE`/`ZONE`.
- Client optimistic apply: `useGameEngine` accepts `setShipLocal(shipId, patch)`
  (wired to `useShips`).

---

## 6. Key files

| Concern | File |
|---|---|
| Instance types/mappers/speed split | `src/packages/ships/lib/shipRuntime.ts` |
| Speed declaration + reachability | `src/packages/ships/lib/shipMoveCost.ts` |
| Scenario ship hook (load/realtime/optimistic) | `src/hooks/useShips.ts` |
| Step helper | `src/packages/world/lib/turnState.ts` (`advanceShipStep`) |
| Turn refresh | `src/hooks/useGameEngine.ts` (`endTurn`) |
| Placement + mode settings | `src/components/ScenarioMap/ScenarioMap.tsx`, `TopBar.tsx` |
| Migrations | `151` (stats/saves), `152` (mode/step), `153` (reload + AoE), `154` (ram/hull crew), `155` (instance columns), `156` (RLS), `157` (`SHIP` log), `158` (place insert fix), `159` (realtime/default/declared round), `160` (boarding fields), `161` (crew team), `162` (replica identity), `163` (Deck + hull split), `169` (card_state / universal card-step ledger) |

---

## 7. Rules locked for the remaining slices

**Ship control belongs to the helmsman (the spelljammer).** Ownership/control
scans functional helm cards in deck order: first functional helm with a hero,
else first functional helm with an NPC crew. A destroyed first helm hands
control to the next functional helm. NPC crew default to team `blue`, so a crewed
ship always has a crew side. The ship never moves without a helm occupant.

A **captain** (a hero on a full Command bridge) may control a ship through a
**same-alliance NPC helmsman**. The captain is not attuned to the helm and cannot
pilot alone; if an enemy hero takes the helm, ownership flips immediately and the
old captain loses control.

The ship image has **two silhouette glow passes**:

- **Outer (larger) glow** = the helmsman's alliance colour (`ship.alliance`).
- **Inner (smaller) glow** = the crew team's alliance colour
  (`allianceOf(ship.crewTeam, alliances)`).

When both sides match the two passes share a colour. Contrasting rings flag an
odd split, e.g. a friendly hero holding the helm while the original enemy crew
still mans the decks: the ship moves on the friendly helmsman's turn while the
enemy-crewed weapon cards act on the enemy turn.

**Weapon control is separate from ship control.** Each card's leader is the
**highest-level living hero on that card**; otherwise its **NPC crew** lead it.
`shipAccess.shipCardLeaderTeam` returns that team (leader hero → `ship.crewTeam`).

- **Crew auto-load** is clocked per weapon card on the **card leader's alliance
  turn**, independent of the helmsman.
- **Manual Load/Fire** may only be ordered on the **acting hero/captain's
  alliance turn**. Free play ignores the turn gate; the DM always bypasses it.
- **Firing hostility** follows the **firing actor's** alliance, while the target
  ship's side is its helmsman's. A DM or an ownerless target is not treated as
  allied.

`ship_spelljammer.team` is never written by the client and is not consulted for
any of these gates; helm ownership and card leadership are canonical.

**Hero transitions.** Attach, detach, embark, and disembark are all
adjacent-hex-only. Boarding requires the hero to be beside the ship; detaching
from a unit requires an adjacent destination (same-hex detach is allowed).

**Hero tokens on the deck.** Token visual width = `min(card width, card height)`
(min card width 64px); the drag hitbox is 50% of the token. Horizontal clamping
uses the hitbox (transparent edges can extrude sideways); vertical clamping uses
the full token (no spill onto cards above/below).

**Card UI.** Weapon cards show AC/DT/Dmg plus `load x/y`/`Armed` and a Fire
button. Crew slots show actual occupants (heroes first, then crew), with hollow
slots for remaining crew requirement. Dragging a hero token off the ship window
to an adjacent map hex disembarks it (same elevation, unoccupied, target-hex
terrain MP).

**Deck & hull.** Every ship has a mandatory hittable **Deck** card carved out of
the hull: `deck = max(1, round(hull x 0.2))`, `hull = allocated - deck`. The Hull
card is always present as the **no-box Hull exception** even when `hull = 0`, and
is the repair station; Deck is never the repair station. Deck is movable in the
Ship Editor but non-removable.

**Hull holds the ship together.** The hull is the ship's structural spine: when
every hull box is destroyed the ship falls apart and its HP is **0**, regardless
of any HP it still had left. A fully destroyed hull has no repair station
(capacity 0), so it cannot be repaired. Deck and other cards can be at 0 boxes
without destroying the ship.

The Hull card is a hard **3-slot repair station** on every ship (until the hull
card is destroyed). Its slots appear only while occupied: a hero dropped on the
card shows the three circles, and they disappear again when the card is empty.
Those slots do **not** count toward the ship's min/full crew and are **not**
filled by Auto assign; they are filled by hand (context menu **Fill station**,
or dropping heroes). A card's hero capacity still equals its crew requirement;
**Deck and Cargo are unlimited** hero holders. Boarded heroes default to the Deck
(the primary gathering spot), then Cargo. There is no crew-quarters displacement.
Sail crew = `max(1, floor(sails/4))`, rudder crew = `max(1, ceil(rudders/2))`.

**Crew checks.** Generic crew default to Str 12, Dex 14, Con 14, Int 10, Wis
12, Cha 8 and implicitly have CrewSkill (+2 on ship checks). Heroes use their
own stat + proficiency, never CrewSkill. Sail speed uses Con (DC current
speed+10), rudder MC uses Int (DC 26−MC), helm/ram uses Wis, bridge uses Int (and only functions at its full crew complement), repair uses Str.
**Sail maxing and sail trimming** are one-check **card functions**. Each attempt
spends **1 card step** and **1 action from every living hero on the card** (NPC
crew conceptually spend an action but have no tracked pool); with no hero on the
card, the **captain** (or **helmsman** when no captain exists) pays instead. With
nobody to pay, the attempt is blocked. The check uses the best occupant's bonus
(crew or hero): Con vs `current speed + 10` for sail maxing, Int vs `26 − MC` for
sail trimming. A failed check still spends the action/card step and is
logged/messaged; a success locks that card function for the rest of the turn
(both Speed +/− for sail maxing, Trim MC for trimming) until the ship's next turn.
The same permission gate as repair applies (a player with a hero on the card, the
captain, a helmsman when no captain exists, or the DM). A successful sail maxing
adjusts the current step budget by ±1 with a **soft lower clamp at 0** and no
upper clamp; above 13 shows a warning. Rudder trim stores `mcReduction = 1` for
the turn (the turning/movement application lands with the movement pass).

Repair is `4d8 + best repair bonus` (Str + proficiency, +2 for NPC crew), capped
at 80% HP, and the **same one repair kit** also restores **one ton** of a damaged
card (it can revive a fully destroyed card to 1 box and make it operational
again). Repair needs 3 heroes/crew on the Hull card and one Ship repair kit; it
heals HP, repairs one ton, or both, and ignores whichever part is not applicable.
A repair spends **1 card step** and **1 action from every hero on the Hull card**
(crew cost nothing); when no hero is on the card, the **captain** (or the
**helmsman** when no captain exists) pays the action instead. Trigger it as a
same-team player with a hero on the card, the captain, a helmsman when no captain
exists, or the DM; the damaged-card chooser follows the same group and first click
wins.

**Card steps.** Every card function except Fill/Empty station spends one of the
card's **5 card steps per turn**. Wildspace: at most one card step per global
step; atmosphere: all five are available during the turn. Once a card is at 5/5,
an approved **negative action** may still use it: the function happens, but no
card step is spent and the hero action is logged as a separate `OTHER_ACTION`
command. Fill/Empty station is free.

**Ram.** The Ram component sits in its normal weapon slot and exposes a **Ram**
card action (no reload/load step). Only the ship’s **helmsman/controller** may
order it (hero helm, or a same-alliance captain/DM through an NPC helm); weapon
card heroes and crew do not authorize it. The button is enabled only when the
helm/bridge hero has an action available **and** a hostile ship is in one of the
two forward hexes (range 1). A ram spends **1 hero action** from that
helm/bridge hero plus **1 card step**, and has **no once-per-turn limit**. The
chosen target must stay hostile and in the two forward hexes at resolution.
Contest
attacker Wis+PB(+CS) vs defender Wis+PB+8. Damage is
`min(floor(currentMass/10),16)d(speed)`; with a ram the target takes full and the
attacker half, without a ram both take half. Random per-card box damage; movement
forfeited; both shift along the heading according to the ram type (piercing
shifts both, bludgeoning shifts only the target).

On a hit the target’s **speed becomes 0 for the rest of the round**: wildspace
zeroes all remaining `stepBudget`s and sets `declaredSpeed`/`lastSpeed` to 0;
atmosphere spends the whole atmospheric pool. The next round starts from 0.
Clicking **Ram** enters target mode (the cursor becomes the amber target rings);
click a ship in the two forward hexes to resolve, or Escape/right-click to cancel.
The Helm card shows a disabled **Dodge** placeholder instead (not implemented).

**Weapon/Ram targeting cursor.** While a ship weapon or ram is waiting for a
target, the map cursor is the same amber concentric-ring marker used for the
reaction target (`#f59e0b`). This makes the target-select mode unmistakable.

**Deck pan/zoom.** The deck viewport is a fixed box (fills the ship-window
border / the Ship Editor right column), with no horizontal or vertical
scrollbars. The deck is drawn with `translate(offsetX, offsetY) scale(zoom)`:
- Minimum zoom is the fit scale (`min(viewportW/contentW, viewportH/contentH, 1)`),
  so all cards can always be brought on screen; maximum zoom is 2x.
- Wheel zoom anchors at the mouse: `world = (mouse - offset) / zoom`, then
  `offset = mouse - world * newZoom`. The point under the cursor stays put.
- Middle-mouse drag moves the deck like the scenario map (window-level drag, no
  scrollbars); vertical and horizontal panning both work.
- Hero tokens are measured unzoomed and scale once; the drag ghost is portaled
  to `document.body` so it follows the pointer. Card right-click is always
  consumed (the editor opens its card menu; the runtime suppresses the browser
  menu).

**Crew roster UI.** Shared `CrewRoster`/`CrewAdjustDialog`/`RepeatStepper` in the
Ship Editor and scenario ship window. Crew are grouped by **name + level + stats
+ cost, ignoring HP**; unnamed/auto-named crew display as **Crew**, and dead
groups show a skull. Rows have a narrow leading count column (2 digits) showing
how many crew are available in that line, then Name/Level plus a tiny skull slot
(the station/status column was removed); the inline `xN` suffix is gone. The
scenario roster lists **only unassigned/reserve crew** — anyone on a station
already appears on that station card, so repeating them hid the reserve pool.
Example: 5 identical Crew with 2 on a weapon card → the roster shows `3 Crew`
and the weapon card shows the 2. The Ship Editor has no station assignment, so
all its crew are available. The panel header reads **Crew reserve**, and the
empty state reads **No crew in reserve**. The `+/-` Adjust dialog acts on the
whole group, and dead groups Revive (full/partial) or Discard together. Runtime
edits update the snapshot, crew state, station lists, and recompute stats;
adjusting an available group preserves assigned crew. Crew, hero and card hover
tooltips are bounded to their panel: below-right first, then left/above when
space is short.

**Ship summary.** The left panel order is AC/DT, HP, Mass, indented **Current**
(`performanceMass`), **Crew**, **Food & water** with indented **Min** and **Full**,
**Acceleration**, **MC**, then **Speed**. Only current values update live.
- **Acceleration** is `floor(stats.accel)` in gameplay.
- **Atmosphere MC** is the single base MC at the fixed atmospheric speed (no
  band list); **wildspace MC** keeps the three speed bands.
- **Speed** is exclusive to the mode: atmosphere shows `atmosphericSpeed`;
  wildspace shows the declared speed (or “Not declared”, with the re-declare
  button). “Atmo speed” and a separate space row are not shown together.

A **Best in ship skill** block below the summary lists the best living crew plus
heroes stationed only in Deck/Cargo for **Helmsmanship (Helm)**, **Captaincy
(Bridge)**, **Sail Trimming (Rudder)**, **Sail maxing (Sail)**, **Weapon handling**
and **Repair (Hull)**. It stays visible to every viewer.

**Bridge card status.** The Bridge card shows an action-style **Command bonus**
button in place of its note. It lights when the bridge has its full crew
complement (the bridge only functions fully crewed) and is dim otherwise; it has
no card function yet.

**Station roles, card functions, and card visibility.** `shipViewerAccess`
(`packages/ships/lib/shipAccess.ts`) derives the viewer's role from the ship's
station cards and the heroes aboard. Units have no per-player owner, so "my
hero" means a hero whose `team` matches the viewer's team (same-team players
share the role).
- **Captain** = my hero is on a Bridge while every Bridge card is at
  full complement (crew + heroes ≥ required).
- **Helmsman** = my hero is on a Helm card.
- **Visibility:** the DM, a captain, **or a helmsman** sees every card in full.
  Any other stationed hero sees only their own card(s) in full; every other card
  renders **name + boundary only** (no boxes, AC/DT, crew, weapon info, card functions,
  status tint, hero tokens, or tooltip). A player with no hero aboard sees every
  card name+boundary only.
- **Crew management (Fill/Empty, Auto, Clear, Fill Helm, crew team):** the DM
  and a captain manage every card. A helmsman manages every card **only while no
  captain exists**; with a captain present the helmsman is limited to the Helm
  card. Any other stationed hero manages only their own card(s).
- **Card context menu:** right-click a card with crew slots to get **Fill
  station** and **Empty station**. Fill picks the best reserve crew for the
  card's check stat (partial fill when reserves are short); Empty returns the
  card's crew to reserve and leaves heroes in place. The menu uses the shared
  `Floating` portal (above the floating window) and only opens on cards the
  viewer may manage. Optional component cards with crew slots are eligible.
- All crew writes go through the `SHIP` command (undo/realtime), and handlers
  re-check the role server-client-side; the DB `execute_command` does not gate
  ship sub-steps.

**Auto-assign crew.** The roster has **Auto** and **Clear**.
- Auto arms on the first click: only eligible, not-yet-full Helm/Bridge/Rudder/
  Sail/Weapon cards show a top-right check (`-` = skipped; click toggles). Deck,
  Hull and Cargo are never eligible. A second click fills only
  the enabled cards with **reserve crew only**; crew already on cards are never
  moved (Clear first for a fresh start). All eligible cards default enabled.
- Priority: Helm (best Wis) -> Bridge (best Int until full) -> Rudder (Int) ->
  Sail (Con) -> weapons. Weapons get their **first slot** filled first, so each
  manned weapon can use its best-crew check; then remaining weapon slots. Left
  side first: if the target is off the port side and crew are short, manning the
  port battery lets those guns bear while the starboard battery stays uncrewed.
- Clear removes every generic crew member from every station on the ship and returns them to reserve (heroes stay). Cards no longer preview-assign roster crew from the top down; hollow slots mean empty until Auto assigns reserve crew. Both auto and clear
  are logged as `SHIP` changes, so undo/redo already reverses them.

**Cargo manifest.** A compact list under **Crew reserve** holds
`{ name, category, quantity }` lines. Quantities use the category unit:
**Food & water** = person-days, **Ship repair kit** = kits (0.1 ton each),
**Ammunition** / **General cargo** / **Mission cargo** = tons. Every line has its
own name and category, so multiple lines can share a category (e.g. **Ore** and
**Furniture** as two General cargo lines). Empty categories are absent; **+ Add
cargo** opens a category/name/quantity dialog. Goods have no owner/team, and the
list has no Auto/Clear/team controls. Capacity is
`computeCargoCapacity(build) = max(cargoArea, floor(remainingMass + cargoArea))`;
the manifest is the **real** cargo load and feeds performance mass/Accel/MC.
**Food & water** gives `Food & water: N days` at **200 person-days per ton**
(amber ≤7, red 0); there is no daily consumption tick — food/water is reduced when
a cargo hit destroys supplies (combat time). Hull repair requires and consumes
**1 Ship repair kit**. Over-capacity is a **soft** gate: the card turns yellow at
exactly full and red above it, with a large `total/capacity` fraction (e.g.
`5 / 2t`) and a warning-triangle badge; nothing is blocked. The manifest is frozen
into the placed ship's snapshot at placement; runtime edits use the same role gate
as crew management (DM/captain, or helmsman when no captain) and rewrite the
snapshot + `loadedCargo` + derived stats through a `SHIP` command. The Ship
Editor's cargo simulation slider is a preview-only what-if; the saved manifest is
what placed ships use.

**Deck sizing.** Default regions are Bow 3, Stern 3, Port/Starboard 4, Body 8.
A single explicit pixel card width (min 64px) is shared by every card; it is computed from the measured deck width, so zoom never reflows or stretches a column. Spacing is 4px between cards, between regions, and for vertical
region/card gaps; region `px-1` + outer `px-1` keep the 8px frame-to-region gap. Cards keep the Ship Editor grid: hidden cards/regions are invisible but their
slot space is still reserved, so remaining cards never stretch and never move
(for example, an empty Port column leaves a gap instead of widening Body or
shifting Starboard). Region boxes reshape visually but the underlying slots stay
put. All cards stay equal width.

**Per-card boxes & status.** `boxState` stores destroyed tons per **deck card
key**. Combat picks a hittable, non-zero card weighted by tons. Card tint:
red when all boxes are gone or the card cannot operate; yellow when crew is
below the requirement for the remaining capacity (rudder 1.5 t/unit + 1 crew per
2; sail 1 t/unit + 1 crew per 4); normal otherwise. Non-hittable/zero-mass cards
are hidden. Hero tokens use the scenario-map `drawToken` renderer (32×24), with
percentage positions in `stations[cardKey].heroPositions`; Shift/1 hides them.

**Weapon reload.** Each weapon card has **5 card steps per turn** (a turn is one
full alliance cycle; wildspace breaks it into 5 steps). Auto-load, manual load,
and fire all spend card steps. `ship_weapons.reload_steps`: `0` = always armed,
`4` = four load card functions to arm. Full crew = living NPC crew + living
heroes on the card.

- **No hero on the card:** the crew auto-load. Clocked on the **card leader's
  alliance turn** (NPC crew → `crewTeam`, which defaults to `blue`), not the
  helmsman's. In wildspace they add **1 load per ship step**; in atmosphere they
  add **up to the remaining card steps at the start of that turn**. An armed
  weapon stays armed. In atmosphere the weapon button also triggers the batch
  load when the card is unloaded.
- **Hero on the card:** auto-load is suppressed because **manual loading spends
  the hero's action**; the game never spends a player's resources for them. The
  weapon button becomes **Load** while unloaded and **Fire** when armed.
  Load/Fire spends 1 card step and **1 action from every hero on the card**;
  loading still needs the full crew. Firing only needs the armed weapon + a
  firing hero — a hero on the card, else the captain (helmsman when no captain
  exists; the DM can always order). Manual Load/Fire is only legal during the
  acting hero/captain's alliance turn (DM/free-play bypass).
- **Split control example:** a friendly hero holds the helm of a ship whose
  original enemy crew still mans a weapon card. The hull moves on the friendly
  turn (outer friendly glow); that weapon card auto-loads on the enemy turn
  (inner enemy glow). A second, friendly-occupied weapon card acts on the
  friendly turn and its auto-load is suppressed.
- Firing resets progress to 0 and spends 1 card step. A card that has spent all 5
  card steps can still be used with an approved negative hero action: the
  function happens, no card step is spent, and the negative action is logged as
  its own `OTHER_ACTION` command.
- Example (reload 1 ballista): step 1 crew auto-load; step 2 the hero arrives and
  fires; step 3 the hero leaves and the crew auto-load; step 4 the hero returns
  and fires; step 5 the hero stays and spends an action to load; next turn step 1
  the hero fires again.

**Damage.** The struck card is selected **before the attack roll** (tonnage
weighted; weapons are always hittable; armour is safe), because the card’s
catalog AC and DT apply: roll to hit vs `max(ship AC, card AC)` and penetrate
when damage ≥ `max(ship DT, card DT)`. This matters when a component is tougher
than the rest of the ship — for example a **wooden ship with a metal-cased helm**;
the helm can raise both the AC to beat and the DT to penetrate even though the
hull is soft.

On penetration: destroy one box (or strip reinforcement) + subtract the damage
from ship HP + deal the full damage to every occupant. A hit **below the effective
DT is deflected** and changes nothing (no HP, no box). The hit message names the
struck card, e.g. `Shrike hit Turtle with Ballista light for 23 (Hull)`; a
deflected hit reads `… for 5 (Hull) deflected, no damage`. Each card draws one
box per ton; destroyed boxes render as **hollow red** boxes and the card shows a
`remaining/total` counter, so a penetrating hit is visible on the struck card
even when the component still has boxes left. Every runtime deck card **with a
card function** also shows a bottom-center badge with its **remaining card steps
this turn** (0-5; red at 0), straddling the bottom border. Cards with no action
(e.g. Deck/Cargo) omit the badge, as do the Helm card (Dodge placeholder spends
no steps), the Ship Editor, and the dry dock (no turn ledger). Destroying every
hull
box **sinks the ship**: HP becomes 0 and it falls apart (see the hull rule above).
0 HP = derelict: components stop, weapons fire at disadvantage, the ship drifts.

**Ram / collision.**

- Collision (no ram): `floor(50%)` of `min(floor(ton/10), 16)d(speed)` to both.
- Ram: full `min(floor(ton/10), 16)d(speed)` to the target; attacker takes
  `floor(50%)`.
- Piercing: both lose remaining speed + both shift one hex.
- Bludgeoning: attacker loses speed; target shifts and keeps movement.
- Ram is a charge-like explicit action (≥ 2 hexes, no facing change); a miss
  passes through; one ram per turn.

**Stations / crew.** Card crew capacity = catalog `crew`; the PC counts as crew
and bumps the last crew to reserve. Leader = PC else highest level. Captain
bonus = `max(0, intMod − 3)` for one check. Sail ±1 speed (DC `current speed +
10`, Con) and rudder −1 MC (DC `26 − currentMC`, Int) each cost 1 action from
every hero on the card (captain/helmsman when no hero), one success per turn,
failed checks still spend the action; hull repair (`4d8 + best Str`,
cap 80% max HP, 3 heroes/crew on the Hull card, consumes 1 Ship repair kit and
also restores one damaged ton; each hull hero spends 1 action, or the captain /
helmsman when no hero is on the card). Weapons use Dex, helm Wis. Weapon
load/fire orders spend one of the card's 5 card steps per turn; load spends 1 action
from every hero on the card, and fire spends 1 from each of those heroes (or the
captain/helmsman when no hero is on the card).

**Boarding.** Ships are structure-like: they have no intrinsic alliance, and any
hero (any alliance) may board any ship if the ship hex is in its normal reachable
set (same terrain/threat/occupancy pipeline), at the same elevation and within
`hero_attach_max_size`. Boarding spends the normal move cost (ship hex = 1 MP).
A boarded hero leaves the map (`units.attached_to_ship_id` + `ship_station_key`),
shares card damage, and sleeps in Deck/Cargo. The ship window lists boarded
heroes; assign 1 hero per normal card (Deck and Cargo allow multiple) or
disembark to an adjacent free hex manually.

The **helm occupant defines the ship’s owner/alliance**: helm hero → helm crew
team → none. The ship image rotates with `facing` (0 = nose north; +1 = 60°
clockwise) and carries the two-tone glow described in §7: outer = helmsman
alliance, inner = crew alliance. `imageOffsetY` is a local bow/stern offset and
rotates with the image; the click/drag hit box uses the same local rotation.
Crew share one team colour (picker in the roster; defaults to `blue`); the bridge
hero (or DM) can **Fill Helm**. Speed declaration routes Helm hero → same-alliance
Bridge hero → DM.

---

## 8. Remaining work

Shipped since the foundation: scenario-map ship drag + movement overlay, the
non-modal compact `ShipWindow`, step-1 speed declaration panel, hero
boarding/station assignment (+ disembark), `End Step` per-step `speedSpent`
reset, and the `shipCombat.ts` pure core (range bands, arcs, ram/collision,
weighted component pick, reload, AoE descriptor) with tests.

Shipped: per-alliance-step reload at full crew, the ship window weapon list with
Fire, fire targeting (arcs/range, best Deck(Dex)+prof attacker, ship HP +
tonnage-weighted box groups, unit DAMAGE, firing empties the weapon), and
structure-like boarding + helm-derived owner/crew team/glow.

**Snapshot/realtime:** `ship_spelljammer.snapshot` is a large TOASTed jsonb.
Realtime UPDATE payloads can omit it, so `useShips` merges realtime rows with the
cached instance and `useGameEngine` re-reads ships over REST after every `SHIP`
command. Migration 162 sets `REPLICA IDENTITY FULL` defensively.

Still to build:

- Combat detail: occupant/crew damage, derelict state, ram/collision actions,
  AoE vs units via spell shape, reinforcement stripping, per-card hit selection
  (currently box groups).
- Station action menus (captain bonus, repair, sail/rudder, cargo) and the
  helm/weapon defaults; Fill-all and full-card colour/leader marking.
- Atmosphere ground-MP pool once ship land speed is authored (currently uses
  atmospheric FP for both).
- Persistent player-ship table (future).
