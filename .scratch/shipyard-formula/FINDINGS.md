# QuiVER Shipyard Formula — Findings

Status: settled (2026-08-30). Verified against all 17 reference ships in the
Shipyard HTML. Solver: `solve.mjs` / data: `data.mjs` (reproducible).

## The formula (matches 16/17 HP, all crew/cargo/speed/maneuver/DT, 14/17 cost)

| Stat | Formula |
|---|---|
| Capacity | `floor(frame × (1 + armor% + special%))` when special% exists, else `frame × (1 + armor%) + specialDirect` + Σ component capacity |
| **HP** | **`round10(frame × (1 + armorHP% + specialHP%))`** when special% exists, else `frame × (1 + armorHP%) + specialDirect` + Σ component HP. **Round to nearest 10 is the key discovery** — the raw formula (floor) produced 302.8 for the Bombard (preset 300); round10 reproduces all but one preset exactly. |
| DT | `frame + armor + special` + Σ component DT |
| Target area | per component `min(1, max(10, value))` (0 stays 0); hit table = Keel first, then others in component order |
| Cargo | `frame + cargoHolds × 5` + Σ |
| Speed | `min(9, max(0, x − 2×(size−1)))` where `tri(x) ≤ sails`, `tri(n) = n(n+1)/2`, size Small=1/Medium=2/Large=3 |
| Maneuver | Small: 1 rudder→2, 2+→1 · Medium: 2→3, 3+→2 · Large: 3→4, 4+→3 |
| Crew | `floor(Σ component crew + special crew modifier)` (sail 0.2, helm/rudder/weapons/crew 1) |
| Cost | special%: `floor(frame × (1 + armor% + special%) + Σ comps)`; else `floor(frame × (1 + armor%) + Σ comps + specialDirect)` |
| AC | armor option's AC (Wood 15, Plated 17, Metal 19, Ceramic 13, Stone 17) |

Component weights (per unit): helm −3 cap/+1 TA/+1 crew/5000gp · sail −1 cap/−0.2 HP/+0.25 TA/+1 speed step/+0.2 crew/200gp · rudder −4 cap/+1 TA/+1 maneuver/+1 crew/1000gp · cargo −5 cap/+1 TA/+5 cargo/100gp · std weapon −2 cap/+1 TA/+1 crew/300gp · large weapon −3 cap/+1 TA/+1 crew/800gp · hull reinforcement −0.5 cap/+5 HP/100gp · additional crew +1 crew.

## Reference-preset verification

- **HP: 16/17 match.** The miss: **Nightspider — formula 380, preset 400.** No clean weight/rounding variant reaches 400 (search: 14/17 best for integer weights). Preset is authored (book value).
- **Cost: 14/17 match.** Misses:
  - **Nautiloid, Nightspider, Tyrant: preset 0** — intentionally "not for sale" (mind flayer / neogi / beholder craft). Authored marker, not a formula miss.
  - **Turtle: formula 60,900, preset 60,200.** No natural variant (required special% 26.5% vs labeled 30%; hull cost 50 → 60,300). Likely authored typo.
- Crew / cargo / speed / maneuver / DT: **17/17 match** (floor for crew).

## Resolution (formula is the single source of truth)

- Nightspider preset HP corrected to **380**.
- Turtle preset cost corrected to **60,900**.
- Cost-0 ships keep `cost = 0` as an authored "unavailable" marker; a *built* ship always uses the formula cost.
- Capacity / target area / AC have no preset oracle — formula-only (documented above).

## Next steps

1. Migration 066: `ship_components` / `ship_component_options` / `ships` (blueprints) + seeds (12 components, all options, 17 reference ships with corrected values).
2. `src/spelljammer/lib/shipStats.ts` + tests: encode this formula; the 17 reference ships become the test oracle (HP round10 etc.).
3. Ship build table (Shipyard modal), then deck/top-side/bottom-side images + stations.

## 2026-08-30 — Shipyard v3 (logic-first redesign, supersedes the stat-fitting above)

The solver approach was abandoned in favor of a **mass-driven, description-first** model — stats emerge from component weights instead of being curve-fit to presets. Authoritative sheet: **`shipyard.csv`** in this folder (importable; formulas compute HP/Crew/Mass/Deck/AC/DT/Accel/BuildCost from the reference tables). Design decisions:

- **Helm Bridge is integral to every frame** (a ship is not a ship without one): ships are −5,000 gp / −3 t / +5 HP vs the old component model. Components: **Auxiliary Helm** (3,000 gp, backup helm), **Command Bridge** (4 t, −5 HP, 8 deck, **2 crew**, 6,000 gp → exactly +2 crew over book on bridged ships, no fudging).
- **Accel replaces frame Max Speed** (8/8/6/4 = hexes of speed gained per Helm action toward the universal cap 10; 12 via Overthrust). Speed is no longer the limitation — acceleration is; every ship can escape. **MC is role-authored** (book value) within the frame's MC envelope.
- **Cost reflects capability**: Build Cost = frame × armor mult + Σ components + specials + surcharges (**Watertight +50% frame×armor** — Turtle's book undercharge of underwater capability is now visible: Build 393,500 vs book 50,000). Book prices stay as authored **Market Price** (rank correlates, absolutes don't).
- **Captain kit** (spec.md §17.6 / HANDBOOK §17.6): Officer Action pool = 1 base + Command Bridges + Int bonus (>16); low Int shrinks the pool, never fails. Captain = tactical panel (all-component HP, loading, crew reserve + allocation — no enemy projection, manual game) + enable actions (redo / +1 result). No gambits, no toe-stepping, cooperative by construction. Command Bridge destroyed → panel blackout (visit stations to read them).
- **Feasibility test**: `Space Galleon (Gun Boat)` — doubled weapons + Command Bridge: +14,000 gp, −40 HP, +5 crew, same Accel/MC; a real trade-off, not a straight upgrade. Base Galleon ships without a bridge by default (option purchasable).

## 2026-08-30 (later) — Shipyard v4: DT gate, station HP, laden performance

Sheet now `shipyard.csv` (v4). Corrections and additions from the v3 iteration:

- **Lookup fix**: frame table rows 23–26, armor 29–33 (v3's ranges were off by one — every Large ship and Stone would have thrown `#N/A`).
- **Components are single-source**: ship formulas reference component-table cells (rows 36–44) instead of inline constants; edit a component once and all ships recompute. Specials remain manual per-ship columns (a ship carries several).
- **DT is a damage gate, corrected**: damage < DT does nothing; damage ≥ DT passes full to Ship HP AND the struck unit, destroys any unit with **StaHP ≤ DT** (why fragile HP is worthless), and spills to the crew at that post. The earlier "every hit double-wounds" wording was wrong.
- **Station HP axis added** (separate from the ship-HP cutout): auto-destroyed tier = hull spaces, cargo 5, sails 10, rudders 15, Aux Helm 15, S.Weap 20 (DT-20 ships only); survives tier = L.Weap 25, Helm Bridge 25, Command Bridge 30, Bombard 40, melee 20, Magazine 20.
- **Hull spaces** = 1 per 25 frame BaseHP (Tiny 8 / Small 10 / Medium 14 / Large 20); armor-peel buffer, pop → hit-list shrinks → criticals exposed, full Ship HP cost, never reduces Ship HP max.
- **Keel removed** — passive ×2-on-crit was a swingy single-point-of-death (bad on the player's only ship). Ship HP 0 already covers destruction.
- **hullR retuned** to 0.2 t / +5 HP / 250 gp, not targetable. **Extra crew** costs 0.25 deck each (berths stack).
- **Laden performance**: `Cargo Loaded` (actual scenario load) → Laden Accel = Accel × unladen mass ÷ laden mass; Laden MC = MC + round(2 × cargo ÷ mass), clamp 1–4. Heavy cargo haulers drop a full accel step and turn like barges; warships/light ships barely notice.
- Ship HP now = frame × armor + Σ cutouts + hullR×5, and frame BaseHP is the ship's practical max (bar hullR).

## 2026-08-30 (latest) — Shipyard v5: armor eats mass, mass budgets bind, MC = turn capacity

Sheet now `shipyard.csv` (v5). The mass model was broken and is fixed; MC is fully derived.

- **Armor eats mass**: `armorMass = MassCap × armorFactor` (Wood 0, Plated 0.2, Metal 0.4, Ceramic 0.1, Stone 0.5). The old `frame × (1 − armor%)` made *metal lighter* — physically backwards and why Scorpion's metal armor never disqualified it. Now ship mass = armor + components + cargo, budget = MassCap. **All 18 ships fit their caps** (Scorpion 46/55, Turtle 74/100, Bombard 64/100 — tight but legal).
- **Component masses retuned to fit caps**: sail 1.5, rudder 2, cargo hold 0.5, L.Weap 4, S.Weap 2, hullR 0.2, bridge 2, aux helm 1.5, crew 0.25 mass / **0.2 deck** (matches Hull R). Deck = co-equal budget (weapons + cargo + specials + extra crew ×0.2; rigging free).
- **Accel = 18 × sails ÷ mass**, thrust 18/sail; laden = mass + cargo. Frame no longer sets accel — **Top Speed** (12/11/10/9) is the frame cap; **differential caps** make interception a persistent `Vp − Vt` grind (Overthrust +2 = escape valve against up-to-one-frame-bigger pursuers).
- **MC = turn capacity per segment** (60° turns): `tier = floor(mass/25)`, `center = clamp(round(TopSpeed×0.65) − tier, 2, 8)`, `W = max(0, rudders − tier)`, `peak = clamp(rudders − floor(mass/45), 1, 3)`; MC(s) = 4 (mass<25 ∧ rudders≥2 ∧ near center) / 3 (peak≥3 ∧ ≤W) / 2 (≤W+2) / 1. Turns per game turn = MC × 5. Replaces the `speed/3` min-straight rule.
- **Results that fall out**: peak 3 = light military only (Damselfly, Shrike, Lamprey, Star Moth, Fast Lamprey); civilians (2 rudders) never exceed 2; heavy armor/weapons disqualify (Scorpion, Turtle, Bombard, Nightspider, Gun Boat peak 2); **Wasp is the only 4-turn ship** (mass 14.5 < 25); Tyrant = hover device (3 always). Bombard confirmed as the special siege case (no 3-band).
- **Speed is per TURN**; per segment a Helm action moves `speed/5` hexes and adjusts speed toward the cap.

## 2026-08-30 (final) — Shipyard v5.1: cargo = leftover capacity

- **Cargo holds removed — cargo is free leftover capacity**: `cargo capacity = MassCap − shipMass`, 1 ton capacity = 1 ton cargo. No purchases; **cargo is no longer a hittable subsystem** (the fragile cargo sponge is gone from the hit table — now hull spaces + sails + rudders + weapons + helm + bridge + specials).
- **Sail = 2 t** (thrust 18). All 18 ships still fit mass and deck budgets.
- Ships designed toward **~10% unused capacity** (`Unused = capacity − loaded load`). Cargo haulers hit it (Galleon 9.6%, Squid 7.9%, Living 10%, Hammerhead 10.1%); heavy-armor ships run tighter (Scorpion 3.2%, Turtle 6.6% — armor eats the margin); warships with small loads run large headroom (Lamprey 40%, Nautiloid 30%) — free space for troops/loot/ballast.
- **Load taxes maneuver**: MC now uses **current mass incl. cargo** — a laden freighter is clumsy (often 1 turn/segment), running light restores agility, and jettison helps both accel and turning. Retuned loads to fit capacity: Scorpion 12→9, Nightspider 50→30, Turtle 30→25, Gun Boat 75→60, Galleon 75→70. Retuned sails toward slack: Wasp 8, Damselfly 9, FF 9, Star Moth 9, Hammerhead 12, Living 11, Bombard 8; cargo haulers under-rigged (Galleon 3, Gun Boat 3, Squid 3).

## 2026-08-30 (design closed) — Shipyard v8.1 FINAL

Authoritative sheet: **`shipyard.csv`** (v8.1 FINAL). Design phase is closed — these are the locked values for DB + ship-editor implementation.

- **Hit boxes** replace StaHP + hull spaces: **1 t = 1 box**; only armor + Hull R safe; BoxHP = `5×(1+armorFactor)` round up (5/6/7/6/8). **Weapon anchors**: S = 10 (20 reinforced), L = 20 (40 reinforced), **per-instance pools** (one hit kills one weapon, no chain). Specials = mass×boxHP (Claws/Eyestalk = small anchor). **HullR = 1 t / 1,000 gp**, safe, +25 Ship HP **and** reinforces next-in-order (Helm→Bridge→extra→L→Rudder→S, skip missing). **Crew quarters = ceil(totalCrew/5) whole tons** (all crew housed; 1 deck/5). **Ship HP = frame base + hullR×25**; **DT = flat 15** (dropped Bombard/Stone 20s). Repair kits (Engineering) restore pools.
- **Movement**: speed per TURN, `speed/5` per segment; **Atmosphere Spd authored** per ship, scenario **Environment** (Space | Atmosphere, default Atmosphere) picks the active cap; **MC = turns per GAME TURN** (band formula, spent across 5 segments); **Fire Cycle (Rd)** replaces ROF (once per N rounds; tooltip); Jettison Heavy = Large cargo-ejector device (deploys 1-t space mines). Accel = 18×sails/mass, load-taxed.
- **Cost**: Plated mult **×2** (was 2.5). Frame/armor/component/accessory tables updated in `shipyard.csv`.
- **Seed templates** = the author's working file values (`Quiver ship analytic temp - spelljammer AI 8.1.csv`), with Scorpion Cargo Area = 10; Gun Boat kept as the hullR-20 "max heavy Large frame" experiment; over-90% util ships seeded as-is for in-game tuning.
- **DB**: all `ship_`-prefixed tables (`ship_frames/armors/components/accessories/weapons/templates` + joins + `spelljammer_ships`) — future migrations 066+. Scenario settings: `sub_turn_toggle`, `environment`, `firing_arcs`. Ship-editor UI contract: `.scratch/ship-builder/spec.md`.
- **Future tasks**: DB name grouping for QuiTTER (ship tables stay together); bigger frames (hit grid extensible); right-panel builder (ship icons, crew-station X layout, hit-grid editor).
