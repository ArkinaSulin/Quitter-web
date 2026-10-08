# 09 — Morale, Routing & Pursuit

Morale decides when a unit breaks; routing + pursuit decide what happens then.
Pure logic: `src/packages/morale/lib/unitMorale.ts`, `src/packages/morale/lib/routedRetreat.ts`. The rout flow
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

A **formed** unit imposes threat on an enemy **only while that enemy stands in
its kill zone** (one unified predicate with the movement ZoC, `isInKillZone`):
the **two front hexes at the same elevation**, plus — for an **actually-airborne,
formed flyer** — its **own hex 1–10 ft below** (facing-independent, and only
while a hostile is under it). Formations without a kill zone (Routed) impose no
*kill zone*; neither do hidden/attached/dead units. Cross-elevation never applies
for the front-2. Merely adjacent ≠ threatening. Full rule:
`07` "Zone of control (universal rule)".

**Loose units (heroes and Scattered) threaten their attack footprint** instead of
a facing kill zone — **all six adjacent hexes at the same elevation AND their own
hex within 10 ft (up or down)** (the same shape as `isMeleeReachable`). This is
**threat only** — a loose unit never imposes a ZoC. Both are **halved**
(`exertedThreatRating`): a lone hero (`heroThreatAgainst`) and a Scattered unit
alike. A hero of **larger than Large size** (`sizeCategory > 200`) ignores the
halving and exerts full. An **attached** hero uses its **host's footprint**: a
front-attached hero on a normal unit threatens only through that host's kill
zone, while a **rider on a hero mount** uses the mount's footprint, so the
**mount + rider count together** (each once). A **protected (back-attached)**
hero exerts no threat at all. The tooltip Threat row notes the halving as
`(halved)`.

`calcEnemyThreats(unit, …, formation)`: sum the threat ratings of every hostile
whose **kill zone** (formed) or **loose footprint** (hero/Scattered) contains you,
then **normalize by your own**: `total = round(sum / myThreat)`. A goblin beside
a dragon feels its full rating; the dragon barely notices the goblin. The tooltip
shows the formula as `-N = (sum threat) ÷ myThreat`.

**Directional multiplier (rear ×2):** each contributing threat is scaled by the
arc the hostile occupies relative to **your** facing, read from your formation's
`threat_arcs` (×1) / `double_threat_arcs` (×2) via `getThreatMode`. Normal
formations therefore double threat coming from the **two rear hexes**; Scattered
/Hero are uniform (all arcs ×1), Routed doubles everywhere. The same multiplier
applies to hero threat. The `threat_arcs` / `double_threat_arcs` columns are
data-driven, so custom formation rows can differ.

## Effective morale

```
effectiveMorale = baseMorale + currentMoraleModifier
                + wounds + (isolated ? −isolation_penalty : 0) − killZoneThreats
                + formation.morale_modifier
                + heroBoost
```

- **Wounds**: `−floor((1 − currentUnitHp/maxUnitHp) × wounds_morale_factor)`
  (factor 10 → 0…−10).
- **Isolation**: −1 (default) when no same-alliance unit is within the 8-hex
  adjacency footprint — the six adjacent hexes **at the same elevation** + the
  own hex ≤10 ft up/down (`calcIsolation` via `withinAdjacencyFootprint`).
- **Threats**: the normalized kill-zone sum above (subtracted).
- **Formation morale**: from the `formations` row (data-driven).
- **Hero aura** (`heroBoost`, gated by `scenarios.hero_morale_boost_enabled`):
  the strongest single HERO of the same alliance within the hero's **8-hex
  footprint** (6 adjacent same-elevation + own hex ≤10 ft up/down). A hero
  carries a `morale_boost` value `n` = **Commanding Presence**; while
  `heroic_inspiration_active` (set by a melee attack — a stand-alone hero, or a
  front-attached hero whose host attacks and takes the hero into the volley;
  cleared at the hero's next turn start) the aura upgrades to **Heroic
  Inspiration `n+1`** (even from `n=0`). Non-heroes are inert, the hero does not
  inspire itself, and several heroes do not stack (max). The same footprint gates
  the heroic **capacity bonus** (`heroicCapacityBonus`). See `calcMoraleBoost`.

`shouldRout(unit, …)`: routing is consulted **only after an attack** (combat
or spell). It routs when `effectiveMorale ≤ 0` — subject to `ignoreMoraleChecks`
(fearless/undead) which never rout. **Movement never routs by itself.**

A fearless unit can **never enter the `Routed` formation** at all (not just via
morale): `routeUnit` omits the formation change for fearless carriers (a downed
fearless hero keeps its own formation and renders as down from 0 HP), and the GM
paths refuse it too (`setRouting`, the context-menu "Rout Unit", and the unit
editor's formation picker).

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
  way out. Prereqs live in `src/packages/morale/lib/rally.ts` (`canRally`); the command is
  `useGameEngine.rallyUnit`.

## Retreat (deterministic path)

When a unit routs, `routRetreatPath` (`morale/routedRetreat.ts`) computes its
retreat deterministically and the owner is shown an **informational** card ("X is
routing", the destination). It walks **away** from the threat, pushing through
friendly org ≤ 1 units:

- The "away" axis = away from the **attacker** → else away from the **nearest
  hostile** → else away from the **hostile mass** (the neighbour maximising total
  distance to all hostiles) → else opposite the unit's facing.
- Each hop, neighbours are ordered relative to that axis (away = **4**; rear
  flanks **3/5**; hostile-side flanks **2/6**):
  1. **4** if empty + outside any enemy kill zone;
  2. **3 or 5** (prefer the one **not adjacent to a hostile**; random tie);
  3. else **push through** a friendly org ≤ 1 (an **Open Order** unit is disrupted
     to **Scattered**; Scattered/Routed/heroes pass freely) — then repeat from the
     new hex, **unbounded** until a gap;
  4. else **2 or 6** (fewest hostiles adjacent).
- **Blocked** = a hostile unit, an enemy kill zone, or a friendly org ≥ 2
  (Close Order+). Routed friendlies **do** yield (they are org 0). No legal route →
  the unit stands (still Routed) and faces a free pursue.

Part A of the same rule applies to **normal movement**: a pass-eligible unit
(Open Order / Scattered / Routed / hero ≤ Large) may move THROUGH another
pass-eligible friendly — never stacking. See `07` "Friendly pass-through".

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
  `command_pursuit_permit` is true. `src/packages/morale/lib/pursuit.ts`. A failed candidate
  **does not move** — it yields the chance to the next in order; the one that
  passes **always** attacks (the strike does not re-roll AGR — see `08`). Each
  roll is logged: `X passes AGR (3 ≤ 6) and pursues Y` / `X AGR failed (7 > 6) —
  does not pursue` (and a "held in line by … Commanding Presence" line when a hero
  suppresses a chase).
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
