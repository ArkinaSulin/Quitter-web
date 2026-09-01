Status: planned

# Spelljammer Module

## Problem Statement

QuiTTER models mass battle on a hex grid with a merged turn economy: one game turn = 5 D&D 5e rounds. Ground units get 2 actions + retaliation (hard cap of 5 attacks+retaliations per turn); heroes get 5 full actions, full movement, no retaliation. There is no naval/aerial layer — no way to run ship-vs-ship combat under the same 5-rounds-to-one-turn framework, nor any "ship" entity in the data model.

The design goal is a **Spelljammer module** that:
- reuses the existing hex grid (50ft hexes), facing rules, hero economy, command log, and soft-enforcement philosophy;
- treats ships as **hero-like** entities (full actions, full movement, no retaliation, no morale/rout);
- adds a **5-sub-turn segment** economy for space combat (toggleable), where the merged turn is split into 5 movement segments;
- resolves ship damage through a **DT gate** (flat 15) and **hit boxes** (1 ton = 1 box; only armor + hullR safe; per-instance pools with weapon anchors) — below-DT hits do nothing, ≥ DT passes full to the struck box pool and the ship-wide **Ship HP** pool, with damage spilling to the crew manning the struck post;
- never simulates hero-on-hero personal combat — boarding and post-destruction hero fights hand off to a dedicated D&D VTT.

## Solution

### Mode toggle (VTT engine setting)

- **Sub-turn toggle OFF** (default): the game plays exactly like normal QuiTTER. Spelljammers on a planetary map are **ground combatants** — big units on the shared map, fought under normal rules. They keep their own ship movement rules (see below) and never retaliate, but coexist with troops on one map.
- **Sub-turn toggle ON**: a **space scenario**. All heroes are on ships (one or multiple per ship). One game turn is split into **5 segments**; each hero gets **1 action per segment** (5 segments × 1 action = their 5 full actions). Ship movement is decided **on the fly** — the Helm declares the vector each segment; there is **no pre-plotted movement**.
- Land and space battles are played as **separate scenarios** — the game does not simulate parallel fronts. The war is wherever the heroes are.

### Segment economy

- One game turn = 5 segments, each representing one D&D round of the merged turn.
- Each hero on a ship takes **1 action per segment**: either a *personal* action (fight, cast, move on deck) or a *station duty* (Helm Bridge, Weapons, Repairs, Engineering, Sails, Rudder, Command Bridge).
- **Undo/redo are per-action within a segment** (existing command-log granularity); segment boundaries only pace ship movement and reload counters.
- Reload/repair counters tick at **segment end** (space) or **turn end** (planet map).
- Some duties are **full-turn long** (repair, engineering boost): the hero commits for all 5 segments; the engine tracks the commitment and the tick per segment.

### Ship movement (doc-faithful, decided on the fly)

- A ship occupies a **single core hex** for movement/distance/collision; bow/stern art may overhang but tactics use the core hex.
- **Speed is per TURN** (1 turn = 5 segments = 5 D&D rounds). A Helm action each segment moves the ship **`speed ÷ 5` hexes (round up)** along its facing — its share of the turn — and adjusts the per-turn speed stat by **Accel** toward the active speed cap.
- **Top Speed per frame**: Tiny 12 · Small 11 · Medium 10 · Large 9. **Atmosphere Spd** is authored per ship (given, not calculated). The scenario **Environment** setting (Space | Atmosphere, **default Atmosphere**) picks the active cap: `activeTopSpeed = IF(environment = "Space", TopSpeed, AtmosphereSpd)`. **Overthrust** = active + 2 via a Helm skill check; failure risks propulsion subsystem damage. **MC is unchanged by environment** (the turn-capacity curve just reads the current speed).
- **Accel = 18 × sails ÷ mass** (sail-driven; mass = armor + components + loaded cargo). A light ship reaches its cap in 2–3 actions; a heavy siege ship crawls. **Differential caps make interception a persistent grind**: a faster frame closes `Vp − Vt` hexes per segment once at its cap — the "bit by bit" chase. Big ships escape by guns and Overthrust, small ships by positioning (arcs).
- **MC (maneuver class) = hexes to travel per 60° turn** — an integer, **LOWER = tighter turn = better**, from the parabola formula (see Shipyard components). **TE (Turning Efficiency) = `speed ÷ MC`** (1 decimal, higher = better) — the maximum 60° turns per game turn. This **replaces the `speed/3` min-straight rule** — no hex-advance requirement between turns; MC and TE are the rule.
- Reuses the existing facing rules (60° turns; vertex-based facing).
- **Firing arcs**: per-scenario toggle — ON honors arcs (Fore/Rear/360/Sides), OFF = all weapons 360°. Arcade no-plot play uses the toggle freely.
- **Jettison device** (Large mount): ejects 1 t of cargo per operation over time (not a weapon; DC 11, DC 15 same-round), creates difficult-terrain hexes, and deploys 1-t **space mines**. The instant +1-Accel panic action is replaced by this device.

### Stations & crew

- **Stations** (each a subsystem with units): **Sails** (speed boost), **Rudder** (turning boost), **Weapons** (firing), **Helm Bridge** (helmsman — integral to every frame), **Command Bridge** (Captain's panel, see §17.6), **Engineering** (repair / speed boost duty), plus the optional **Auxiliary Helm** component (emergency backup helm station).
- A hero mans a station by spending their segment action on it.
- **Crew reserve** (shared pool per ship): players click from the reserve to assign NPC crew to a station. Assigned crew **automate loading** — e.g. crew loads a ballista over 3 segments; the player gets a **"ballista ready" reminder** (message) when a crew-allocated weapon finishes loading.
- **Firing a loaded weapon requires an active command action** from a PC or NPC officer.
- Ready weapons display a **firing-arc fan overlay** on the map.

#### Shipyard components (Archfar's Shipyard)

- **Frames include the Helm Bridge** — a ship is not a ship without one; it cannot be controlled without a helm. The builder does not charge for a mandatory part (small ships get genuinely cheap). Frame tables: Tiny 35/200/10/**12**/2/5,000/8 · Small 55/250/30/**11**/3/15,000/10 · Medium 80/350/50/**10**/4/35,000/14 · Large 100/500/90/**9**/5/60,000/20 (mass cap / base HP / deck squares / **Top Speed** / **MaxRudders** / base cost / **hull spaces** = 1 per 25 BaseHP). The frame's only influence on MC is **Top Speed** (the cap) and **MaxRudders**. Armor: Wood 0/15/5/×1 · Plated 0.2/17/6/**×2** · Metal 0.4/19/7/×4 · Ceramic 0.1/13/6/×3 · Stone 0.5/17/8/×1 (mass factor / AC / **boxHP** / cost mult).
- **Armor eats mass capacity**: `armorMass = MassCap × armorFactor` (Wood 0, Plated 0.2, Metal 0.4, Ceramic 0.1, Stone 0.5). **Ship mass = armor + Σ components + loaded cargo**, budget = MassCap (overload = soft penalty). **Cargo = leftover Available Space** (1 t capacity = 1 t cargo): **Cargo Area** = the designated load, **Unclaimed Space** = Available − Cargo Area. Gear and cargo compete for the same budget.
- **Accel = 18 × sails ÷ mass** (thrust 18/sail), per Helm action toward the active speed cap. **Loaded cargo throttles it**: on the map, actual cargo (not capacity) adds mass; the builder shows empty **and** laden Accel/MC (a cargo-load slider drives this live).
- **Components** (each `{mass, deck, crew, cost, reinforce#, hittable}`): Helm Bridge (2 t, 6 deck, 1 crew, 0 gp, reinforce #1, hittable — free with frame) · Auxiliary Helm (2 t, 6 deck, 1 crew, 3,000 gp, #3) · Sail (2 t, 0 deck, 0.5 crew, 2,000 gp, never reinforced, hittable — rigging, above-deck) · Rudder (2 t, 0 deck, 1 crew, 3,000 gp, #5) · L.Weap (4 t, 6 deck, 1 crew, 4,000 gp, #4) · S.Weap (2 t, 4 deck, 1 crew, 2,000 gp, #6) · **Hull R** (1 t, 0 deck, 0 crew, 1,000 gp — **safe box**, +25 Ship HP **and** reinforces the next subsystem in order) · **Crew quarters** (`ceil(totalCrew/5)` whole tons, 1 deck per 5, 0 gp, hittable — all crew housed, no partial tons) · Command Bridge (2 t, 8 deck, 2 crew, 6,000 gp, #2).
- **Reinforcement order** (each Hull R doubles the next subsystem's pool): **1 Helm Bridge → 2 Command Bridge → 3 any additional Helm/Bridge → 4 L.Weap → 5 Rudder → 6 S.Weap** (skips missing items). Sails, cargo, and unclaimed space are never reinforced. **No "key" flags** — a civilian ship with no Hull R has all base pools.
- **Keel is removed** — the passive ×2-damage-on-crit was a swingy single-point-of-death; Ship HP 0 already covers destruction. (A keel kill shot, if ever wanted, belongs as a *targeted crit option* on a damaged ship — never passive.)
- **Derived stats**: Ship HP = frame base + hullR×25; **DT = flat 15**; mass = armor + Σ components (+ cargo when laden); deck = the co-equal budget; Build Cost = frame × armor mult + Σ components + specials + capability surcharges. **Components are single-source** in the formula sheet (`.scratch/shipyard-formula/shipyard.csv`).
- **Specials** (each `{mass, deck, crew, cost, pool, hittable}`): **Air Envelope** (0, air, not hittable) · **Watertight Hull** (5 t, safe) · Ram (5 t, 5,000 gp) · Grappling Jaws (2 t) · Nautiloid Tentacles (3 t, 4,000 gp) · Bombard Mount (40 t, 80,000 gp) · Magazine (2 t, 6,000 gp) · Smoke Sac (1 t, 2,000 gp) · Living Treant (2 t, 50,000 gp — regenerate, replaces 9 crew) · Hover Device (2 t, 60,000 gp — rotate in place, MC 3 always; NOT for sale) · Scorpion Claws (2 t, small anchor) · Eyestalk Cannons (2 t, small anchor) · Low Visibility (0, magic, not hittable) · Planar Device (4 t, 60,000 gp). Special pool = mass × boxHP (Claws/Eyestalk = small weapon anchor).
- **Weapons** (`ship_weapons`, catalog in `.scratch/shipyard-formula/shipyard.csv`): mounts **Small** (S.Weap, anchor pool **10 / 20 reinforced**) · **Large** (L.Weap, anchor **20 / 40 reinforced**) · **Special** (mass×boxHP). **Fire Cycle (Rd)** — fires once per N rounds (load N−1, fire on N); tooltip: *once per N rounds*. Weapon pools are **per-instance** (one hit kills one weapon, never a chain). Giff Gun = disposable one-shot; Jettison Heavy = Large cargo-ejector device (also deploys 1-t space mines).
- **MC (hexes to travel per 60° turn)** at per-turn speed s uses **current mass incl. cargo**. `u = s/T`; `fill = rudders ÷ frameMassCap` (tons: Tiny 35 · Small 55 · Medium 80 · Large 100 — tiny/small reach full rudder benefit cheaply); **`u* = clamp(0.33 + 5.4·fill + 0.2·(25/mass − 0.5), 0.33, 0.6)`** (sweet spot); **`w = clamp(0.4 + 0.05·rudders, 0.45, 0.7)`** (width); **`TE_max = clamp(3·(25/mass)^0.7, 0.8, 3)`** (peak). **`TE(s) = TE_max·max(0, 1 − ((u − u*)/w)²)`** (parabola); **`MC(s) = max(1, round(s / max(0.5, TE(s))))`**; **`TE = speed ÷ MC`** (1 decimal). **Rudders push the sweet spot forward and widen it; lighter ships peak higher and further forward; load pulls the sweet spot back** (a laden freighter is clumsy, running light restores agility). **Crew roster** (`ship_crews`): named/unnamed crew with level + six stats + optional cost (null = no listed cost ≠ 0 = free). **Officer actions / game turn** = no bridge: `max(1, helmsman Int mod)`; with bridge: `max(4, 4 + captain Int mod)` (Int mods come from crew dropped on stations; default 0 in the builder).
- **Ship classes by role/description** drive AC → TopSpeed/Accel → MC → HP → cargo → crew → cost (see `.scratch/shipyard-formula/FINDINGS.md`). Roles emerge from the numbers: scouts are light and fast, cargo haulers are slow-when-laden, warships trade speed for armor and guns.

### Damage model (hit boxes)

- **Hit boxes**: **1 ton of MassCap = 1 box** (Tiny 35 · Small 55 · Medium 80 · Large 100). The builder shows the grid grouped by subsystem — the ship's hit silhouette. **Box composition** sums to MassCap: armor boxes (safe, labeled) + gear boxes (by component mass) + cargo boxes (loaded tonnage) + unclaimed boxes (empty structure). **Only armor and Hull R are safe (never hit)**; Helm Bridge is hittable (it's a real target).
- **Box HP = `5 × (1 + armorFactor)`, round up** (Wood 5 · Plated 6 · Metal 7 · Ceramic 6 · Stone 8). **Weapon anchors**: Small = 10 HP (20 reinforced), Large = 20 HP (40 reinforced) — fixed, ignore the old per-weapon AC/DT/HP. **Per-instance pools**: each component instance (each sail, each weapon) has its own pool — one hit destroys one weapon, never a chain reaction across the battery. Specials = mass × boxHP (Claws/Eyestalk use the small anchor).
- **Reinforcement**: each Hull R (1 t, safe) = **+25 Ship HP** **and** doubles the next-in-order subsystem's pool (Helm→Bridge→extra Helm/Bridge→L.Weap→Rudder→S.Weap, skipping missing). Sails/cargo/unclaimed never reinforced.
- **Ship HP = frame base + hullR×25** — a separate death pool. Ship HP 0 = destroyed regardless of remaining box pools.
- **DT is a damage gate (flat 15)**: **damage < DT does nothing** — no box damage, no Ship HP damage, no crew spill. **Damage ≥ DT passes full** to Ship HP **and** the struck instance's pool. Passing hits destroy any box whose pool is exhausted; regular boxes (5–10 HP) die to any passing hit; hardened pools (reinforced 20–80, big specials) survive 1–3.
- **Hit selection**: a passing hit picks a random box (mass-proportional automatically); damage applies to that subsystem's pool (overkill wasted); pool ≤ 0 → the subsystem is wrecked and its boxes leave the grid (the silhouette shrinks → reselection shifts toward survivors).
- **Crew spill**: a passing hit spills the same damage to the crew at the struck post (heroes and NPC crew). Below-DT hits are fully gated. Unstationed heroes take no spill.
- **Crew quarters** are a hittable box (mass × boxHP); destroyed quarters = berths lost.
- **Repair kits**: most ships carry them — Engineering duty restores box-pool HP to a limited extent.
- **Crits**: on a critical hit the attacker chooses a **targeted subsystem strike** (explicit subsystem; Helm Bridge and Command Bridge are excluded from targeted strikes but still hittable by random hits) or **random double damage**. **Command Bridge destroyed** → the Captain's panel goes dark; to read a station's state a player must visit it (spend the turn there).
- **Sail loss recalculates accel live** (`18 × remaining sails ÷ mass`). Rudder loss recalculates MC live.
- **Ship destroyed** (Ship HP = 0): the ship is removed from the simulation **regardless of remaining box pools**. Onboard heroes do **not** automatically die — if their HP survives, the fight continues in the D&D VTT; the sim's part ends. (Optional escape rule: a Helm eject action earlier in the turn may lifeboat heroes to an adjacent hex.)
- **No retaliation, no fire cap**: ships never retaliate. Rate of fire is bounded by **weapon count × Fire Cycle × crew availability** — a ship with several weapons can exceed the ground game's 5-attack cap; the cap concept does not apply to ships.
- **Loaded cargo throttles acceleration**: on the scenario map the ship's **actual cargo load** (not capacity) adds to mass; Accel re-derives live (`18 × sails ÷ laden mass`) and MC taxes (a laden freighter is clumsy). The shipbuilder shows empty and laden readouts.

### Captain's Command

- **Visibility / information war**: on **Tiny** ships everyone sees all station stats (small ship, everyone in earshot). On **Small+** ships, a player sees **only their own station** — its HP, its load progress, its crew fill. **No HP numbers exist outside a station or the Captain's panel.**
- **Command Bridge** (optional component, 8 deck, 2 crew): grants the **Captain's tactical panel** — all components' HP, loading progress for crew-allocated weapons, crew reserve + allocation (the Captain can allocate crew to any station, e.g. pre-loading a weapon). **The panel shows no enemy speed/trajectory projection** (manual game); intel beyond the panel is roleplay. The Helm gets no extra capability. If the **Command Bridge is destroyed** the panel goes dark — to read a station's state a player must visit it (spend the turn there).
- **Officer Action pool** per game turn = **no Command Bridge: `max(1, helmsman Int modifier)`; with a bridge: `max(4, 4 + captain Int modifier)`** — the helmsman and captain each count as officers. The Int modifier comes from the crew dropped onto the Helm/Captain stations on the map (defaults to 0 in the builder until crew drops are live). Low Int just **shrinks the pool** — no fail checks, no lost orders, no demoralizing probability.
- **Captain kit = panel + enable actions, never replacement**: an Officer Action enables a teammate — **redo** their last action (rides undo/redo) or **+1 result** on their next. The captain chooses *who and when*; the teammate still performs their own action and keeps the glory (enabling gives thunder, never takes it). No captain move executes another player's action, forces a fire, or authorizes Overthrust (that is Engineering's job) — **gameplay is cooperative by construction**.
- Ships without a Command Bridge still get the **helmsman's officer action(s)** (`max(1, helmsman Int)`); a bridge adds the captain and raises the base to 4.

### Equipment modifiers

- **Seasoned Crew**: required crew count per station ±20% (can reduce a weapon's crew requirement by 1).
- **Well-Tuned Gears**: weapon Fire Cycle −1 (fires a round sooner).
- **Scheduled Maintenance**: rudder responsiveness +1 (MC band peak widened by 1).
- **Pulley System / Enhanced Rigging**: +1 Accel (extra thrust per sail).

### VTT system settings

- **Spelljammer Sub-Turn Toggle** engine setting: turns the 5-sub-turn PC combat layer ON/OFF. When disabled, the system resolves as a standard macro-scale wargame (ships as ground combatants).
- **Environment** setting: `Space | Atmosphere` (**default Atmosphere**) — picks whether the active speed cap is TopSpeed or AtmosphereSpd. MC unchanged.
- **Firing Arcs** toggle: ON honors weapon arcs (Fore/Rear/360/Sides), OFF = all weapons 360°.

## User Stories

1. As a GM, I want a spelljammer scenario where all heroes are aboard ships and the turn splits into 5 segments, so ship fights run under the same merged-turn framework.
2. As a player, I get 1 action per segment (5 across the turn) — personal or station duty — so my hero contributes every round.
3. As a Helm, I move the ship on the fly each segment (speed ÷ 5 hexes), accelerate toward my frame's Top Speed, and spend my MC turn allowance (band formula by current speed) so acceleration and turning feel like a real vessel — a chase is a persistent grind against a faster frame, and my Overthrust is the panic button.
4. As a player, I assign crew from the reserve to stations and get a "weapon ready" reminder when loading completes, so automation runs without me.
5. As a Weapons officer, I fire loaded weapons with a command action; rate of fire is capped by weapons × loading × crew, not by the ground-game attack cap.
6. As a crewman, I watch hits land on random subsystem units, each hit also chipping Ship HP, so ships die before their stations do.
7. As a hero at a station, I take the hit's damage when it exceeds the ship-wide damage threshold, so manning a post is a risk/reward choice.
8. As a Captain, I see the whole ship from my Command Bridge panel (all components' HP, loading, crew reserve) and spend Officer Actions to enable teammates (redo or +1 result); low Int just shrinks my pool — never a failed check.
9. As a player, when my ship dies and my hero survives, the fight continues in the D&D VTT — the sim hands off cleanly.
10. As a player, I can undo/redo any action within a segment, with the random component pick recorded in the command log so undo restores the same outcome.
11. As an admin, I can open **Archfar's Shipyard** from the Lobby to build ships (view capability `can_view_ship_editor`, use capability `can_use_ship_editor` — both admin-only).

## Implementation Decisions

### Access capabilities (done — migration 059)

- `access_roles.can_view_ship_editor` and `access_roles.can_use_ship_editor` BOOLEAN NOT NULL DEFAULT false, seeded **true only for `admin`**, false for all other roles.
- `user_has_access` extended with `view_ship_editor` / `use_ship_editor` cases (mirrors migration 050).
- Client: `useProfile` `Access.canViewShipEditor` / `canUseShipEditor`; Lobby shows the **Archfar's Shipyard** button when `canViewShipEditor` (placeholder modal for now; `canUseShipEditor` will gate the future builder).

### Ship entity & schema (planned — future migrations 066+)

- New `ship_`-prefixed tables (kept together for grouping): `ship_frames` (frame, mass_cap, base_hp, deck_space, top_speed, max_rudders, base_cost, hull_spaces) · `ship_armors` (name, mass_factor, ac, box_hp, cost_mult) · `ship_components` (name, mass, deck, crew, cost, reinforce_order, hittable) · `ship_accessories` (name, mass, deck, crew, cost, pool_type, hittable, effect) · `ship_weapons` (name, mount, damage, range_std, range_dis, fire_cycle_rd, crew, cost, ammo_cost, special).
- `ship_templates` (name, role, frame_id, armor_id, atmosphere_speed, rudders, sails, l_weap, s_weap, hull_r, bridge, aux_helm, extra_crew, cargo_area) + joins `ship_template_accessories` / `ship_template_weapons` (mount slot + count).
- `spelljammer_ships`: scenario instance (id, scenario_id, template_id, hex, facing, speed_stat, ship_hp/max, loaded_cargo, crew_assigned, team, per-subsystem box-pool state).
- Heroes join a ship through the existing attach-style mechanism extended to `attachedToShipId`.
- Scenario settings: `spelljammer_enabled`, `sub_turn_toggle`, `environment` (default Atmosphere), `firing_arcs`.

### Future module file map (all spelljammer rules in their own files)

- `src/lib/shipMoveCost.ts` (pure): speed-state movement — `speed/5` hexes per Helm action, Accel = `18 × sails / mass` toward the active speed cap (TopSpeed vs AtmosphereSpd by Environment), MC turn-capacity band (per-game-turn 60° turns by current speed), Overthrust (+2, skill check + subsystem risk), Fire Cycle, arcs toggle. Test file alongside.
- `src/lib/shipCombat.ts` (pure): weapon fire resolution, DT gate (flat 15), hit-box pick (seeded RNG), per-instance pool damage, hull/cargo/unclaimed armor-peel grid shrink, crew spill, crits (targeted subsystem / 2× random), component destruction → performance recalc. Test file alongside.
- `src/lib/shipStats.ts` (pure): derived ship stats from live box pools (accel, MC, pools, ship HP, cost).
- `src/types/ship.ts` + `src/lib/shipMappers.ts`: ship types + Supabase row mapping (mirrors `templateMappers`).
- `src/hooks/useShipEngine.ts`: ship commands (HELM_MOVE, FIRE_WEAPON, MAN_STATION, ASSIGN_CREW, REPAIR, ENGINEER, CAPTAIN_COMMAND, JETTISON) with segment tick state, riding the command log so undo restores every delta incl. the random box pick.
- `src/components/ScenarioMap/ShipPanel.tsx`: ship stats, box-pool list, station assignment, crew reserve, weapon readiness.
- `src/components/ShipEditor/`: the ship builder (gated by `can_use_ship_editor`). UI contract: `.scratch/ship-builder/spec.md`.
- `src/components/ShipRenderer/`: shared ship visuals — `ShipHitGrid` (hit-box silhouette) + `ShipFunctionalArea` (station board: Free Actions box on top for PC actions, station boxes with crew circles). The builder previews them; the map renders them live (PC tokens dropped on a station = ship action, on Free Actions = PC action; crew allocation from a floating window).

### Command log & undo

- Every ship action is a command with sub-steps (deltas for ship HP, subsystem unit HP, speed, facing, load counters, crew, hero HP), so undo restores all state.
- The **random component pick is recorded in the command** (like `unitCombat.ts` already records rolls) — undo/redo replay the identical outcome, never a new random draw.
- Undo granularity stays per-action within a segment.

### Soft enforcement

- Same philosophy as the ground game: spending beyond a budget or committing a station without crew shows a **confirm modal**; confirming deducts fully (may go negative) and pushes a **red notification**. Never hard-blocked (except GM-toggled settings).
- Captain's low Int is a **capacity** cost, never a failure: the Officer Action pool simply shrinks (§17.6). There are no lost-orders rolls or red "order lost" notifications — nothing a player fails by being captain.

## Testing Decisions

Pure-function tests only, mirroring `unitCombat.test.ts` / `moveCost.test.ts` (seeded RNG, no async/DB/React):

1. **`shipMoveCost.test.ts`**: `speed/5` hexes per Helm action; Accel = 18×sails/mass toward active speed cap (TopSpeed vs AtmosphereSpd by Environment setting); Overthrust +2 with check + subsystem-damage risk; MC band formula (tier/center/W/peak; the 4-premium; peak 3 vs 2; civilians never 3; heavy armor disqualifies; load taxes maneuver); differential-cap chase closes `Vp − Vt` per segment; Fire Cycle; arcs toggle; on-the-fly (no plotting) semantics.
2. **`shipCombat.test.ts`**: DT gate flat 15 (below-DT hit does nothing; ≥ DT passes full to Ship HP + struck box pool); hit-box pick (mass-proportional, seeded); per-instance pools (one weapon dies, no chain); box-popping shrinks the grid (criticals get easier) without Ship HP max loss; crew spill to stationed crew; crit targeted subsystem (Helm Bridge/Command Bridge excluded from targeted strikes but hittable randomly) vs 2× random; Command Bridge destroyed → panel blackout; Ship HP 0 → destroyed regardless of box pools; repair kits restore pools.
3. **`shipStats.test.ts`**: performance recalc after destruction (sail loss → accel, rudder loss → MC, weapon pool destruction, hullR reinforcement intact).
4. **Segment tick**: Fire Cycle / repair counters decrement at segment end (space) / turn end (planet); ready-reminder message triggers.

Not tested (manual QA / integration-only): the sub-turn toggle propagation, station/crew UI, ship token rendering, Lobby shipyard button visibility, VTT handoff narration.

## Out of Scope

- **Boarding combat** — ships can come alongside and heroes board, but the fight is **handed off to a dedicated D&D VTT**; the sim never resolves hero-on-hero personal combat (nor hero-vs-crew on a deck grid).
- **Hero death on ship destruction** — heroes never auto-die; the sim ends its part and play continues in the VTT.
- **Ship builder** — the Archfar's Shipyard UI ships empty in v1 (button + placeholder modal); ship templates are authored via DB.
- **Parallel fronts** — land and space battles are separate scenarios, never simulated simultaneously.
- **Hard enforcement** — consistent with the ground game, spending is never hard-blocked.
- **Pre-plotted movement** — all ship movement is decided on the fly per segment.

## Further Notes

- Ships are hero-like: no retaliation, no morale, no rout, no formation economy — they never enter the ground-game 5-attack+retaliation cap; rate of fire is weapons × Fire Cycle × crew.
- Hero ground economy applies aboard ships: heroes convert actions to movement at `maxMP/5` per action (5 actions = one full move, fraction carries, 1 decimal) — in a space segment, 1 action = 0.6 MP for a 3-MP hero. The ground 5-attack cap does not apply to ships or heroes.
- 50ft hexes are shared with the ground game; a 30ft ground unit moves ~0.6 hex/turn while a ship at speed 9–12 crosses the board — the scale mismatch is accepted by design (ships are the fast layer).
- Ship turning is governed by **MC** (hexes to travel per 60° turn, parabola by speed; TE = speed ÷ MC) — no MP charge, no `speed/3` commitment; the MC/TE model is the rule.
- Migration 059 (`ship_editor_access`) is applied. Ship schema migrations 066 (`ship_*` tables) + 067 (seed) are written.
