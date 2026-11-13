# 21 — Spelljammer runtime

The **builder** (Ship Editor, Component Workshop, deck layout) is documented in
`16-ship-builder.md`. This chapter covers the **scenario runtime**: how a placed
ship is stored, moves, declares speed, and how the command log carries its state.

> Status: schema, instance storage, placement, turn/step engine, and the pure
> movement/declaration math are implemented. The ship window, station actions,
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
| Weapons | `reload jsonb`, `weapon_state jsonb` |
| Sync | `is_deleted`, `command_seq` |

The **snapshot** is why a later Ship Editor edit never changes a placed ship. A
future persistent "player ship" table can reference `ship_templates` and own the
long-lived record; `ship_spelljammer` stays the per-scenario battle instance.

Migration 156 enables RLS: scenario participants may read; only the scenario GM
may write directly. Runtime writes go through `execute_command`, which is
`SECURITY DEFINER` and bypasses RLS.

Legacy `scenarios.map_data.ships` is gone. Placement writes a `SHIP` command.

---

## 2. Scenario mode

`scenarios.ship_mode` (DM-only, migration 152):

- **`wildspace`**: speed declaration, 5 steps per round, no elevation.
- **`atmosphere`**: atmospheric speed is a flying-point pool; normal turn order;
  elevation uses the flying-unit rules (climb and dive both cost 10 ft/hex).

`scenarios.ship_firing_arcs` (default on) toggles per-weapon arcs; off = every
weapon except the ram fires 360°.

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
- **FP** — atmosphere airborne; `atmosphericSpeed` (up to, like unit MP).
- **Speed** — wildspace; the declared speed split over the five steps.

### Speed declaration

Once per alliance round (step 1):

```
declared = previousSpeed ± freeAccel ± spellHexes
```

- `freeAccel` is capped by the **derived** acceleration
  `((sails + rudders) / mass) × 15` from `shipStats.ts`.
- `spellHexes` is signed; cost = `|hexes| × max(1, round(mass/10))` spell slots.
- Speed is an integer in `0..12`; round 1 starts from `previousSpeed = 5`.
- Every ship declares every round; `0` is valid.
- The step-1 popup goes to the **Helm hero owner → Bridge hero owner → DM**.
  `declared_round` prevents repeat popups; an undeclared ship keeps `lastSpeed`
  and facing and is checked again next round.

### Step budget

Cumulative rounding (`splitSpeedAcrossSteps`):

```
step_i = round(total × i / 5) − round(total × (i−1) / 5)
8  -> [2,1,2,1,2]
11 -> [2,2,3,2,2]
```

### Turning

- A facing change costs **1 pool point**.
- It is legal only after the ship has travelled `ceil(effectiveMC)` hexes since
  the previous facing change; the counter resets on a turn.
- MC 0 turns freely (still 1 pool point per turn).
- `effectiveMC` comes from the speed band (`mcBands` in `ShipDerivedStats`).
- Movement is forward into the front two arcs (formed-unit style).

`computeShipReachable(start, pool, turnDistance, opts)` returns reachable hexes
with cost, path, final facing, and an `endable` flag. Occupied hexes can be
passed through but not ended on; structures/obstacles can block entry.

Leftover pool at the end of a step is forfeited; a declared final hex that is
occupied makes the ship stop one hex short.

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
| Migrations | `151` (stats/saves), `152` (mode/step), `153` (reload + AoE), `154` (ram/hull crew), `155` (instance columns), `156` (RLS), `157` (`SHIP` log), `158` (place insert fix), `159` (realtime/default/declared round), `160` (boarding fields), `161` (crew team), `162` (replica identity), `163` (Deck + hull split) |

---

## 7. Rules locked for the remaining slices

**Helm ownership.** Ownership/control scans functional helm cards in deck order:
first functional helm with a hero, else first functional helm with crew team. A
destroyed first helm hands control to the next functional helm. The ship image
uses a two-pass alliance-colour silhouette glow.

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
the hull: `deck = max(1, round(hull × 0.2))`, `hull = allocated − deck`; at 0 hull
the Hull card is omitted. Deck is movable in the Ship Editor but non-removable.
Hero capacity per card equals its crew requirement; Deck and Crew Quarters are
unlimited. Boarded heroes default to the Deck. If the Deck is destroyed, heroes
move to Crew Quarters (and vice versa) while the other card survives. Sail crew
= `max(1, floor(sails/4))`, rudder crew = `max(1, ceil(rudders/2))`.

**Deck sizing.** Default regions are Bow 3, Stern 3, Port/Starboard 4, Body 8.
A single `--card-w` (CSS container query, min 64px) is shared by every card. Spacing is 4px between cards, between regions, and for vertical
region/card gaps; region `px-1` + outer `px-1` keep the 8px frame-to-region gap. Runtime middle rows use 4/3/2 columns depending on which regions
have cards; empty regions reserve no space. Bow/Stern frames shrink to their
card count (editor uses slot count). All cards stay equal width.

**Per-card boxes & status.** `boxState` stores destroyed tons per **deck card
key**. Combat picks a hittable, non-zero card weighted by tons. Card tint:
red when all boxes are gone or the card cannot operate; yellow when crew is
below the requirement for the remaining capacity (rudder 1.5 t/unit + 1 crew per
2; sail 1 t/unit + 1 crew per 4); normal otherwise. Non-hittable/zero-mass cards
are hidden. Hero tokens use the scenario-map `drawToken` renderer (32×24), with
percentage positions in `stations[cardKey].heroPositions`; Shift/1 hides them.

**Weapon reload.** `ship_weapons.reload_steps`: `0` = fire every step, `4` =
load steps 1–4 and be armed at step 5. Loading progresses only at full crew
(crew + hero = card crew capacity). An armed weapon stays armed without crew;
a hero or crew must be present to fire.

**Damage.** Roll to hit vs `max(ship AC, card AC)`. If damage ≥
`max(ship DT, card DT)`, destroy one box (or strip reinforcement) + subtract the
damage from ship HP + deal the full damage to every occupant. Below DT = nothing.
Component selection is weighted by tons; weapons are always hittable; armour is
safe. 0 HP = derelict: components stop, weapons fire at disadvantage, the ship
drifts.

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
10`, Con), rudder −1 MC (DC `26 − currentMC`, Str), hull repair (`4d8 + Str`,
cap 80% max HP, 1 kit, 1 PC + 2 crew or 3 crew). Weapons use Dex, helm Wis.

**Boarding.** Ships are structure-like: they have no intrinsic alliance, and any
hero (any alliance) may board any ship if the ship hex is in its normal reachable
set (same terrain/threat/occupancy pipeline), at the same elevation and within
`hero_attach_max_size`. Boarding spends the normal move cost (ship hex = 1 MP).
A boarded hero leaves the map (`units.attached_to_ship_id` + `ship_station_key`),
shares card damage, and counts against quarters. The ship window lists boarded
heroes; assign 1 hero per card (Crew Quarters allows multiple) or disembark to an
adjacent free hex manually.

The **helm occupant defines the ship’s owner/alliance**: helm hero → helm crew
team → none. The ship image gets a coloured silhouette glow in that alliance
colour. Crew share one team colour (picker in the roster); the bridge hero (or
DM) can **Fill Helm**. Speed declaration routes Helm hero → Bridge hero only when
the helm is manned by the same alliance → DM.

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
