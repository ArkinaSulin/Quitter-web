# 07 — Movement Economy

Two coordinated systems: **what a unit can reach** (geometry, terrain) and
**what a move costs** (MP/actions). Both live in pure libs and are shared by
the drag overlay, the executed move, tooltips, and tests.

## Resource model — units

- Units start each turn at **0 MP / 2 actions** (`turn_start_mp` /
  `actions_per_turn`).
- **1 action = 1 full MP pool** (`maxMP` = effective movement). MP is
  *materialized* when a move converts an action; a move's cost is spent from
  already-materialized MP first, and an action converts to a fresh full pool
  only when MP is exhausted (so leftover MP is never wasted).
- Functions in `src/packages/movement/lib/moveCost.ts` (all take `{movementPointsAvailable,
  actionsAvailable}` + `maxMP`):

  | Function | Meaning |
  |---|---|
  | `computeMoveBudget` | Total affordable MP = `floor(MP) + maxMP × max(1, actions)` (the extra pool at 0 actions lets an over-budget attempt trigger the confirm). |
  | `computeMovePool` | The **current move's** reach = a full pool when `MP ≤ 0 && actions ≥ 1`; else `min(pool, floor(MP))`. Drives the drag highlight — it shrinks as MP drains. |
  | `computeMoveCapacity` | True remaining = `floor(MP) + max(0, actions) × pool` (no fudge). Used to cap a host+hero combined move. |
  | `applyMoveCost(cost)` | Executed accounting: spend MP then convert whole pools; final MP = last pool's remainder; may go **negative** (soft enforcement). |
  | `applyMpSpend(spend)` | Single-MP spends (rotate/attach): when MP insufficient and an action remains, the action refills a full pool first. |
  | `isMoveAffordable` | `applyMoveCost(...).actionsAvailable ≥ 0`. |

**Worked example (unit, maxMP 3, 2 actions / 0 MP):**
`computeMoveBudget` = 0 + 3×2 = **6** MP of reach. Drag overlay (`computeMovePool`)
= one full pool = **3**. Move a path costing **4**: convert the first pool
(action 1) and 1 MP opens the second pool (action 2) → **MP 2, actions 0**.
Move costing **6**: exact → MP 0, actions 0. Move costing **7**: soft-over-budget
→ the confirm modal; on confirm `applyMoveCost` → MP = 2 (pool − remainder),
actions = −1, red message. End Turn resets.

## Resource model — heroes

- Heroes start each turn at **FULL effective MP + 5 actions**
  (`hero_actions_per_turn`). Their MP is *fractional* (`movement_points_available`
  NUMERIC since migration 060).
- Each converted action grants **`maxMP/5` MP**, rounded to 1 decimal
  (`heroMovePerAction`): maxMP 3 → 0.6/action; mounted 6 → 1.2. Fractions
  **carry** (0.6 → 1.2 → 1.8 …); display floors, storage keeps the decimal.
- `computeHeroMoveBudget` = `MP + max(0, actions) × per`.
  `applyHeroMoveCost(cost)`: spend materialized MP first, then convert
  `ceil(shortfall/per)` actions. `applyHeroMpSpend` = the same for single-MP
  spends. `computeHeroMovePool` drives the overlay (floors to payable whole
  hexes, capped at one full move; a <1 MP fraction with no actions pays nothing).
- **Hero attach** moves the hero into the host's hex, so it pays that hex's
  **entry cost** (`makeCostOfHex`: terrain/structure + climb — same as a move),
  always from the hero's **ground** pool (a same-level step, never flight). A
  shortfall converts actions at the ground rate; over-budget soft-confirms.
  **Detach** via drag-away is a normal move paying the destination hex (the
  leave-behind/fall paths enter no hex and stay free). **Swap** (front↔back on
  the host) is a reposition *within the same hex* — **free**, ground or air.

**Worked example (hero, maxMP 3, turn start = 3 MP + 5 actions):**
full 3-MP move → MP 0, actions 5. A further 1-MP step converts
`ceil(1/0.6) = 2` actions → MP = round(0 + 2×0.6 − 1) = **0.2**, actions 3.
That 0.2 MP carries (display 0). Over-budget attempts go through the same
soft confirm.

## Rotation

- Units: 60° turn costs **1 MP** (`applyMpSpend`); **free** for Scattered /
  Routed / free-move. Heroes never pay to rotate.
- A **180° about-turn** is one maneuver charged from settings: foot **1** MP,
  mounted **2** MP (`about_turn_cost_foot/mounted`), plus an organization-level
  drop of **1** (`about_turn_org_penalty`); free for Hero/Scattered/free-move.
  Mounted units in **Close Order cannot about-turn** at all.
- Rotation is its own `ROTATE` command; movement cost is distance-only.

## Formation changes

`src/packages/movement/lib/formationCost.ts`: a change costs a **flat fraction of the unit's
current effective movement pool** — `max(1, ceil(oldMax × 0.5))` (setting
`formation_change_cost_per_step`, default 0.5). Because the fraction ≤ 1 it
never costs more than one action and never less than 1 MP. The leftover MP then
**rescales proportionally** to the new max: `floor(leftover × newMax/oldMax)`,
clamped `[0, newMax]`.

Worked example (base move 3): Scattered (eff 4) → Open Order costs
`ceil(4×0.5)=2` MP; Open (eff 3) → Close = 2; Close (eff 2) → Phalanx = 1;
Phalanx (eff 1) → Scattered (any steps down) = 1. Free for heroes and under
free move; a Shield-Wall change is blocked while wielding a two-handed weapon.

An **airborne flyer** pays the change from its **fly pool** (`flyMax` = raw
`flySpeed`, and the pool is `flySpeedAvailable`) instead of ground MP — e.g. a
flyer at 5/8 FP with 0 ground MP can still change formation for 4 FP. An elevated
**non-flyer** (a unit climbing a wall) is airborne by elevation but still spends
**ground MP** (`usesFlyPool` = `isAirborne && canFly`). The context-menu cost
labels follow suit (`50% Max FP` / `1 FP` only for actual flyers).

## Reachable map (what you may drop on)

`computeReachableMap(unit, maxMP, occupied, threatHexes, costOfHex?,
allowBeyondBudget?)` — min-cost Dijkstra over `(hex, facing)` state:

- **White** (droppable): the full **front wedge** reachable without turning
  (front-arc BFS keeping facing, interior zig-zag included). Cost = cheapest
  entry path.
- **Grey** (never droppable): hexes reachable only by turning — a hint the
  unit must `ROTATE` first. Cost includes turns at 1 MP/60°.
- **Loose** units (Routed, Scattered, Hero) move any direction at 1 MP/hex —
  always white, no facing.
- **Threat hexes** are reachable destinations but never passed through;
  **occupied** hexes are never reachable.
- **Terrain**: `costOfHex` (painted MP cost, `0..9`) sets entry cost per hex —
  **0 = free**, 1 = clear, 2+ = difficult. Reach is capped by BOTH MP and
  **hex hops ≤ maxMP** so a 0-cost chain can't roam unbounded.
- `allowBeyondBudget` keeps hexes whose *cost* exceeds `maxMP` (still bounded
  by hops) — the executed move accepts them so soft enforcement can confirm.

### Zone of control (universal rule)

**ZoC and kill zone are the same thing.** Enemy **threat hexes** come from
`computeThreatHexes` (mapGeometry). For a **unit** the zone is:

- the **two front hexes** of its facing (matrix `stop_enemy_movement_arcs`),
  **same elevation only**; **and**
- for an **actually-airborne, formed, non-hero flyer**, its **own hex 1–10 ft
  below** (facing-independent) — but only while a hostile is *actually under it*
  (the overlay draws no empty flyer hex).

So the full exclusion set: **Hero, Scattered and Routed** never impose a ZoC
(nor does a hidden/attached/dead unit). Cross-elevation never applies —
`elevation === targetElevation` for the front-2. A fly-capable unit **standing
on a structure** (`elevation === surfaceAt(hex)`) is **grounded**, not airborne,
so it imposes no vertical ZoC. An **airborne flyer also projects the front-2 on
its own elevation** (air layer vs other flyers) in addition to the hex below.
Climbers/hangers (elevation > 0 but not flying) impose no vertical ZoC and their
front-2 only at their exact elevation (the wall top).

Threat is evaluated **per destination**: `computeThreatHexes` computes each
candidate hex at that hex's surface (a grounded mover stepping onto a 10-ft
structure is threatened by hostiles up there), or at the mover's flight
elevation when airborne. Occupied hexes are skipped at the destination surface.

**Movement rule — stop, not pass-through.** A threat hex is a destination a
unit may *stop* on but never move *through*; entering one ends the move. The
hex a unit is already on is not an entry, so a unit that begins inside a ZoC
(e.g. standing under a flyer) may **always leave** it — leaving scatters/pursues
as normal. (`computeReachableMap` gates the pass-through on `hops > 0`, i.e. a
move that has stepped onto a threat hex — the origin, and same-hex turns, stay
free.)

Every **alliance is hostile to every other** (friendly↔enemy, friendly↔neutral,
enemy↔neutral); same-alliance pairs (including neutral↔neutral) are not.

To disengage past a flyer overhead, `imposesZocOn` enforces the same vertical ZoC
(a formed, actually-airborne flyer only). **Movement never routs.**

**Threat hexes stop *entry*, not occupancy** (`07` rule): entering a hostile
threat hex ends the move — a unit may stop on one but never pass through it.
The unit's **own starting hex is not an entry**, so a unit that begins inside a
ZoC (e.g. standing under a flyer) can always move and turn out of it; leaving
scatters/pursues as normal. When a drop's destination is a threat hex, the MOVE
zeroes any leftover `movementPointsAvailable` (the mover may still act with
another action, but this pool is spent).

## Disengaging — scatter + pursue

The whole ZoC-danger layer is gated by `scenarios.zoc_pursuit_enabled` (default
ON). With it ON, leaving a hostile kill zone (`src/packages/morale/lib/zocDisengage.ts` →
`pursuitCandidates`; resolved by `performPursuits` in `useCombatActions`):

- The mover **drops to Scattered** if it is a formed, non-hero unit
  (`pursuitScatters`); heroes/loose are untouched, Routed stays Routed.
- **ONE pursuer** chases. Candidates are the melee-capable hostiles whose kill
  zone covered the origin but not the destination; they are ordered **attacker →
  most MaxMP → most available MP → random** and each rolls **`d10 <= AGR`** in
  turn; the first pass pursues. A candidate inside a hero's Commanding Presence
  is HELD unless that hero's `command_pursuit_permit` is true; a suppressed
  pursuit is announced in the log.
- The pursuer takes a **free 1-hex step** into the contact (vacated) hex and
  makes a **free melee attack resolved AT the contact hex** — regardless of how
  far the leaver fled. No retaliation; **once per unit per turn** (`pursuitUsed`,
  migrations 084/087/090), counted +1 toward the 5-attack cap. A rout-through
  makes the pursuer attack the friendly that let the pass (now Scattered). A
  pursuit's own move never provokes.
- Triggered from `completeMove` (normal move and the over-budget confirm);
  **charge-over overrun and free-move are exempt**; a routed retreat runs the
  same path (the router is already Routed → no scatter), and a router with **no
  legal retreat** is CORNERED — every eligible ZoC unit strikes it in place.
- **Setting OFF**: no scatter, no pursue, no opportunity attack; entering still
  spends MP, leaving just costs movement.

## Withdraw (ordered disengagement)

**Dragging a formed, non-hero unit one hex into either rear-arc hex is the
Withdraw** (`src/packages/movement/lib/withdraw.ts`): it keeps its facing for **2 actions** — the
ordered alternative to a scattering rout. The overlay paints legal rear hexes
**white/droppable** (`useOverlay`; just like a normal move) since no face change
is needed; on drop an **always-on confirm** states the cost before applying —
**skipped under `free_move`**, where a rear drag is just a free move (no prompt).
It
**never scatters and never provokes** a pursue; archer reactions still fire off
the MOVE. **Free under `free_move`**; short on actions it may go negative via
the same confirm (soft enforcement, shown red). The destination must be an empty,
in-bounds rear hex that is **NOT inside an enemy kill zone** (retreating into a
threat zone isn't a retreat). Heroes/Scattered/Routed are loose — no withdraw
(their rear hexes are ordinary move hexes). See `09`.

## Charge (movement-side)

`computeChargeReachable` — front-arc wedge, **no turning**, bounded by one
action's MP pool (`maxHexes`), occupied hexes block the lane, and a painted
cost > 1 hex cannot be entered or passed through (charges stay flat). Charge
full distance = `charge_full_distance` (2) hexes for the free double-damage
attack; distance < 2 → premature confirm. See `08-combat.md`.

## Who provides `maxMP`

Effective movement = `floor(movementPoints × formation.movement_multiplier)`
(`units/unitStats.computeEffectiveMovement`; Routed/Scattered ×1.5, Phalanx/Shield
Wall ×0.5, others ×1 — verify live `formations` rows). Effects (Haste/Slow)
adjust the `movementPoints` base (see `10`).

## Structural barriers (migration 099)

A structure's `mp_foot_in/out` / `mp_mounted_in/out` REPLACE the destination
hex/edge terrain cost (`_in` = outside→inside, `_out` = inside→outside; hex uses
`_in` only). A negative value is a hard block for that locomotion, bypassed by
free move and the DM. **Rule of thumb: any hex with MP cost 2+ will disable
charge** (`makeChargeBlockedEdge`). Movement evaluation pools every remaining
action as the MP budget while the hex-step cap stays at one pool ("Option 2", the
`hopCap` argument of `computeReachableMap`) — an expensive single step is
selectable without extending normal one-move reach. See `18` for the barriers.
