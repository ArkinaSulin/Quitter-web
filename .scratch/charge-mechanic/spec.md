Status: done

# Charge! Mechanic

## Problem Statement

Units with the `canCharge` flag have no way to use their momentum in combat. The charge should let a unit rush forward in a straight front-arc wedge, deliver a devastating free attack, and pay a cost (disorganization) for the privilege.

## Solution

A `canCharge` unit gets a **Charge!** command in its context menu (under Rotate). Charge is a movement + free-attack action with a disorganization penalty:

- **Prerequisite**: `canCharge`, not Scattered/Routed, `actionsAvailable >= 1`. Charge! itself does **not** deduct action/MP — they're consumed normally during the subsequent charge move.
- **Charge wedge** (`computeChargeReachable` in `moveCost.ts`): a front-arc BFS, no turning, bounded by the unit's one-action MP pool (`maxHexes = effectiveMax`). Each step moves into one of the two front-arc hexes; occupied hexes block the lane. Geometry: 1 step → 2 hexes, 2 → 3, 3 → 4, etc.
- **Charge state** (`isCharging`, `chargeDistance` on the unit, persisted via migration 020):
  - While charging, **Rotate and Formation change are locked** (context menu + keyboard) until the free attack resolves.
  - Drag overlay shows the wedge: **cost-1 hexes amber** (the charge route — stopping here is a premature charge), **cost 2+ hexes white** (full charge landing, unless occupied).
  - Each charge move increments `chargeDistance` by the hexes moved (chained CHARGE sub-step, undoable).
- **Free attack**: after a **full charge** (moved ≥ 2 hexes), dragging the unit onto an adjacent enemy in its front arc delivers a **free attack** (no action cost) with **double damage** — the existing `isCharging` doubling in `executeAttacks` (unitCombat.ts) is now threaded through `resolveCombatSequence`.
- **Premature charge** (`chargeDistance < 2`): an amber confirm modal — "attack normally instead? (costs 1 action)". Yes = normal attack (action deducted, no double damage); No = cancel, charge continues.
- **Disorganization**: immediately after any charge-resolving attack the unit **drops one organization level** (`nextLowerFormation` in `formationCost.ts`: Phalanx/Shield Wall → Close Order → Open Order → Scattered; floor is Scattered, never Routed). At **end turn**, a still-charging unit with an unused free attack **forfeits** — same org drop + charge cleared.
- **Threat**: a charging unit's `computeThreatRating` is **doubled** while charging (visible in the tooltip as `X.XX (2× charging)`; flows into enemy morale threat and AGR).

## User Stories

1. As a player, I want my `canCharge` unit to rush forward in a straight front-arc wedge, so that momentum is rewarded.
2. As a player, I want a full charge (≥2 hexes) to deliver a free double-damage attack, so that charging into contact is devastating.
3. As a player, I want to be warned if I attack before completing the charge, so that I don't accidentally lose the free attack.
4. As a player, I want the unit to drop one organization level after a charge, so that there's a real cost to the maneuver.
5. As a player, I want rotate/formation locked while charging, so the charge is committed once started.
6. As a player, I want a charging unit to be visibly more threatening, so that its momentum is readable on the map.

## Implementation Decisions

- **`moveCost.ts`**: `computeChargeReachable(unit, occupied, maxHexes)` → `Map<"q,r", cost>` front-arc BFS wedge.
- **`formationCost.ts`**: `nextLowerFormation(currentFormation)` → next-lower formation or null at the floor.
- **`unitCombat.ts`**: `resolveCombatSequence(..., isCharging = false)` threads the existing double-damage flag to the attacker's attacks (both first strike and retaliation).
- **`useGameEngine.ts`**: `charge(unit)` sets `isCharging`/`chargeDistance` only; `endTurn` applies the forfeit org drop + clears charge for the ending group's still-charging units.
- **`ScenarioMap.tsx`**: wedge overlay (amber/white), charge move validation + `chargeDistance` increment, charge attack path (`performAttack(..., { isCharging: true })`), premature modal, `performChargeEnd` (org drop + unlock).
- **`ContextMenu.tsx`**: Charge! entry (amber, under Rotate); Rotate + Formation disabled while `isCharging`.
- **`UnitTooltip.tsx`**: Threat row shows the doubled value with `(2× charging)`.

## Migration 020

```sql
ALTER TABLE units ADD COLUMN IF NOT EXISTS is_charging BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE units ADD COLUMN IF NOT EXISTS charge_distance INT NOT NULL DEFAULT 0;
```

## Testing Decisions

Pure functions tested: `computeChargeReachable` (wedge fan-out, occupied blocking, maxHexes cap), `nextLowerFormation` (chain descent, floor), `computeThreatRating` doubling while charging. Combat double-damage path relies on the existing `isCharging` logic already in `executeAttacks` (now wired through `resolveCombatSequence`).

## Further Notes

- Charge moves consume MP/actions **normally** (`applyMoveCost`) — the charge only restricts *where* the unit may move (the wedge), not how movement is paid.
- The 2× threat also raises the AGR penalty for units *facing* the charger and raises the charger's morale threat on enemies — an intentional side effect of a charging unit's momentum.
