# 17 - AI Assist (Basic enemy brain)

> **Status: Basic rewrite shipped (2026-10-23).** The old battle-role/frontage/
> reserve planner was replaced with a small rule-based brain. Preview/Execute,
> per-unit opt-out, undo and the GM-only gates are unchanged. The Advanced AI
> project was cancelled; use the Basic brain only.

## What it is

A Scenario-Settings toggle (`scenarios.ai_assist_enabled`, migration 076) reveals
an **AI** tab. One further flag remains:

| Setting | Column | Meaning |
|---|---|---|
| **AI assist** | `ai_assist_enabled` | Master switch: shows the AI tab. |
| **Allow players to use AI assist** | `ai_assist_players` | Non-GM participants may use the tab during the active side's turn. |

The effective gate is
`ai_assist_enabled && (effectiveIsGM || ai_assist_players) && !controlsLocked`.
Replays and DM-offline lock the tab. Server-side `execute_command` already
permits the MOVE / ATTACK / ROTATE / FORMATION / CHARGE / ELEVATE / weapon
commands used by the executor.

The GM drops teams into an **AI control box**. Eligible units get a checkmark;
click a checked token to opt that unit out (grey badge). **Preview** runs the
pure planner and draws routes, attacks and independent target marks. **Execute**
replays the plot through the normal action path one command at a time, with
Pause / Step / Resume / Cancel and an **Undo Execute** macro.

AI assist is deliberately *assist*: the DM (or an allowed player) triggers
Preview/Execute, answers prompts, and presses End Turn.

**Off-grid tokens** (outside `gridRadius`) are not AI-eligible. An AI plan may
move a unit off-grid; from the next Preview onward it is out of play, cannot be
targeted or attack, and the AI will not control it. The DM can still recover it
manually.

## Files

| Concern | File |
|---|---|
| Public types + plan result | `src/packages/ai/lib/types.ts` |
| Board model, archetypes, pathing, safe destinations, ZoC facing | `src/packages/ai/lib/board.ts` |
| Independent target marks | `src/packages/ai/lib/marks.ts` |
| Planner + four doctrines | `src/packages/ai/lib/planner.ts` |
| Shared pure swoop validation | `src/packages/combat/lib/swoop.ts` |
| Panel (UI + Execute driver + undo macro) | `src/components/ScenarioMap/AiPanel.tsx` |
| Overlay types | `src/components/ScenarioMap/aiTypes.ts` |
| Canvas overlay (routes/marks) | `useCanvasDraw.ts` |
| Scenario wiring / access gates | `ScenarioMap.tsx` |
| One-shot Preview worker | `src/workers/aiPlanner.worker.ts` |
| Worker request/response types | `src/workers/aiPlanner.types.ts` |
| Columns | `supabase/migrations/076_ai_assist.sql`, `130_ai_assist_flags.sql` |

## Preview execution and performance

- **Preview runs in a one-shot Web Worker.** The main thread sends the `AiPlanContext`
  and an `admin_game_settings` snapshot (hydrated into the worker's settings cache),
  so movement/combat helpers use the same values as the UI. The full plot is
  computed off-thread; the canvas and Supabase realtime stay responsive.
- The worker returns the **complete plot** (no truncation/partial plot). The panel
  shows “AI thinking…” and disables Preview while it runs; Cancel/Reset, panel
  close and a new Preview terminate the worker immediately. Late results from a
  terminated worker are ignored.
- A **30-second watchdog** terminates a hung worker and shows an error; it is a
  safety net, not a partial-result mode.
- Planner optimizations (same rules): one maneuver list shared across
  engage/stage/progress; forward-only reach after pre-rotation; cached structure
  complexes, top-access routes and base reverse maps; reduced per-unit plan
  iterations.

## Eligibility (unchanged)

A unit is AI-controlled only when **all** hold:

- not deleted, not hidden, HP > 0;
- not a hero, not an attached hero, and not the host of an attached hero;
- not in the DM's per-unit opt-out set (cleared at each End Turn);
- its team is in the AI control box and its alliance equals the current turn
  alliance (free play never plots);
- `actionsAvailable >= 1`, leftover ground MP, or leftover **fly MP**. 

Routed units are eligible and flee. **Airborne flyers flee with the fly pool** at
their current altitude (they are not forced to land); ground units flee on the
ground, and flying mounts use the fly pool. The AI only attacks the adversarial
alliance (friendly ↔ enemy); fog is respected and hidden units never reveal.

## Basic rules

### Board scan

One snapshot per Preview. Each unit gets a cached ground distance map (real
terrain, walls, structures, doors, loose pass-through, org gates, fog). All
thresholds use the printed **`unit.movementPoints`**; move pools use the
formation-scaled effective max.

### Marks (independent per archetype)

Assigned before planning: **flying → ranged → melee (closest first) → mounted**.

| Archetype | Mark rule |
|---|---|
| Melee | closest reachable ground/structure/grounded flyer; **cap = free adjacent hexes some melee unit can reach (max 6)**; no overflow, so several units can surround a battleline-end target. |
| Ranged | closest hostile (including airborne); **no cap**. |
| Flying | closest hostile not already marked by another flyer; **1 flying mark**. |
| Mounted | closest reachable ground/grounded flyer that has a **non-mounted** friendly mark and no other mounted mark; falls back to its closest reachable target. |

Marks from one archetype never consume another's slots. A target marked by
archers/flying can still be marked and charged by a mounted unit. Overlay draws
per-type badges (e.g. `M2 A4 F1 C1`); marks reset each Preview.

### Routed targets (fallback only)

- While **any valid non-routed enemy exists**, routed enemies are ignored for
  marks, approach, attacks, ranged shots, charges, swoops and escape targeting.
- The unit keeps pursuing the non-routed pool even if the closest one is blocked
  or far.
- If **every** remaining enemy is routed, routed enemies become the active pool
  and are selected normally (closest, then lowest morale).
- Target ordering is **closest path/distance, then lowest morale**, then id.
- If a planned attack target routes mid-execution, the executor skips it and
  selects the next legal **non-routed** target. If none is legal, the attack is
  skipped — a routed unit is only attacked when no non-routed enemy exists.

### Routed escape

- Every archetype delegates a routed unit to the same escape plan.
- **Movement mode:** an airborne flyer (including a flying mount) uses the
  **fly** pool at its current altitude; a grounded unit/mount uses the ground
  pool. Remaining actions convert to fly MP exactly like normal flying.
- **Flee score:** maximize the distance to the **nearest** non-routed hostile
  first, then the sum of distances to all hostiles; subtract the move cost.
- **Overflight is a last resort:** ending on a hostile's hex, or crossing one on
  the path (excluding the starting hex), carries a large penalty. The unit only
  does it when no clean escape exists.
- **Fly pathing matches manual flight:** AI fly maneuvers ignore ground terrain
  costs and edge walls/barriers; air occupancy and threat/kill zones still apply.

### Destination safety / facing

- A mover never ends its advance on a hex where an **adjacent** non-target
  hostile would be in its flank/rear at the final facing. (Distant enemies never
  veto a move; only adjacent units can flank/rear-attack in melee.) If the marked
  target has no safe approach, the next valid target is tried (and the mark
  updates).
- **Adjacency is all six surrounding hexes** (including the front two ZoC
  hexes) and is detected geometrically, independent of the unit's current
  facing. An adjacent enemy **overrides the locked/further target**: the unit
  turns to face it, then attacks if it has an action. While an adjacent enemy
  exists, no far-travel/Open Order downgrade or formation-up approach runs.
- **No reposition after an attack.** Once a melee unit attacks, it holds the hex
  it attacked from (it may attack again with remaining actions, but never move
  away). A unit adjacent to an enemy it cannot legally attack or climb (wall,
  elevation, etc.) also holds and faces instead of walking away.
- A **not-fully-upgraded** unit still prioritizes formation-up, but after the
  last affordable change it uses leftover MP to turn and cover adjacent hostiles
  with its ZoC (no attack until fully upgraded).
- Facing has no artificial cap: formed units consider all six facings using the
  shortest rotation (at most three 60-degree steps). Loose units
  (Scattered/Routed/Hero) move omnidirectionally with free turns.
- Adjacent facing chooses: **min hostile ZoC sources in flank/rear → max
  hostiles in our front arc** (more enemies ZoC-locked) → cheapest rotation →
  current facing.
- A **fully upgraded** melee unit may step into a hostile ZoC to engage (a formed
  enemy line projects ZoC onto every attack hex). A unit that is **not fully
  upgraded** still never advances into a hostile ZoC; it stages outside and
  upgrades first.
- If the marked target has no free adjacent hex (all blocked by friendlies or
  terrain), the unit retargets through its candidate list, then stages at 2–3
  hexes, then takes the best progress move toward another target.
- Approach/stage/progress destinations are scored by **remaining path cost to
  the target** (reverse Dijkstra using the same movement rules), not straight-line
  distance. Detours around a battleline are followed; the unit does not veer past
  the target.
- The target is **locked for the activation**; the unit re-evaluates only when
  the locked target has no legal move left. This prevents mid-plan oscillation.
- **Escape fallback:** if a fully upgraded unit still has no useful action, it
  drops to **Scattered** (when available/affordable) and takes a **target-directed**
  loose move using the same remaining-path score. The old open-space wander is
  gone; detours are allowed, and the unit holds only when no route exists. Next
  activation the normal upgrade rule re-forms it to Open.
- Pass-through is used everywhere: an Open Order/Scattered/Routed mover may
  **traverse** another pass-eligible friendly hex, but never stop on it. Target
  path costs and candidate ordering exclude pass-through hexes as destinations,
  so a target whose only adjacent hexes are occupied by pass-through friendlies
  is correctly treated as not directly attackable.

### Structure-complex confinement (non-flyers only)

Melee, ranged and mounted AI units that start in a **structure complex** may not
leave it. Flyers are exempt.

- **Footprint (priority):** a unit on a hex structure is confined to the
  connected footprint of adjacent hex-structure tiles.
- **Enclosure:** a unit not on a hex structure but inside an area fully bounded
  by **edge structures** is confined to that region. Any edge structure counts
  as the perimeter, including open/broken doors and gates.
- A flood fill that reaches the map’s outer grid ring is not treated as an
  enclosure.
- Enforcement is a perimeter-aware `blockedEdge` wrapper used by every movement
  path (reach maps, distance maps, charge corridors, maneuvers). The unit can
  move freely inside; every inside/outside crossing is illegal.
- Routed non-flyers flee inside the perimeter; flyers (including flying mounts)
  flee through the air and are not confined.
- Confined melee/mounted units prefer enemies inside or on the perimeter; ranged
  units may still shoot outside but reposition only inside.


### Melee

1. Routed → flee.
2. **Not fully upgraded** (`current org < highest reachable org`): never attack.
   - distance > 3: move to a safe staging hex at 3 (fallback 2), outside ZoC;
   - distance ≤ 3 (including adjacent/ZoC-locked): hold and upgrade one org
     step, over as many activations as needed.
3. **Fully upgraded**:
   - Adjacent: face with the ZoC rule, attack the legal adjacent target with the
     **least morale**, and continue attacking while actions remain.
   - Higher structure target: `climbAttack`; a ladder/`ignore_climb` edge within
     2 hexes is a future refinement.
   - Airborne-only adjacency: ignore and re-mark the closest reachable ground
     target.
   - Not adjacent: `path > movementPoints × 2` and org > 1 → Open Order, then
     advance; `path < movementPoints` → face, advance to a safe adjacent hex,
     attack; otherwise advance one pool toward the target. Try every candidate
     in order (engage -> stage at 2-3 -> progress), so a blocked mark retargets
     instead of holding. Never hold when a legal advance exists.
   - Leftover MP advances toward the next target; a melee unit never voluntarily
     disengages.

### Climbing (ground units)

- A unit is **climbing/hanging** when `climbTo` is set, or when it is a non-flyer
  above its hex's surface. While climbing it may only move **up** toward the
  climb target or **down** to its own hex. Horizontal movement along the wall is
  invalid for the AI **and** for manual drag/drop.
- A unit that has finished the climb and stands on a real structure top
  (`elevation === surface`, `climbTo` cleared) moves normally along that top.
- Manual movement shows: *"{unit} cannot climb horizontally along the wall —
  climb up or down first."* The same guard runs in the AI executor (stale
  plans) and in `performMove`.
- A climbing/hanging unit is under a **hard lock until it routs**: it only
  climbs to its chosen top exit and lands. It does not move, change formation,
  retarget, escape, or attack anything except the weakest obstacle at that exit.
- Exit choice: free top hex **first**; otherwise the top obstacle with the
  lowest `computeThreatRating`. Once chosen, it is persisted via `climbTo`. If
  the exit becomes friendly-occupied, switch to the nearest free top exit.
- An enemy at the exit is attacked with `climbAttack` before landing; after the
  obstacle is defeated/moves, the climb continues and the unit lands.
- **Routed** hanging units drop down instead (fastest exit) and then flee; if the
  drop hex is occupied, climb down as a fallback.
- No attack or retaliation happens until the unit reaches the same level as the
  structure top.
- The planner uses the structure's real per-10-ft climb cost and **strict move
  capacity** (MP + remaining actions × pool; no soft-enforcement fudge). It
  requires at least one action and enough capacity for the next step; otherwise
  it holds. The AI executor repeats this check, so a stale plan can never push
  actions/MP below zero.
- **Never plan move + climb in the same activation** when the climb needs all
  actions. A unit that must move to the base does so this activation and climbs
  next activation.
- The wall may consume both actions per 10 ft; there is **no action reservation
  for an attack**. A 20-ft wall therefore takes two activations (10 ft each),
  attacking only once at the top.
- Once landed, the unit enters the **on-top hold-and-fight** doctrine below.

### Edge-wall climb-over (ground melee)

A non-mounted, non-flying melee unit may deliberately climb a solid edge wall
when its target is **ground-unreachable** (a courtyard/enclosure with no usable
gate). This is a planned traversal, never self-harm: the AI always chooses
**Climb over & climb down**, never Drop.

- Detection uses a **no-climb ground map** (closed edge walls block). An open or
  broken door/gate makes the target normally reachable, so the AI walks through
  instead of climbing.
- The near side must be standable and reachable **without** crossing a wall;
  the far side must be empty and lead to a melee-adjacent hex for the target.
  Elevated targets are excluded (those use structure-top access).
- If the unit is already at the wall base it plans `climbOver`; otherwise it
  moves to the base this activation and climbs next activation (never
  move + climb when the climb needs all actions).
- An adjacent enemy **across a wall** is not melee-reachable, so it does not
  suppress the wall objective.
- Mounted units, charging units and units hosting an attached hero never climb.
  A target with a normal ground/melee route is never wall-climbed.
- The wall height uses the real per-10-ft climb cost. A 20-ft wall can hang and
  finish on a later activation; descent is always a climb down. Falling damage
  only happens involuntarily (rout/drop) and reports troops lost.
- Executor step: `climbOver` → `performClimbOver`. Resuming a top-hanging climb
  charges only the **remaining** up steps, and the descent charges only
  `newElevation → destination surface` (not the full wall again).

### Structure-top access (melee)

A hostile standing on a structure top is a valid melee target, even when it is
inside a multi-hex complex. The takeover rule is **vacant tops first**:

- The planner resolves the target's connected hex-structure footprint and finds
  **free top hexes** (no unit standing on that surface).
- While a complex has any free top hex, melee units are assigned there **one per
  hex**, choosing the **quickest access** (`path to base + climb cost + landing`).
  These units get a **climb objective**, not a defender mark.
- Defenders are marked normally only after **all vacant tops are taken or
  unavailable** (then the normal dynamic defender cap applies).
- A vacant-objective unit plans **move to base → `climb` → land**. It ignores
  defenders until it is on top. If the assigned top becomes **enemy-occupied**
  during the climb, it `climbAttack`s that occupant and fights until it
  routs/defeats, then lands. A **friendly-occupied** top switches to the nearest
  other free top.
- If no free top exists, defender-marked units climb-attack the defender on its
  own top (no landing required) until it routs/defeats.
- **Melee only.** Mounted units never climb; flying units keep their direct
  swoop/10-ft attack.
- Once landed, the unit enters the **on-top hold-and-fight** doctrine below.

### On-top hold-and-fight

A non-flying unit standing on a structure/wall top or inside a structure complex
does not abandon it:

- If a legal attack exists from the current hex, attack.
  - Ranged keeps shooting from the wall; no reposition to max range.
  - Melee attacks adjacent top enemies.
- If no attack exists, hold and face the nearest approach.
- Movement is allowed only **within the same structure/complex** and only when it
  improves the fight (a shot/LoS lane, or an adjacent top enemy).
- Never move off the structure to chase a ground target below and never kite
  backward. Structure defenders do not use the Scattered escape fallback.
- Flying units are exempt; mounted units cannot climb.

### Ranged

- Archetype test: the **primary weapon (`weapons[0]`)** has `maxRange > 1`.
- Posture: any hostile within **6 hexes** → **Scattered**; otherwise **Open
  Order**; target in range and no hostile within 6 → **Close Order** before
  shooting. (6 keeps a short bow's range-7 shot in Close Order.)
- Face the target when in range but outside the firing arc.
- Shoot while actions remain (re-targeting if the target dies); otherwise
  reposition to exactly `maxRange` (back off if too close, advance if too far)
  preferring safe destinations. Never hold when a legal reposition exists.
- If the active weapon is not the primary ranged weapon, a free `weapon` step
  switches first.

### Flying

- Elevation is **free but movement-bound**: a move may climb at most
  **+10 ft per hex moved**; descending is free. There is no standalone free
  elevate step. A flyer climbs by moving with an `elevation` target.
- **Air superiority first.** If any airborne hostile exists, mark/target it
  before any ground target. Marks prefer airborne units when available.
- Against an airborne target:
  - use a ranged weapon if possible; fire immediately when already in range,
    otherwise close/retreat to max range and fire;
  - otherwise use **normal paid melee** after moving adjacent at the target's
    elevation (adjacent melee requires the same elevation);
  - there is **no air charge/swoop by design**;
  - if it cannot attack this activation, keep pursuing/closing on the air
    target and do not fall back to a ground swoop.
- Ground targets: mark the closest hostile not already flyer-marked, face it,
  then `charge` → `swoop` (the atomic dive + free melee charge attack). Swoop
  damage is **doubled**, like any charge.
- Scenarios gate this through the canonical `chargeStanceFor` rule: airborne,
  fly-capable, **at least 1 action**, and the scenario **Charge and Swoop**
  toggle on. There is no fly-point threshold; the charge consumes one action
  and converts it into a full fly pool added to current FP. Re-check the gate **after** a facing turn,
  because the turn may spend the action/fly points needed for the charge.
- A swoop may therefore be declared on the first or a later action; the planner
  picks the cheapest available candidate. One swoop per activation.
- After the swoop: retreat with remaining FP to **≥2 hexes from every hostile**
  and set elevation **20 ft** on that retreat move.
- No swoop available → fly toward the target, still ending ≥2 hexes away at
  20 ft when possible.

### Mounted

- Mark a **rim target** with a non-mounted friendly mark and no other mounted
  mark. A rim target has an adjacent hex that is empty and touches at most one
  other enemy. Interior targets are never marked or charged.
- Charge-start point: **any** safe hex within `pool + 1` from which a
  straight charge corridor (no turn **during** the move) reaches one of the
  target's **two rear-adjacent hexes** and can attack from the final front arc.
  The start itself does **not** need to be in the target's rear arc; turning
  before declaring the charge is allowed.
- **Safety is a hard gate:** every staged/path hex must be >=5 hexes from every
  **other** hostile, or >=3 when that hostile is inside the kill zone (ZoC) of
  any friendly unit. The intended charge target is excluded from this gate; its
  ring distance is governed by the start radius instead. A hostile in a friendly
  kill zone is treated as melee-locked.
- Each activation scans all rim targets. If a legal charge exists now, take it;
  otherwise choose the **closest valid charge-start point** by actual path cost.
  If it is not reachable this activation, pathfind toward it over multiple turns
  (within the start radius, never stepping into hostile ZoC). Intermediate hexes
  do not need to be in the rear arc.
- If already at a valid charge-start point, hold. Otherwise do not hold merely
  because the current hex is safe; circle/path toward the start. If no safe
  route exists, choose the reachable hex with the largest safety margin.
- Charge only when the canonical `chargeStanceFor` gate allows it
  (`canCharge`, a charge-capable formation, **at least 1 action**, scenario
  **Charge and Swoop** on), and:
  - the charge consumes one action and converts it into a full ground MP pool
    added to current MP;
  - the post-turn state can still enter the charge and pay for the charge move;
  - the charge is at least `charge_full_distance` (2) hexes;
  - the target is engaged by a friendly;
  - the landing is one of the target's **rear-adjacent**, no flank fallback;
  - the landing hex is outside hostile ZoC and on the formation's outer edge
    (empty, touching at most one other enemy);
  - the target is in the charger's **front melee arc from the landing hex**
    with the final facing.
- The charge may be the **first or a later action**: try the current facing, then
  rotations. If a turn is needed, take it and charge only when the remaining
  MP/action still covers the move.
- No normal melee fallback. If no legal charge exists, stage instead.
- End the staging/route move with **face changes** toward the validated next-turn
  charge lane. Prefer a no-turn charge next activation; only choose a
  destination that leaves enough MP/action for those end turns.
- After the charge attack: remaining action/MP disengages to the safest hex
  (same 5/3 safety thresholds), then upgrades to the highest affordable org
  formation. One charge per activation.
- If already at a valid charge-start point and lined up: hold.

### Multiple actions

Every doctrine spends as many actions/MP/FP as useful: melee and ranged attack
twice when they have two actions. Mounted and flying charges may use the first or
a later action, but at most **one charge/swoop per activation**; remaining
resources go to disengage/evasion.

## Executor steps

`move | turn | formation | attack` remain. Added:

| Step | Executor |
|---|---|---|
| `climbAttack` | `performClimbAttack` |
| `climb` | `handleClimbMove` (climb into a free top gap, no attack) |
| `drop` | `performDescentDrop` (routed hanging units drop down) |
| `charge` | `useGameEngine.charge` |
| `swoop` | `performSwoopDrop` (atomic charge-move + dive + free attack) |
| `chargeEnd` | `performChargeEnd` |
| `weapon` | `selectWeapon` |
| `move.elevation` | passed through `performMove` (fly climb/descent) |

The fly pool is selected by origin/end elevation in the executor; move
validation accounts for the air slot and real terrain/walls/structures.

## Access / display

- DM/effective GM sees all marks; players see their own team; DM in player mode
  is a player.
- No role overlay setting in Basic. Marks are part of the preview.
- No migration was added by the Basic rewrite.

## Tests

`src/packages/ai/tests/planner.test.ts` covers gates, legal targets, independent
marks/caps (including the dynamic melee cap up to 6), melee upgrade priority,
multi-attack, ranged 6-hex posture and Close-Order short-bow shots, melee
staging, ZoC engagement by fully upgraded melee, geometric adjacency (all six
hexes), formation-up leftover-MP facing, climb commitment and 20-ft sequencing,
the hard hanging lock (free top first, weakest top obstacle, routed drop),
structure-top gap access and free-gap climbs, on-top hold-and-fight, routed
target fallback and mid-execution retargeting, adjacency-only flank safety,
full facing search (180-degree turns), Open-Order pass-through, stop-aware
target costs, structure-complex confinement (footprint, enclosed courtyard,
flyer exemption),
and hardened mounted charge / flying swoop
gates (scenario toggle, `canCharge`, 1+ action; no fly-point threshold), with
turn-then-charge revalidation and one charge/swoop per activation.
Run `npm run check` (tsc, vitest, depcruise, build) and
`npm run lint:boundaries`.
