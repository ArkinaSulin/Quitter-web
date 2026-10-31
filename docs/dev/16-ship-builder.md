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
crew quarters + passengers)**, **136 (Ship Editor v2 fields + `ship_images`)**,
**137 (catalog UUID + name)**, **138 (Ship Component Workshop fields + access)**,
**139 (merge accessories into components)**, **140 (cascade deletes + usage
lookups)**, **141 (catalog name titles)**, and **142 (card DT, placements,
reinforcements)** reshape the model.

- 134 drops `ship_frames`, reshapes `ship_armors`, reseeds `ship_components`,
  and adds `total_mass`/`helm`/`command_bridge`/`reinforcement`.
- 135 adds `crew_quarters` (tons) and `passengers`.
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
  `ship_templates.card_placements` (card key → future 0–26 deck cell) plus
  `ship_templates.reinforcements` (card keys carrying a reinforcement).
  **134, 139, 140, and 141 are applied; apply 142 in Supabase.**

Editor layout is 3 panels: template picker (left), summary + composition table
(middle), and ship image + card layout + roster (right). The sticky footer is
Create/Save, Clone, Delete. The composition table columns are
**Component / Input / Mass (ton) / Crew req. / Notes / Cost**; the Cost column
is reserved for per-component costs (the Total row shows the aggregate build
cost). All user-facing “tonnage” wording is **mass**; the unit remains **ton**.

Weapons are edited in a child list under the **Weapon capacity** row. Weapon
mass is blocked from exceeding capacity, and capacity cannot be lowered below
the placed weapon mass. Every purchased component/weapon automatically becomes
a layout card; optional components are not allocated separately. The right panel
keeps the image, card layout, and crew roster (no second weapon list).

Cards show name, mass boxes, `AC / DT`, and a crew list. Armor and reinforcement
do not get cards. Cards grow to the tallest card in the same grid row. Right-click
a component/weapon card to assign/remove a reinforcement (thick silvery border);
the first hit destroys the reinforcement, the next damages the component. The
editor card crew list is a non-functional preview using roster crew in layout
order.

`ship_crews`: named/unnamed crew with level + 6 stats + optional nullable cost;
capped at `crew_count`. Access caps (059): `can_view_ship_editor` /
`can_use_ship_editor` — both admin-only; Lobby's Archfar's Shipyard button
routes to `/ship-editor`.

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

| Armor | Mass % of total | AC | HP |
|---|---|---|---|
| Wood | 0% | 15 | ×1 |
| Ceramic | 5% | 13 | ×2 |
| Plate | 10% | 17 | ×1 |
| Metal | 20% | 19 | ×1 |
| Stone | 30% | 17 | ×2 |

### Components (mass · crew)

| Component | Mass | Crew | Notes |
|---|---|---|---|
| Helm | 1t | 1 | military ships often carry a second |
| Command Bridge | 3t | 5 | +5 command per bridge |
| Sail | 1t | 0.5 | propulsion |
| Rudder vane | 1.5t | 0.5 | determines MC |
| Weapon | authored | per weapon | each weapon uses its catalog mass; crew comes from the chosen weapon |
| Reinforcement | 1t | 0 | protects one card; first hit destroys the reinforcement, next hit damages the component |
| Cargo | 1t | 0 | carries 1t cargo |
| Crew quarters | 1t | 5 | **authored** tons; capacity = `tons × 5` |
| Passengers | — | — | authored count, default 0, display-only for now |

**Weapon capacity** is a separate authored mass budget on the template. It
counts toward ship mass even when fewer weapons are placed. Crafted weapon
`mass` controls placement (there is no small/large mount rule); the right-panel
layout can place weapons until the placed total reaches the capacity. The
composition row shows `placed / capacity`; crew stays blank there because it
comes from the chosen weapons. The built-in `weapon_capacity` component row
supplies the per-ton metadata (effect, cost, AC, image); its mass is 1 ton per
capacity ton, and the capacity value itself remains the mass budget.

**Ram slot:** the Ram weapon slot filters to weapons with `max_range = 1`
(rams, grappling claws, etc.). Generic slots accept any weapon. No separate
“ram” flag or accessory exists; accessories are mounts only.

**Minimum crew ceils each component group separately, then sums.** That is why
the Shuttle is min 3 (`1 + ceil(0.5) + ceil(0.5)`) and the Damselfly is min 13
(`1 + ceil(3.5) + ceil(1.5) + 6`), not 12.

### Performance

- `HP = (totalMass × 3 + 40) × armor.hpMult` — Ceramic/Stone ×2 on top. Star
  Moth is 220 base → **440**.
- `Acceleration = (sails + rudders) / totalMass × 15` (counts, not masses).
- `MC`: `x = rudders × 10 / totalMass`; `x < 1 → 1/x + 2`, else `4 − x`.
  Raw MC is clamped at 0 (the Racer has MC 0).
- **effectiveMC** adds a speed band (speed 0–12), also clamped at 0:
  - speed 0–2: `MC − 1`
  - speed 3–7: `MC`
  - speed 8–12: `MC + 1`
- No rudder → cannot turn (`∞`, shown as `—`).
- Command bonus = `command_bridge × 5`.
- **Atmospheric speed** (0–12) and **Damage Threshold** are authored,
  display-only fields (DT default 15). They do not feed the formulas yet.

### Reference templates (regression oracle)

| Ship | Mass | Accel | MC | HP | AC | Min crew | Quarters | Capacity |
|---|---|---|---|---|---|---|---|---|
| Racer | 10 | 9 | 0 | 70 | 15 | 4 | 0t | 0 |
| Shuttle | 10 | 3 | 3 | 70 | 15 | 3 | 4t | 20 |
| Wasp | 20 | 5.3 | 1 | 100 | 15 | 7 | 2t | 10 |
| Damselfly | 30 | 5 | 3 | 130 | 19 | 13 | 2t | 10 |
| Star Moth | 60 | 5 | 1 | 440 | 13 | 24 | 5t | 25 |

The template tonnage rows are asserted in `shipStats.test.ts`; they are the
quickest way to catch rounding regressions.

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
  `ShipComponentCard.tsx`) renders one growing card per component/weapon: name,
  one box per ton, `AC / DT`, and a crew list (assigned name / `Lv N crew`, or a
  hollow required circle). Armor and reinforcement are not cards. Cards in the
  same grid row stretch to the tallest.
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

Catalog names are stored as display names (`Command bridge`, `Ballista light`),
not slugified identifiers; the workshop preserves spaces/capitalization on save.

Fire cycle is in steps: **1 = every step (1/5 round)**, **2 = every other step**.
The Ship Editor’s Weapon capacity child list shows the fire-cycle step and marks
a weapon invalid when a Ram slot holds a `max_range > 1` weapon.

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
