# 14 — Editors & Data Mappers

## The shared mapper

`src/lib/templateMappers.ts` — `mapTemplate(row): UnitTemplate` and
`mapTemplateToRow(template)` convert between `unit_templates` rows
(snake_case) and the camelCase `UnitTemplate`. The same mapping is shared by
the Unit Editor, the Unit Selector, and template→unit spawns
(`useSupabaseSync.addUnitFromTemplate`). Keep these two functions in lockstep;
a third parallel map lives in `useSupabaseSync` for live `units` rows.

## Weapon string format (canonical, on units AND templates)

Weapons are **not** stored as JSON — they are a CSV string; weapons separated
by `;`, fields by `,` (`src/lib/weaponParser.ts`):

```
Name,AttackBonus,DamageDice,IsHealing,Range,MaxRange,MagicDimension,Reach,NoRetaliation,FreeAction,IsTwoHanded,NumberOfAttacks,OnSaveHalfOrNeg,SavingThrow,Shape
Longsword,5,1d8,false,1,1,0,false,false,false,false,1,true,Dex,circle
Greatsword,5,2d6,false,1,1,0,false,false,false,true,1,true,Dex,circle
Fireball,7,8d6,false,4,6,20,false,false,false,false,1,true,Dex,circle
```

Parsing tolerates older strings (missing trailing fields default:
`isHealing false`, `maxRange = range`, `shape circle`, `halfOnSave true`,
`save Dex`). Field order matters — never insert mid-string without bumping all
rows (history: 11 → 13 → 14 → 15 fields with migrations 043/044/045/048).

`Weapon` (parser) vs `Weapon` (legacy gameProtocol) vs `WeaponLookup`
(unit_weapons library table) are three different shapes — mind which one a function
takes.

## Unit Editor (`/unit-editor`, read-only mode for players)

3-panel: left = template list (New/Clone/search); center = form; right =
Token Preview + test sliders (casualty %, morale modifier, formation incl.
Routed, charge) + team colors + Change Image.

Notable data rules the editor encodes:
- **Hero toggle** forces troop count 1, Fearless on, no formation economy in
  play; **Gargantuan** forces hero, troops 1, formations disabled.
- **Size category** snaps to 75/100/200/300/400; troop count is capped by
  `unit_size_categories.max_troops` / `max_troops_mounted`; derived `maxUnitHp =
  troopHp × troops` (recomputed live).
- **Darkvision** authored per template (copied to spawned units for fog).
- **Two-handed** weapons: a shielded unit with a 2H active drops the shield
  (−2 AC); Shield Wall blocked while wielding one.
- Formation availability chips (always Scattered/Routed; org +1/step rule is
  *play*, not authoring).
- Weapon rows come from the reusable **WeaponEditorModal** (library search
  prefills flags) and ImagePickerModal (race icons + `unit_images` uploads).
- Dirty tracking + Unsaved-Changes guard (Save/Don't Save/Cancel + beforeunload).
- Sticky Save bar (Save / Save As / Delete), hidden when `readOnly`.
- `/unit-editor` gate: view needs `can_view_unit_editor`, edit needs
  `can_use_unit_editor` (players browse the library read-only — RLS also
  blocks their writes server-side).

## The on-map DM stat editor

Double-clicking a unit opens `UnitEditorModal` (compact): identity/team/image,
HP row with live derived `{Max HP}/{Troops}`, effective AC, MP left/Max,
actions, morale (full-effective), formation + mount + can-charge, saves,
rank/token, weapons via the shared modal. Every edit is an **EDIT_UNIT**
command through the log (undoable) and broadcasts a **red** message to the
room. `updateUnit` maps every editable field to its snake_case column
(history: several fields silently never persisted because a mapping was
missing — Max MP was the canonical bug).

## Size/visual constants

- `unit_size_categories`: 75 Small · 100 Medium · 200 Large · 300 Huge · 400
  Gargantuan, with `row_capacity`, `max_troops`, `max_troops_mounted`.
- Row-capacity base is ALSO a setting band (`row_capacity_by_size`,
  migration 042) as the code fallback; `unitStats.getRowCapacityBase` is the
  single source, `getRowCapacity` prefers the table row.

## Ship / map editors

See `16-ship-builder.md` and `13-map-entities-terrain.md`. Both follow the
same 3-panel + read-only + RLS pattern.

## Structure Editor (`/structure-editor`, read-only for non-authors)

Authors reusable **map structure templates** (walls, spikes, gates, towers) in
the `map_structure_templates` table (migration **093**; caps
`can_view_structure_editor` / `can_use_structure_editor`). Laid out like the
Effect Editor: left = template list (search, New, Clone), middle = the form,
right = a `StructurePreview`.

- **Anchor** `edge` or `hex`. Edge structures carry two directional faces —
  **Inside (A)** / **Outside (B)** — each with block / move cost / melee AC /
  ranged AC; a `battlement` flag draws crenellations on the outside face.
- Hex structures carry an extra entry MP cost and an optional **Door HP**
  (`NULL` = no door; the door shares the template DT and resolves door-first,
  then the structure HP).
- **Durability** `maxHp` (default 30) / `dt` (default 15).
- **Modifiers** reuse the effect modifier row (`EffectModifierFields`), so a
  tower can carry `advantage` + `grant_disadvantage` auras, entry damage, or the
  reusable **`enter_org_max`** gate (only formations at or below an org level may
  enter the hex/edge).

See `18-map-structures.md` for the model and what is still pending (placement,
movement/combat consumption, wall unification).
