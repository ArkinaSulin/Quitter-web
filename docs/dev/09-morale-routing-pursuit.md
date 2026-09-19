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
                + heroBoost
```

- **Wounds**: `−floor((1 − currentUnitHp/maxUnitHp) × wounds_morale_factor)`
  (factor 10 → 0…−10).
- **Isolation**: −1 (default) when no same-alliance unit is adjacent
  (`calcIsolation`).
- **Threats**: the normalized kill-zone sum above (subtracted).
- **Formation morale**: from the `formations` row (data-driven).
- **Hero aura** (`heroBoost`, gated by `scenarios.hero_morale_boost_enabled`):
  the strongest single HERO of the same alliance within the hero's hex + 6
  neighbours (7 hexes). A hero carries a `morale_boost` value `n` = **Commanding
  Presence**; while `heroic_inspiration_active` (set by a melee attack — a
  stand-alone hero, or a front-attached hero whose host attacks and takes the
  hero into the volley; cleared at the hero's next turn start) the aura upgrades
  to **Heroic Inspiration `n+1`**
  (even from `n=0`). Non-heroes are inert, the hero does not inspire itself, and
  several heroes do not stack (max). See `calcMoraleBoost`.

`shouldRout(unit, …)`: routing is consulted **only after an attack** (combat
or spell). It routs when `effectiveMorale ≤ 0` — subject to `ignoreMoraleChecks`
(fearless/undead) which never rout. **Movement never routs by itself.**

## Rout & cascade

- The attacker's / spell's damage lands → each damaged unit runs
  `shouldRout`. A broken unit is set to `currentFormation = 'Routed'` as its
  own **chained ROUT** command. Units *adjacent* to a routing unit also check
  (cascade), each a chained ROUT — one undo unwinds the whole episode.
- Routed units: move any direction (loose, 1 MP/hex), cannot attack or cast,
  cannot be in a kill zone, and are +2 AC-vulnerable (shield dropped).
- **Rally** (context menu, non-fearless units/heroes): while Routed and with
  positive effective morale and no *visible* hostile adjacent, the unit returns
  to **Scattered** (heroes: **Hero**) and spends the rest of its turn (0 actions,
  0 MP). The normal formation picker is hidden while Routed, so Rally is the only
  way out. Prereqs live in `src/lib/rally.ts` (`canRally`); the command is
  `useGameEngine.rallyUnit`.

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

## Pursuit (zone of control)

Gated by `scenarios.zoc_pursuit_enabled` (default ON). A unit that **leaves a
hostile kill zone** — a rout retreat, a voluntary move, anything — is punished by
`performPursuits` (`useCombatActions`), shared with the routine disengage path
(see `07`/`08`):

- The mover **drops to Scattered** if it is a formed non-hero (`pursuitScatters`);
  a Routed unit stays Routed (so a rout retreat scatters nothing).
- **One pursuer**, chosen from the melee-capable hostiles whose kill zone was left
  (`pursuitCandidates`): ordered **attacker who caused the rout → most MaxMP →
  most available MP → random**, each rolling **`d10 <= AGR`** until one passes. A
  candidate inside a hero's Commanding Presence is held unless that hero's
  `command_pursuit_permit` is true. If a chase is suppressed by a hero, the log
  says so. `src/lib/pursuit.ts`. A failed candidate **does not move** — it yields
  the chance to the next in order; the one that passes **always** attacks (the
  strike does not re-roll AGR — see `08`).
- The pursuer takes a **free 1-hex step** into the contact hex and makes a **free
  melee attack resolved at the contact hex**, regardless of how far the router
  fled; **once per turn** (`pursuitUsed`, migrations 084/087/090), counts +1 to
  the attack cap. A **rout-through** makes the pursuer strike the friendly that
  allowed the pass (now Scattered) instead of the router.
- A routed unit with **no legal retreat** is CORNERED: every eligible ZoC unit
  strikes it in place (once each per turn).
- The rout → retreat → rout-through/disruption → pursue episode lands as one
  chained command group, undoable in one step.

No reaction / morale-cascade special-casing: the pursue is a normal melee attack
(the router does not retaliate).
