Status: planned

# Spelljammer Module

## Problem Statement

QuiTTER models mass battle on a hex grid with a merged turn economy: one game turn = 5 D&D 5e rounds. Ground units get 2 actions + retaliation (hard cap of 5 attacks+retaliations per turn); heroes get 5 full actions, full movement, no retaliation. There is no naval/aerial layer — no way to run ship-vs-ship combat under the same 5-rounds-to-one-turn framework, nor any "ship" entity in the data model.

The design goal is a **Spelljammer module** that:
- reuses the existing hex grid (50ft hexes), facing rules, hero economy, command log, and soft-enforcement philosophy;
- treats ships as **hero-like** entities (full actions, full movement, no retaliation, no morale/rout);
- adds a **5-sub-turn segment** economy for space combat (toggleable), where the merged turn is split into 5 movement segments;
- resolves ship damage through **subsystem units** (each with its own HP) that **double-wound** a ship-wide **Ship HP** pool, with a ship-wide damage threshold that spills to the hero manning the struck station;
- never simulates hero-on-hero personal combat — boarding and post-destruction hero fights hand off to a dedicated D&D VTT.

## Solution

### Mode toggle (VTT engine setting)

- **Sub-turn toggle OFF** (default): the game plays exactly like normal QuiTTER. Spelljammers on a planetary map are **ground combatants** — big units on the shared map, fought under normal rules. They keep their own ship movement rules (see below) and never retaliate, but coexist with troops on one map.
- **Sub-turn toggle ON**: a **space scenario**. All heroes are on ships (one or multiple per ship). One game turn is split into **5 segments**; each hero gets **1 action per segment** (5 segments × 1 action = their 5 full actions). Ship movement is decided **on the fly** — the Helm declares the vector each segment; there is **no pre-plotted movement**.
- Land and space battles are played as **separate scenarios** — the game does not simulate parallel fronts. The war is wherever the heroes are.

### Segment economy

- One game turn = 5 segments, each representing one D&D round of the merged turn.
- Each hero on a ship takes **1 action per segment**: either a *personal* action (fight, cast, move on deck) or a *station duty* (Helm, Weapons, Repairs, Engineering, Sails, Rudder, Bridge).
- **Undo/redo are per-action within a segment** (existing command-log granularity); segment boundaries only pace ship movement and reload counters.
- Reload/repair counters tick at **segment end** (space) or **turn end** (planet map).
- Some duties are **full-turn long** (repair, engineering boost): the hero commits for all 5 segments; the engine tracks the commitment and the tick per segment.

### Ship movement (doc-faithful, decided on the fly)

- A ship occupies a **single core hex** for movement/distance/collision; bow/stern art may overhang but tactics use the core hex.
- **Speed state**: the ship has a current speed (hexes per segment-action). A Helm action moves the ship up to its **current speed** in hexes along its facing.
- **Propulsion Surplus = Thrust Points − Mass**: governs how many speed *steps* the ship can change per Helm action:
  - Light vessels (high surplus): multi-step jumps (e.g. +3 steps/action) — fast acceleration/deceleration.
  - Heavy vessels (low surplus): +0.5 or +1 step/action — needs turns of planning to reach high speed or stop.
- **Universal speed cap**: Speed 10 (Speed 12 via Overthrust), independent of class.
- **Mandatory straight movement**: between two consecutive 60° turns the ship must move a minimum number of straight hexes based on its current speed: `hexes before turn = current speed / 3`.
- Reuses the existing facing rules (60° turns; vertex-based facing).

### Stations & crew

- **Stations** (each a subsystem with units): **Sails** (speed boost), **Rudder** (turning boost), **Weapons** (firing), **Helm** (helmsman), **Bridge** (Captain's commands), **Engineering** (repair / speed boost duty).
- A hero mans a station by spending their segment action on it.
- **Crew reserve** (shared pool per ship): players click from the reserve to assign NPC crew to a station. Assigned crew **automate loading** — e.g. crew loads a ballista over 3 segments; the player gets a **"ballista ready" reminder** (message) when a crew-allocated weapon finishes loading.
- **Firing a loaded weapon requires an active command action** from a PC or NPC officer.
- Ready weapons display a **firing-arc fan overlay** on the map.

### Damage model

- **Ship HP** = ship integrity pool, determined by ship class/integrity — **independent** of station HP. At 0 the ship is destroyed regardless of remaining station HP.
- **Subsystem units**: every subsystem (Sails, Rudder, Weapons, Hull Core, …) is built from *units*; each unit has **its own HP**. At 0 the unit is **removed from the component list** and the ship's performance stats are **recalculated** (e.g. a lost Sail unit = −1 propulsion; a lost Rudder unit = −1 turning; a lost weapon unit = that weapon can no longer fire; a lost Hull Core unit = −X Ship HP max).
- **Proportional hit selection**: an incoming hit picks a component **uniformly at random from the alive component list** (6 Sail units → 6 entries → 60% chance). Hits may land on the same component repeatedly or on a fresh one — it is randomized, not spread. Destroyed components are not in the list.
- **Double-wound**: every hit damages the struck subsystem unit's HP **and** Ship HP **simultaneously** (same amount). Ship death therefore arrives well before all stations are destroyed.
- **Ship-wide damage threshold** (one per ship, not per station): if a hit's damage **exceeds** the threshold, the hero manning the struck station takes the **same damage** (hero HP). Under-threshold hits are absorbed by the station. Heroes not at a station take no spill.
- **Crits**: on a critical hit the attacker chooses either a **targeted subsystem strike** (explicit subsystem; Helm and Bridge are protected) or **random double damage** (roll the proportional table, deal 2× to the struck component).
- **Ship destroyed** (Ship HP = 0): the ship is removed from the simulation **regardless of station HP**. Onboard heroes do **not** automatically die — if their HP survives, the fight continues in the D&D VTT; the sim's part ends. (Optional escape rule: a Helm eject action earlier in the turn may lifeboat heroes to an adjacent hex.)
- **No retaliation, no fire cap**: ships never retaliate. Rate of fire is bounded by **weapon count × loading time × crew availability** — a ship with several weapons can exceed the ground game's 5-attack cap; the cap concept does not apply to ships.

### Captain's Command

- The Captain (Bridge) manages crew efficiency via **Intelligence modifier** (baseline Int 16 / +3).
- **Positive** (+1 per point above baseline): grants **1 extra Command Action per turn** per point, assignable to a PC: **Reroll/Redo** (a PC redoes their last action — rides the undo/redo system) or **Tactical Boost** (temporary acceleration, tight turning, or an immediate extra weapon fire).
- **Negative** (−1 per point below baseline): each negative point causes **1 random PC action to fail that turn** due to miscommunication. This is a **soft failure**: the action simply does not execute and a **red notification** ("order lost") is pushed — never a hard block or a rolled failure.

### Equipment modifiers

- **Seasoned Crew**: required crew count per station ±20% (can reduce a weapon's crew requirement by 1).
- **Well-Tuned Gears**: weapon reload time −1 sub-turn.
- **Scheduled Maintenance**: rudder responsiveness +1 (reduces mandatory straight hexes between turns by 1).
- **Pulley System / Enhanced Rigging**: Propulsion Surplus +1 (faster speed step changes).

### VTT system settings

- **Spelljammer Sub-Turn Toggle** engine setting: turns the 5-sub-turn PC combat layer ON/OFF. When disabled, the system resolves as a standard macro-scale wargame (ships as ground combatants).

## User Stories

1. As a GM, I want a spelljammer scenario where all heroes are aboard ships and the turn splits into 5 segments, so ship fights run under the same merged-turn framework.
2. As a player, I get 1 action per segment (5 across the turn) — personal or station duty — so my hero contributes every round.
3. As a Helm, I move the ship on the fly each segment, limited by current speed, Propulsion Surplus step-changes, the universal speed cap, and the `speed/3` min-straight rule, so acceleration and turning feel like a real vessel.
4. As a player, I assign crew from the reserve to stations and get a "weapon ready" reminder when loading completes, so automation runs without me.
5. As a Weapons officer, I fire loaded weapons with a command action; rate of fire is capped by weapons × loading × crew, not by the ground-game attack cap.
6. As a crewman, I watch hits land on random subsystem units, each hit also chipping Ship HP, so ships die before their stations do.
7. As a hero at a station, I take the hit's damage when it exceeds the ship-wide damage threshold, so manning a post is a risk/reward choice.
8. As a Captain, I spend Int-based command actions to redo a PC's last action or grant a tactical boost; low Int loses orders softly (red notification, no hard failure).
9. As a player, when my ship dies and my hero survives, the fight continues in the D&D VTT — the sim hands off cleanly.
10. As a player, I can undo/redo any action within a segment, with the random component pick recorded in the command log so undo restores the same outcome.
11. As an admin, I can open **Archfar's Shipyard** from the Lobby to build ships (view capability `can_view_ship_editor`, use capability `can_use_ship_editor` — both admin-only).

## Implementation Decisions

### Access capabilities (done — migration 059)

- `access_roles.can_view_ship_editor` and `access_roles.can_use_ship_editor` BOOLEAN NOT NULL DEFAULT false, seeded **true only for `admin`**, false for all other roles.
- `user_has_access` extended with `view_ship_editor` / `use_ship_editor` cases (mirrors migration 050).
- Client: `useProfile` `Access.canViewShipEditor` / `canUseShipEditor`; Lobby shows the **Archfar's Shipyard** button when `canViewShipEditor` (placeholder modal for now; `canUseShipEditor` will gate the future builder).

### Ship entity & schema (planned — future migrations)

- New tables: `ships` (id, name, class, ship_hp/max, damage_threshold, thrust, mass, speed, facing, hex, scenario_id, team), `ship_subsystems` (id, ship_id, kind, unit_index, hp/max, contributes-to), `ship_weapons` (id, ship_id, weapon template, crew_required, load_time, load_remaining, ready), `ship_crew` (id, ship_id, station, count, assigned), `ship_stations` (hero assignments per ship).
- Heroes join a ship through the existing attach-style mechanism extended to `attachedToShipId`.

### Future module file map (all spelljammer rules in their own files)

- `src/lib/shipMoveCost.ts` (pure): speed-state movement — hexes per Helm action at current speed, surplus-gated step changes, min-straight rule, facing reuse. Test file alongside.
- `src/lib/shipCombat.ts` (pure): weapon fire resolution, random component pick (seeded RNG), double-wound to Ship HP, ship-wide threshold spill, crits (targeted subsystem / 2× random), component destruction → performance recalc. Test file alongside.
- `src/lib/shipStats.ts` (pure): derived ship stats from live component list (propulsion, turning, firepower, integrity).
- `src/types/ship.ts` + `src/lib/shipMappers.ts`: ship types + Supabase row mapping (mirrors `templateMappers`).
- `src/hooks/useShipEngine.ts`: ship commands (HELM_MOVE, FIRE_WEAPON, MAN_STATION, ASSIGN_CREW, REPAIR, ENGINEER, CAPTAIN_COMMAND) with segment tick state, riding the command log so undo restores every delta incl. the random component pick.
- `src/components/ScenarioMap/ShipPanel.tsx`: ship stats, component list, station assignment, crew reserve, weapon readiness.
- `src/components/Shipyard/`: the ship builder (future; gated by `can_use_ship_editor`).

### Command log & undo

- Every ship action is a command with sub-steps (deltas for ship HP, subsystem unit HP, speed, facing, load counters, crew, hero HP), so undo restores all state.
- The **random component pick is recorded in the command** (like `unitCombat.ts` already records rolls) — undo/redo replay the identical outcome, never a new random draw.
- Undo granularity stays per-action within a segment.

### Soft enforcement

- Same philosophy as the ground game: spending beyond a budget or committing a station without crew shows a **confirm modal**; confirming deducts fully (may go negative) and pushes a **red notification**. Never hard-blocked (except GM-toggled settings).
- Captain's negative Int: **lost orders** are a soft failure — the action is cancelled with a red notification, not a rolled failure.

## Testing Decisions

Pure-function tests only, mirroring `unitCombat.test.ts` / `moveCost.test.ts` (seeded RNG, no async/DB/React):

1. **`shipMoveCost.test.ts`**: hexes-per-Helm-action at current speed; surplus-gated step changes (light vs heavy); min-straight rule (`speed/3`); speed cap 10 / overthrust 12; facing-turn costs; on-the-fly (no plotting) semantics.
2. **`shipCombat.test.ts`**: random component pick over the alive list (seeded, distribution sanity: 6 Sails/2 Rudder/2 Hull → ~60/20/20); destroyed components excluded; double-wound (unit HP and Ship HP both drop); ship-wide threshold spill to manning hero (under/over threshold); under-threshold absorption; crit targeted subsystem (Helm/Bridge protected) vs 2× random; Hull Core destruction → Ship HP max loss; Ship HP 0 → destroyed regardless of stations.
3. **`shipStats.test.ts`**: performance recalc after component destruction (sail loss −1 propulsion, rudder −1 turning, weapon unit loss, hull core integrity loss).
4. **Segment tick**: reload/repair counter decrements at segment end (space) / turn end (planet); ready-reminder message triggers.

Not tested (manual QA / integration-only): the sub-turn toggle propagation, station/crew UI, ship token rendering, Lobby shipyard button visibility, VTT handoff narration.

## Out of Scope

- **Boarding combat** — ships can come alongside and heroes board, but the fight is **handed off to a dedicated D&D VTT**; the sim never resolves hero-on-hero personal combat (nor hero-vs-crew on a deck grid).
- **Hero death on ship destruction** — heroes never auto-die; the sim ends its part and play continues in the VTT.
- **Ship builder** — the Archfar's Shipyard UI ships empty in v1 (button + placeholder modal); ship templates are authored via DB.
- **Parallel fronts** — land and space battles are separate scenarios, never simulated simultaneously.
- **Hard enforcement** — consistent with the ground game, spending is never hard-blocked.
- **Pre-plotted movement** — all ship movement is decided on the fly per segment.

## Further Notes

- Ships are hero-like: no retaliation, no morale, no rout, no formation economy — they never enter the ground-game 5-attack+retaliation cap; rate of fire is weapons × loading × crew.
- 50ft hexes are shared with the ground game; a 30ft ground unit moves ~0.6 hex/turn while a ship at Speed 10 crosses the board — the scale mismatch is accepted by design (ships are the fast layer).
- The `hexes before turn = speed / 3` min-straight rule interacts with the existing 1 MP per 60° turn model: ship turning is governed by the speed commitment instead of an MP charge.
- Migration 059 (`ship_editor_access`) is written and must be applied to the DB.
