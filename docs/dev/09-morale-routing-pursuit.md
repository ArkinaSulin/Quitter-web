# 09 — Morale, Routing & Pursuit

Morale decides when a unit breaks; routing + pursuit decide what happens then.
Pure logic: `src/lib/unitMorale.ts`, `src/lib/routedRetreat.ts`. The rout flow
(modal, retreat, pursuit commands) is orchestrated in the ScenarioMap layer.

## The rout flag

`currentFormation === 'Routed'` is the **single source of truth** — there is no
separate routing flag (migration 061 dropped `is_routing`). `isUnitRouted(unit)`
is the one check everyone uses.

## Threat rating (a unit's intrinsic scariness)

`computeThreatRating(unit)` = three additive components, no cap:

| Component | Formula |
|---|---|
| Level | band setting `threat_increment_level` (defaults: 19+→6, 13+→5, 8+→4, 5+→3, 3+→2, 2+→1, 0→0) |
| Size | `(sizeCategory / 100)²` (intentionally not a setting) |
| Troops | band `threat_increment_troop_count` (defaults: 50+→4, 20+→3, 10+→2, 5+→1, 0→0) |

Examples: L3/Medium/80 troops → 2 + 1 + 3 = **6**. L5/Medium/50 → 3+1+4 = **8**.
A lone hero (troop 1) gets its level + size² + 0.

## Who pressures you: kill zones, not adjacency

A unit imposes threat on an enemy **only while that enemy stands in its kill
zone** — the two hexes in front of its facing (`isInKillZone`). Formations
without a kill zone (Scattered, Routed) never impose threat. Routing units
never impose threat. Merely adjacent ≠ threatening.

`calcEnemyThreats(unit, …)`: sum the threat ratings of every hostile whose
kill zone contains you, then **normalize by your own**: `total = round(sum /
myThreat)`. A goblin beside a dragon feels its full rating; the dragon barely
notices the goblin. The tooltip shows the formula as
`-N = (front/side sum + rear sum) ÷ myThreat`.

## Effective morale

```
effectiveMorale = baseMorale + currentMoraleModifier
                + wounds + (isolated ? −isolation_penalty : 0) − killZoneThreats
                + formation.morale_modifier
```

- **Wounds**: `−floor((1 − currentUnitHp/maxUnitHp) × wounds_morale_factor)`
  (factor 10 → 0…−10).
- **Isolation**: −1 (default) when no same-alliance unit is adjacent
  (`calcIsolation`).
- **Threats**: the normalized kill-zone sum above (subtracted).
- **Formation morale**: from the `formations` row (data-driven).

`shouldRout(unit, …)`: routing is consulted **only after an attack** (combat
or spell). It routs when `effectiveMorale ≤ 0` — subject to `ignoreMoraleChecks`
(fearless/undead) which never rout. **Movement never routs by itself.**

## Rout & cascade

- The attacker's / spell's damage lands → each damaged unit runs
  `shouldRout`. A broken unit is set to `currentFormation = 'Routed'` as its
  own **chained ROUT** command. Units *adjacent* to a routing unit also check
  (cascade), each a chained ROUT — one undo unwinds the whole episode.
- Routed units: move any direction (loose, 1 MP/hex), cannot attack or cast,
  cannot be in a kill zone, and are +2 AC-vulnerable (shield dropped). They may
  **rally** via a formation change when their effective morale is > 0 (clears
  Routed).

## Retreat (owner-decided)

When a unit routs the owner is shown the retreat card (draggable; hexes
highlight on hover). Logic in `routedRetreat.ts`:

- Legal single-hex retreat candidates: **empty** hexes **outside any enemy kill
  zone**.
- One legal → auto-rout there. Several → owner picks. None → consider
  **rout-through**: run 2 hexes through one adjacent friendly in Open Order or
  Scattered (never through other **Routed** units — two crowds don't step
  aside — nor through ordered Close/Phalanx/Shield-Wall ranks). Passing through
  an Open Order friendly **disrupts it to Scattered**; Scattered costs nothing.
- No legal rout at all → the unit stands (still Routed). `retreatDiagnosis`
  returns structured reasons for the modal ("every adjacent friendly is
  routing/ordered…").

## Pursuit (mandatory, cannot be declined)

Eligibility for an adjacent hostile, all three (`choosePursuer`):

1. the **vacated hex is reachable in one droppable move** from its facing,
2. its effective **MaxMP ≥ the routed unit's effective routing MaxMP** (the Routed
   formation's ×1.5 is already applied to the routed unit, so equal effective
   speed is enough to pursue),
3. it **can pay the entry MP**.

Preference: the **attacker** who caused the rout (when eligible) → the fastest
eligible → the most MP → random tie-break. The pursuer follows into the vacated
hex (pays 1 MP), attacks (fast follow = **no reaction**), and **drops one
organization level**. When the rout disrupted a friendly Open Order unit, the
pursuer attacks **that scattered friendly** instead of the routed unit (it's
behind an occupied hex); a pass-through of a Scattered friendly with no
disruption yields **no pursuit attack**. When the routed unit couldn't move at
all, the attacker makes a labeled **FREE pursue attack** (no speed/MP gate,
org −1 still applies). The whole episode (rout → retreat → rout-through/
disruption → pursuit move → pursuit attack) lands as one chained command
group, undoable in one step.
