# 16 — Archfar's Shipyard (ship builder)

> **Status: builder module only.** The ship *stats engine*, the editor
> (`/ship-editor`), and the shared renderer exist and are tested. **No ship
> entities, ship movement/combat, or sub-turn engine is implemented yet** —
> Spelljammer engine work is pending (see `.scratch/spelljammer-mod/spec.md`).
> This chapter documents what exists so engine work can start cleanly.

## Data model & migrations

`src/types/ship.ts` defines frames/armors/components/accessories/weapons and
the `ShipTemplate` rows. Migrations 066 (schema) + 067 (seed) create/seed the
`ship_*` template tables; 068 (RLS: read `view_ship_editor`, write
`ship_editor`), 069 (`ship_crews` roster), 070 (`extra_crew` → `crew_count`)
still **await DB apply**. `ship_crews`: named/unnamed crew with level + 6
stats + optional nullable cost; capped at `crew_count`. Access caps (059):
`can_view_ship_editor` / `can_use_ship_editor` — both admin-only; Lobby's
Archfar's Shipyard button routes to `/ship-editor`.

## The stats engine (`src/lib/shipStats.ts`, v8.1 FINAL)

Ships are **hero-like**: no retaliation/morale/rout, no ground 5-attack cap
(rate of fire = weapons × Fire Cycle × crew). Builder readouts (empty and
laden) and the editor chart come from pure functions — code is canonical;
`.scratch/shipyard-formula/shipyard.csv` + `FINDINGS.md` are the design
record, and `shipStats.test.ts` (27 tests) pins the formulas.

**Mass & budgets:** `MassCap` per frame (Tiny 35 · Small 55 · Medium 80 ·
Large 100). `armorMass = MassCap × armorFactor` (Wood 0, Plated 0.2, Metal
0.4, Ceramic 0.1, Stone 0.5). Ship mass = armor + Σ component masses + loaded
cargo; budget = MassCap. **Deck** is the co-equal budget (weapons + specials +
`ceil(crew_count/5)` quarters). Cargo = leftover Available Space.

**Accel** = `18 × sails ÷ mass` toward the active speed cap (laden = mass +
cargo). TopSpeed per frame (Tiny 12 … Large 9) / authored AtmosphereSpd;
environment picks the active cap (design setting, engine pending).

**MC/TE (turning):** `MC` = hexes to travel per 60° turn (integer, LOWER is
better); `TE = speed ÷ MC` (1 decimal, higher better) via the **parabola**
`TE(s) = TE_max · max(0, 1 − ((u − u*)/w)²)` with
`u = s / frameTopSpeed`,
`fill = rudders / frameMassCap`,
`u* = clamp(0.33 + 5.4·fill + 0.2·(25/mass − 0.5), 0.33, 0.6)`,
`w = clamp(0.4 + 0.05·rudders, 0.45, 0.7)`,
`TE_max = clamp(3·(25/mass)^0.7, 0.8, 3)`,
`MC = max(1, round(s / max(0.5, TE)))`.

Rudders push the sweet spot forward and widen it; lighter ships peak higher
and earlier; loading pulls the sweet spot back. The editor shows Speed / MC@50%
/ MC(laden) / TE(laden) rows across speeds with a Space/Atmosphere toggle.

**Crew:** `crew_count` (current complement) ≥ minimum crew
`ceil(Σ component/accessory crew requirements)`; quarters = `ceil(crew_count/5)`.
Officer actions per game turn: no Command Bridge `max(1, helmsman Int mod)`;
with bridge `max(4, 4 + captain Int mod)` (Int mods default 0 until crew-drop
goes live on the map).

**Weapons:** Small anchors pool 10 HP (20 reinforced), Large 20 (40
reinforced); one weapon per anchor; mount slots Fore/Left/Right/Rear/360;
per-instance pools (one hit kills one weapon, no chain).

## Hit boxes & durability (builder readouts)

- 1 ton of MassCap = 1 box; only **armor + hullR are safe** (never hit).
- `BoxHP = ceil(5 × (1 + armorFactor))` (Wood 5 · Plated 6 · Metal 7 ·
  Ceramic 6 · Stone 8). Weapon anchors 10/20.
- **Ship HP = frame base + hullR×25** — separate death pool.
- **DT flat 15**: damage below DT does nothing; ≥ DT passes full to Ship HP
  and the struck box pool. Hull reinforcement order: Helm → Bridge → extra →
  L.Weap → Rudder → S.Weap.
- The editor's right preview (`ShipRenderer/`) shows the **hit-box silhouette**
  grouped by subsystem (safe grey / hittable colored + pool HP) and the
  **functional-area station board** (Free Actions box + station crew circles)
  that the future scenario map will use to drop PC tokens onto stations.

## Engine hand-off (pending work)

`src/lib/shipMoveCost.ts`, `shipCombat.ts`, `useShipEngine.ts`,
`ScenarioMap/ShipPanel.tsx`, `spelljammer_ships` instances, sub-turn toggle,
firing arcs, board/boarding rules → all in `.scratch/spelljammer-mod/spec.md`
(design closed, v8.1). The player manual intentionally excludes ship content
until the engine ships.
