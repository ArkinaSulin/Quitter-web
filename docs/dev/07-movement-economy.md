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
- Functions in `src/lib/moveCost.ts` (all take `{movementPointsAvailable,
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
  `ceil(shortfall/per)` actions. `applyHeroMpSpend` = same for 1-MP spends
  (attach/detach/swap). `computeHeroMovePool` drives the overlay (floors to
  payable whole hexes, capped at one full move; a <1 MP fraction with no
  actions pays nothing).

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

`src/lib/formationCost.ts`: a change costs a **flat fraction of the unit's
current effective movement pool** — `max(1, ceil(oldMax × 0.5))` (setting
`formation_change_cost_per_step`, default 0.5). Because the fraction ≤ 1 it
never costs more than one action and never less than 1 MP. The leftover MP then
**rescales proportionally** to the new max: `floor(leftover × newMax/oldMax)`,
clamped `[0, newMax]`.

Worked example (base move 3): Scattered (eff 4) → Open Order costs
`ceil(4×0.5)=2` MP; Open (eff 3) → Close = 2; Close (eff 2) → Phalanx = 1;
Phalanx (eff 1) → Scattered (any steps down) = 1. Free for heroes and under
free move; a Shield-Wall change is blocked while wielding a two-handed weapon.

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

Enemy **threat hexes** (ZOC) come from `computeThreatHexes` (mapGeometry) via
the formations matrix `stop_enemy_movement_arcs` — Scattered/Routed/heroes
never block. **Movement never routs.**

## Charge (movement-side)

`computeChargeReachable` — front-arc wedge, **no turning**, bounded by one
action's MP pool (`maxHexes`), occupied hexes block the lane, and a painted
cost > 1 hex cannot be entered or passed through (charges stay flat). Charge
full distance = `charge_full_distance` (2) hexes for the free double-damage
attack; distance < 2 → premature confirm. See `08-combat.md`.

## Who provides `maxMP`

Effective movement = `floor(movementPoints × formation.movement_multiplier)`
(`unitStats.computeEffectiveMovement`; Routed/Scattered ×1.5, Phalanx/Shield
Wall ×0.5, others ×1 — verify live `formations` rows). Effects (Haste/Slow)
adjust the `movementPoints` base (see `10`).
