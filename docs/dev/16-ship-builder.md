# 16 — Archfar's Shipyard (ship builder)

> **Status: builder module only.** The ship *stats engine*, the editor
> (`/ship-editor`), and the shared renderer exist and are tested. **No ship
> entities, ship movement/combat, or sub-turn engine is implemented yet.**
> The old v8.1 design files were deleted; the mass-first model below is canonical.

## Data model & migrations

`src/types/ship.ts` defines armors/components/weapons and the `ShipTemplate`
rows. Migration 066 (schema) creates the `ship_*` template tables; 068 (RLS:
read `view_ship_editor`, write `ship_editor`), 069 (`ship_crews` roster), 070
(`extra_crew` → `crew_count`), **134 (mass-first overhaul)**, **135 (authored
crew quarters)**, **136 (Ship Editor v2 fields + `ship_images`)**,
**137 (catalog UUID + name)**, **138 (Ship Component Workshop fields + access)**,
**139 (merge accessories into components)**, **140 (cascade deletes + usage
lookups)**, **141 (catalog name titles)**, **142 (card DT, placements,
reinforcements)**, **143 (region-container deck layout + stable weapon rows)**,
and **144 (24-ship master template set + derived crew cleanup)**, and **145
(crew HP + authored weekly cost)** reshape the model.

- 134 drops `ship_frames`, reshapes `ship_armors`, reseeds `ship_components`,
  and adds `total_mass`/`helm`/`command_bridge`/`reinforcement`.
- 135 adds `crew_quarters` (tons).
- 136 adds `image_url`, `weapon_capacity`, `atmospheric_speed`, and
  `damage_threshold` to `ship_templates`; `image_url`/`ac` to the catalog
  tables; a `hull` component row; and the public `ship_images` bucket.
- 137 aligns the ship catalogs with `unit_*`: `ship_components`,
  `ship_weapons`, `ship_accessories`, and `ship_armors` get UUID `id` primary
  keys and unique `name` columns; template/join FKs migrate to the UUIDs.
  `ship_templates` keeps its text id until the engine pass.
- 139 merges accessories into components: adds `ship_components.built_in`,
  copies every `ship_accessories` row with its UUID, renames the join table to
  `ship_template_components` + `component_id`, and drops `ship_accessories`.
  Optional components are just `ship_components` rows with `built_in = false`.
- 138 adds `ship_components.effect`, removes `weapon_large`, renames
  `weapon_small` → `weapon_capacity`, and changes `ship_weapons`:
  `mass` + `min_range` add; `range_std` → `range`; `range_dis` → `max_range`;
  `fire_cycle_rd` → `fire_cycle_step`; `mount` drops. It also adds the
  component-editor access caps and catalog RLS.
- 140 makes catalog deletes cascade to template selections and adds the
  `ship_component_usage` / `ship_weapon_usage` RPCs.
- 141 normalizes `ship_components.name` and `ship_weapons.name`: underscores
  become spaces, words are lower-case, and only the first letter is capitalized
  (`command_bridge` → `Command bridge`). Unique names stay enforced.
- 142 adds per-component/weapon `dt` (default 15) and stores
  `ship_templates.reinforcements` (card keys carrying a reinforcement).
- 143 replaces fixed deck cells with `ship_templates.deck_layout` (region
  containers: Bow/Port/Body/Starboard/Stern), drops `card_placements`, gives
  every `ship_template_weapons` row a stable UUID, and drops `mount_slot`.
- 144 removes the old template data, drops the derived `crew_count` and
  `passengers` columns, sets Sail crew to 0, and seeds the 24-ship master list.
- 145 adds authored `ship_crews.hp`, makes weekly `cost` required, and updates
  the crew stat defaults to `12-14-14-10-14-10`.
  **143 is applied; apply 144 + 145 in Supabase.**

Editor layout is 3 panels: template picker (left), summary + composition table
(middle), and ship image + card layout + roster (right). The sticky footer is
Create/Save, Clone, Delete. The composition table columns are
**Component / Input / Mass (ton) / Crew req. / Notes / Cost**; every row shows
its cost and the Total row sums them. All user-facing “tonnage” wording is
**mass**; the unit remains **ton**.

The summary frame is arranged in three rows: Ship Mass / Armor / HP / Damage
threshold; Cargo / Crew (min/full) / Ship cost / Weekly operation; Atmospheric
speed / Space Acceleration / Maneuver class. A cargo simulation slider runs from
0 to max cargo and only changes the cargo load used for acceleration/MC; it never
changes cargo allocation, cost, or the saved cargo value. **Weekly operation
cost = round(0.4% × ship cost + roster weekly cost)**. The existing MC-by-speed
row and formula button stay at the bottom.

Weapons are edited in a child list under the **Weapon capacity** row. Each row
is one line: weapon select, amount, derived direction, weapon cost, remove. The
list spans the composition panel at full width and reflows with the browser.
Weapon mass is blocked from exceeding capacity, and capacity cannot be lowered
below the placed weapon mass. Every purchased component/weapon automatically becomes
a layout card; optional components are not allocated separately. The right panel
keeps the image, card layout, and crew roster (no second weapon list).

The deck uses five **region containers**: Bow, Port, Body, Starboard, and Stern.
The initial deck is 3×9: Bow 6 (top 2 rows), Port/Body/Starboard 5 each (middle 5
rows), Stern 6 (bottom 2 rows). Slots are generic; drag a card onto an empty slot
to move it, or onto an occupied slot to swap. Right-click a slot (or its card) to
move the whole slot to another region. When every slot is full, a new middle row
is added above Stern (Port/Body/Starboard each gain one slot), so the ship grows
longer. The **Ram slot** is fixed at Bow row 1, middle column: it only accepts
weapons with `max_range = 1`, those weapons can only go there, its arc is Bow, and
it cannot be moved to another region. Default placement puts weapons in
Bow/Stern and other components in Body/Port/Starboard; the Ram slot is reserved
for a melee-range weapon.

Cards show name, mass boxes, `AC / DT`, and a crew list. The displayed DT is
`max(ship template DT, component/weapon DT)`; the template DT is the ship's
minimum. Armor and reinforcement do not get cards. Cards grow to the tallest
card in the same row. Right-click a component/weapon card to assign/remove a
reinforcement (thick silvery border); the first hit destroys the reinforcement,
the next damages the component. The editor card crew list is a non-functional
preview using roster crew in layout order.

`ship_crews`: named/unnamed crew with level, authored HP, 6 stats, and required
weekly cost. New crew defaults are **HP = 10 + 7 × (level − 1)**, **weekly cost =
level² × 2 + 2**, and **Str-Dex-Con-Int-Wis-Cha = 12-14-14-10-14-10**. HP and cost
auto-follow their level defaults until the user edits them, then the authored
values are kept. Roster rows display
`Name — Level N, HP N, S-D-C-I-W-C, N Gp`. The roster is the actual crew count;
it has no hard cap, but saving is blocked while it exceeds
`crew_quarters × 5` capacity (red error). There is no `crew_count` or
`passengers` column: min/full crew are derived. Access caps (059):
`can_view_ship_editor` / `can_use_ship_editor` — both admin-only; Lobby's
Archfar's Shipyard button routes to `/ship-editor`.

## The stats engine (`src/packages/ships/lib/shipStats.ts`)

Ships are **hero-like**: no retaliation/morale/rout, no ground 5-attack cap
(rate of fire = weapons × Fire Cycle × crew). Builder readouts come from pure
functions; `ships/shipStats.test.ts` pins the formulas and the five reference
templates (Racer, Shuttle, Wasp, Damselfly, Star Moth).

### Mass-first build

The player designates a **total ship mass**. Hull and armor are paid out of it:

- `hullMass = totalMass × (10% + totalMass / 500)`
- `armorMass = totalMass × armor.massPct`
- the rest is furnished with components, weapons, cargo and crew quarters.

**Tonnage is allocated in whole tons.** Every group rounds to the nearest ton
(`hull 2.8→3`, `rudder 4.5→5`, `hull 13.2→13`), which is what makes the
reference rows sum exactly to their total mass. The exact hull/armor formula
values are still shown in the editor's formula panel.

### Armor

| Armor | MassFactor (percent of ship total mass) | AC | HP |
|---|---|---|---|
| Wood | 0% | 15 | |
| Ceramic | 5% | 13 | ×2 HP |
| Plate | 10% | 17 | |
| Metal | 20% | 19 | |
| Stone | 30% | 17 | ×2 HP |

### Components (mass · crew)

| Component | Mass | Crew | Notes |
|---|---|---|---|
| Helm | 1t | 1 | each helm needs its own crew; first helm is included in hull price, extra helms use catalog cost |
| Command Bridge | 3t | 5 | +5 command per bridge |
| Sail | 1t | 0 | spelljamming sails need no handling crew |
| Rudder vane | 1.5t | 0.5 | determines MC; crew counts round up per group |
| Weapon | authored | per weapon | each weapon uses its catalog mass; handling crew is **not** min crew |
| Reinforcement | 1t | 0 | protects one card; first hit destroys the reinforcement, next hit damages the component |
| Cargo | 1t | 0 | carries 1t cargo |
| Crew quarters | 1t | 5 | **authored** tons; capacity = `tons × 5` |

**Weapon capacity** is a separate authored mass budget on the template. It
counts toward ship mass even when fewer weapons are placed. Crafted weapon
`mass` controls placement (there is no small/large mount rule); the right-panel
layout can place weapons until the placed total reaches the capacity. The
composition row shows `placed / capacity`; crew stays blank there because it
comes from the chosen weapons. The built-in `weapon_capacity` component row
supplies the per-ton metadata (effect, cost, AC, image); its mass is 1 ton per
capacity ton, and the capacity value itself remains the mass budget.

**Ram slot:** the fixed Bow row 1 middle slot filters to weapons with
`max_range = 1` (rams, grappling claws, etc.). Those weapons only fit the Ram
slot and cannot be moved out of it; every other slot is generic and accepts any
weapon. The weapon child list derives its direction from the slot region
(Bow→Fore, Stern→Rear, Port→Left, Starboard→Right, Body→360, Ram→Ram/Bow); there
is no `mount_slot` column. Only one Ram weapon row is allowed.

**Minimum crew ceils each component group separately, then sums.** Sails require
0 crew; weapon handling crew is excluded (it is not needed for spelljamming).
Full crew is `max(minCrew × 2, minCrew + weaponCrew)` to cover two shifts and
weapon handlers. Examples: Shuttle min `1 + ceil(0.5) = 2` (full 4); Wasp min
`1 + ceil(3) = 4` (full 8); Damselfly min 3 with weapon crew 6 → full 9; Star
Moth min `1 + 5 + ceil(9) = 15` (full 30).

### Performance

- `HP = (totalMass × 3 + 40) × armor.hpMult` — Ceramic/Stone ×2 on top. Star
  Moth is 220 base → **440**.
- `performanceMass = totalMass − maxCargo + simulatedCargo`; the cargo slider
  defaults to the allocated cargo and never changes cargo allocation.
- `Acceleration = (sails + rudders) / performanceMass × 15` (counts, not masses).
- `MC`: `x = rudders × 10 / performanceMass`; `x < 1 → 1/x + 2`, else `4 - x`.
  Raw MC is clamped at 0 (the Racer has MC 0).
- **effectiveMC** adds a speed band (speed 0–12), also clamped at 0:
  - speed 0–2: `MC − 1`
  - speed 3–7: `MC`
  - speed 8–12: `MC + 1`
- No rudder → cannot turn (`∞`, shown as `—`).
- Command bonus = `command_bridge × 5`.
- **Atmospheric speed** (0–12) is an authored field for future Quiver use; it
  does not feed the formulas yet.
- **Damage Threshold** is the ship minimum (default 15). A card displays
  `max(ship DT, component/weapon DT)`.

### Build cost

- **Hull:** `totalMass × 1000gp`; the first helm is included in this price.
- Every composition row shows its own cost; the Total row sums them.
- Components use their catalog cost × count; cargo/quarters use cost × tons;
  optional components use cost × count; armor has no cost field.
- Helm cost is `max(0, helm − 1) × helm component cost` (extra/backup helms only).
- **Weapon capacity row:** capacity × the weapon-capacity component cost.
  Each weapon child row adds its own `weapon.cost × count`. The total includes
  both, without double-counting.
- **Weekly operation cost:** `round(0.4% × ship cost + Σ crew weekly cost)`.

### Reference templates (regression oracle)

| Ship | Mass | Accel | MC | HP | AC | Min crew | Full crew | Quarters | Capacity |
|---|---|---|---|---|---|---|---|---|---|
| Racer | 10 | 9 | 0 | 70 | 15 | 3 | 6 | 0t | 0 |
| Shuttle | 10 | 3 | 3 | 70 | 15 | 2 | 4 | 4t | 20 |
| Wasp | 20 | 5.3 | 1 | 100 | 15 | 4 | 8 | 2t | 10 |
| Damselfly | 30 | 5 | 3 | 130 | 19 | 3 | 9 | 2t | 10 |
| Star Moth | 60 | 5 | 1 | 440 | 13 | 15 | 30 | 5t | 25 |

The template tonnage rows are asserted in `shipStats.test.ts`; they are the
quickest way to catch rounding regressions.

### Master template list (migration 144)

The 24 templates replace the old rows. They store structural values only; no
component/weapon rows are seeded. Weapon tonnage is the authored capacity. Any
mass not allocated by the listed counts remains **Reserve** for later weapons or
optional components.

| Ship | Mass | Helm | Bridge | Sail | Rudder | Weapon cap | Armor | Reinf. | Cargo | Quarters |
|---|---:|---:|---:|---:|---:|---:|---|---:|---:|---:|
| Racer (Humming bird) | 10 | 1 | 0 | 2 | 4 | 0 | Wood | 0 | 0 | 0 |
| Shuttle liner (Bee) | 10 | 1 | 0 | 1 | 1 | 0 | Wood | 0 | 1 | 4 |
| Scout (Wasp) | 20 | 1 | 0 | 1 | 6 | 1 | Wood | 0 | 3 | 2 |
| Scout (Damselfly A) | 30 | 1 | 0 | 7 | 3 | 3 | Metal | 0 | 1 | 2 |
| Star Moth | 60 | 1 | 1 | 2 | 18 | 4 | Ceramic | 0 | 2 | 5 |
| Scout (Damselfly B) | 70 | 1 | 0 | 21 | 7 | 3 | Plate | 0 | 5 | 3 |
| Flying fish | 70 | 1 | 0 | 0 | 14 | 3 | Wood | 0 | 25 | 3 |
| Living ship | 70 | 1 | 1 | 12 | 7 | 1 | Wood | 0 | 13 | 2 |
| Lamprey | 70 | 2 | 1 | 3 | 14 | 4 | Wood | 0 | 12 | 6 |
| Scorpion ship | 70 | 1 | 0 | 7 | 7 | 3 | Metal | 0 | 10 | 3 |
| Shrike ship | 80 | 2 | 1 | 3 | 24 | 3 | Wood | 0 | 5 | 6 |
| Nightspider | 90 | 1 | 1 | 15 | 9 | 6 | Metal | 0 | 2 | 6 |
| Squid Ship | 90 | 1 | 1 | 9 | 9 | 4 | Wood | 0 | 27 | 5 |
| Space Galleon | 120 | 1 | 1 | 2 | 6 | 4 | Wood | 0 | 56 | 4 |
| Nautiloid | 120 | 2 | 1 | 20 | 12 | 6 | Wood | 0 | 21 | 7 |
| Hammerhead | 120 | 1 | 1 | 16 | 12 | 5 | Wood | 0 | 29 | 6 |
| Bombard | 120 | 2 | 1 | 12 | 12 | 10 | Wood | 1 | 20 | 5 |
| Turtle ship | 80 | 1 | 1 | 8 | 4 | 5 | Metal | 0 | 12 | 3 |
| Tyrant Ship | 90 | 3 | 0 | 0 | 0 | 3 | Stone | 0 | 20 | 2 |
| Warship - small | 60 | 2 | 1 | 0 | 12 | 8 | Plate | 0 | 3 | 6 |
| Warship - medium | 100 | 2 | 1 | 0 | 20 | 12 | Plate | 0 | 4 | 8 |
| Warship - large | 140 | 2 | 1 | 0 | 42 | 6 | Wood | 0 | 3 | 9 |
| Super cargo ship | 200 | 1 | 0 | 8 | 5 | 0 | Wood | 0 | 80 | 2 |
| Gun Boat | 100 | 2 | 1 | 10 | 10 | 18 | Plate | 0 | 2 | 10 |

## Hit boxes & durability (builder readouts)

- **1 ton = 1 box**, so the box count follows the rounded tonnage allocation.
- **Boxes carry no HP** — each hit destroys exactly one box.
- **Hull + armor are safe** (never hit); every other group is hittable.
- Groups: Hull, Armor, Helm, Command bridge, Sails, Rudders, Weapons,
  Reinforcement, Specials, Cargo, Crew quarters, plus **Reserve** for
  unfurnished mass.
- **Reinforcement** protects one card. First hit destroys the reinforcement,
  then the next hit damages the protected component. Assign/remove it by
  right-clicking a component/weapon card; reinforced cards get a thick silvery
  border. The middle Reinforcement count is the number of available modules.
- The right-panel **card layout** (`ShipRenderer/ShipLayout.tsx` +
  `ShipComponentCard.tsx`) renders one growing card per component/weapon in
  region containers: name, one box per ton, `AC / DT`, and a crew list (assigned
  name / `Lv N crew`, or a hollow required circle). Armor and reinforcement are
  not cards. Cards in the same row stretch to the tallest. Empty slots are
  labelled; the Bow middle slot is labelled Ram.
- Slots are draggable (drop or swap) and right-clicking one offers a region move.
  The Ram slot is fixed; cards in it are not draggable. A full deck grows a new
  middle row above Stern.
- Per-component AC/DT are catalog-driven; hull/helm/etc. use the catalog rows.
  Catalog `image_url` is retained but cards do not render images.
- The editor crew list is a non-functional preview: roster crew are distributed
  across cards in layout order, and remaining circles stay hollow.
- The ship preview image is uploaded to the public `ship_images` bucket and
  stored on `ship_templates.image_url`. The shared `ImagePickerModal` handles
  upload/list/delete; the editor has no per-component image upload yet.

## Ship Component Workshop (`/component-editor`)

One editor over the two ship catalogs, with two filter tabs at the top of the
left panel:

- **Components** → `ship_components`: built-in rows (`built_in = true`) are
  edit-only; optional components (`built_in = false`) support New/Clone/Delete.
- **Weapons** → `ship_weapons` (New/Clone/Delete).

Fields:
- Components: Name (read-only for built-ins), Mass, Crew, Hittable, Cost,
  Effect, AC, DT, Image URL.
- Weapons: Name, Mass, Crew, Cost, Damage **and Fire Cycle on the same row**,
  Min Range / Range / Max Range, Note, AC, DT, Image URL. Weapons are always
  hittable.

Crew requirements may be fractional (Rudder 0.5); every actual crew count is
rounded up per component group. Sail crew is 0.

Catalog names are stored as display names (`Command bridge`, `Ballista light`),
not slugified identifiers; the workshop preserves spaces/capitalization on save.

Fire cycle is in steps: **1 = every step (1/5 round)**, **2 = every other step**.
The Ship Editor’s Weapon capacity child list shows the fire-cycle step and the
direction derived from the weapon's deck region.

Access: `component_editor` / `view_component_editor` (admin/dm edit, everyone
view). The catalog RLS helpers allow either the Ship Component Workshop or the
Shipyard capability, so the Ship Editor keeps reading the same catalogs.

**Delete:** the workshop checks usage first (`ship_component_usage` /
`ship_weapon_usage`), lists the affected template names, and confirms. Catalog
deletes cascade to `ship_template_components` / `ship_template_weapons`, so a
deleted component/weapon is removed from those ships rather than blocked by an
FK error.

## Engine hand-off (pending work)

`src/packages/ships/lib/shipMoveCost.ts`, `shipCombat.ts`, `useShipEngine.ts`,
`ScenarioMap/ShipPanel.tsx`, `ship_spelljammer` instances, sub-turn toggle,
firing arcs, boarding rules. The engine spec will be written when that work
starts; the mass-first stats module and editor are ready to consume.
