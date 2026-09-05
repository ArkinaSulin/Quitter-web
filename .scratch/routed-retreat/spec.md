Status: implemented (ScenarioMap orchestrator + `src/lib/routedRetreat.ts` + tests)

# Routed Retreat & Pursuit

Rules for what happens the moment a unit breaks and routs (combat, magic, or
reaction fire), including the mandatory follow-up pursuit.

## Rout (owner-decided retreat)

- When a unit routs it becomes `Routed` and the routed unit's **owner** gets a
  modal. The modal always appears (even with zero options) as the informational
  precursor to the rout / FREE pursue attack.
- Legal retreat hexes: **unoccupied** and **outside any enemy kill zone** (ZOC).
- Normal rout = **1 hex**, free (no MP/action).
- **Rout-through (2 hexes)** is only used when **no** adjacent hex is legal: the
  unit routs through **one** friendly unit in **Open Order or Scattered** to the
  empty, non-kill-zone hex beyond it.
  - Through **Open Order** → that friendly is **disrupted to Scattered**.
  - Through **Scattered** → that friendly is unaffected.
  - **Routed units never yield**: a rout cannot pass through another `Routed`
    friendly, even when it is the only neighbour. Ordered ranks (Close Order /
    Phalanx / Shield Wall) also block rout-through.
- If no legal rout exists at all, the unit stands (stays Routed).

## Pursuit (mandatory — player cannot decline)

- Candidate pursuer: an **adjacent hostile** whose effective speed (formation
  multiplier applied) is **greater than the routed unit's Routed-formation speed**
  AND that can **pay the MP cost** to enter the vacated hex.
- Selection order: **(1)** the attacker that caused the rout if eligible →
  **(2)** the fastest eligible adjacent hostile → **(3)** the one with the most
  `movementPointsAvailable` → **(4)** random (tie-break).
- On pursuit the pursuer **follows into the vacated hex** (pays MP), makes a
  mandatory **free attack**, and **drops one organization level**. The fast follow
  triggers **no reaction** (it happens immediately behind the routed unit).

### Who the pursuer attacks
- If the rout **disrupted** a friendly (rout-through an Open Order unit) → the
  pursuer attacks that **disrupted (now Scattered) friendly** with a full melee —
  it does NOT chase the routed unit.
- If the rout was a normal 1-hex rout (no disruption) → the pursuer strikes the
  **routed unit** (which cannot retaliate).
- If the rout only passed through a **Scattered** friendly (no disruption), the
  routed unit is behind an occupied hex → **no pursuit attack** (ranged may still
  apply if a pursuer has range).

## No legal rout → FREE pursue attack
- If the routed unit cannot move at all (actual movement = 0), the **attacker**
  makes a **FREE pursue attack** "as if it pursued": no speed or MP gate, attacker
  preferred, still subject to org −1. The message explicitly labels it a FREE
  pursue attack.

## UX
- Retreat modal: hover an option button → that hex is highlighted on the map
  (players read the map, not grid coordinates). The modal is **draggable** so it
  never covers the target hex.
- Messages report each stage and the reason: forced rout-through, disruption,
  rout destination, pursuer identity, FREE-attack notice, attack target, org −1.

## Files
- `src/lib/routedRetreat.ts` (pure: candidates, rout-through/disruption, routed
  blockers, diagnosis, pursuer selection) + `routedRetreat.test.ts`.
- `src/components/ScenarioMap/ScenarioMap.tsx` (`routFlowRef` orchestrator:
  modal, chained MOVE/FORMATION/pursuit commands; geometry resolved at the
  post-follow hex so melee never misfires as long-range).
- `src/components/ScenarioMap/routeUnit.ts` (ROUT payload carries the cause id so
  the attacker is preferred as pursuer).
