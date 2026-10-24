# 17 - AI Assist (Basic enemy brain)

> **Status: Basic rewrite shipped (2026-10-23).** The old battle-role/frontage/
> reserve planner was replaced with a small rule-based brain. Preview/Execute,
> per-unit opt-out, undo and the GM-only gates are unchanged. **Advanced AI is
> paused**; its scenario column is kept for a later rebuild on top of Basic.

## What it is

A Scenario-Settings toggle (`scenarios.ai_assist_enabled`, migration 076) reveals
an **AI** tab. Two further flags remain:

| Setting | Column | Meaning |
|---|---|---|
| **AI assist** | `ai_assist_enabled` | Master switch: shows the AI tab. |
| **Allow players to use AI assist** | `ai_assist_players` | Non-GM participants may use the tab during the active side's turn. |
| **Advanced AI** | `ai_assist_advanced` | **Paused.** Hidden from the UI; kept for the future rebuild. |

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
| Columns | `supabase/migrations/076_ai_assist.sql`, `130_ai_assist_flags.sql` |

## Eligibility (unchanged)

A unit is AI-controlled only when **all** hold:

- not deleted, not hidden, HP > 0;
- not a hero, not an attached hero, and not the host of an attached hero;
- not in the DM's per-unit opt-out set (cleared at each End Turn);
- its team is in the AI control box and its alliance equals the current turn
  alliance (free play never plots);
- `actionsAvailable >= 1` or leftover MP.

Routed units are eligible and flee. The AI only attacks the adversarial alliance
(friendly ↔ enemy); fog is respected and hidden units never reveal.

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
| Melee | closest reachable ground/structure/grounded flyer; **2 melee marks** per target; overflow only when every candidate already has 2. |
| Ranged | closest hostile (including airborne); **no cap**. |
| Flying | closest hostile not already marked by another flyer; **1 flying mark**. |
| Mounted | closest reachable ground/grounded flyer that has a **non-mounted** friendly mark and no other mounted mark; falls back to its closest reachable target. |

Marks from one archetype never consume another's slots. A target marked by
archers/flying can still be marked and charged by a mounted unit. Overlay draws
per-type badges (e.g. `M2 A4 F1 C1`); marks reset each Preview.

### Destination safety / facing

- A mover never ends its advance on a hex where any non-target hostile would be
  in its flank/rear at the final facing. If the marked target has no safe
  approach, the next valid target is tried (and the mark updates).
- Adjacent facing chooses: **min hostile ZoC sources in flank/rear → max
  hostiles in our front arc** (more enemies ZoC-locked) → cheapest rotation →
  current facing.
- A **fully upgraded** melee unit may step into a hostile ZoC to engage (a formed
  enemy line projects ZoC onto every attack hex). A unit that is **not fully
  upgraded** still never advances into a hostile ZoC; it stages outside and
  upgrades first.
- If the marked target has no free adjacent hex (all blocked by friendlies or
  terrain), the unit retargets through its candidate list, then stages at 2–3
  hexes, then takes the best progress move toward another target. It only holds
  when no legal move exists.
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
- Routed non-flyers flee inside the perimeter.
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
- Mark the closest hostile not already flyer-marked. Face it, then
  `charge` → `swoop` (the atomic dive + free melee attack).
- Scenarios gate this through the canonical `chargeStanceFor` rule: airborne,
  fly-capable, **flySpeedAvailable > 2**, 2+ actions, and the scenario
  **Charge and Swoop** toggle on. A flyer with no materialized fly points simply
  flies this activation instead of swooping.
- After each swoop: retreat with remaining FP to **≥2 hexes from every hostile**
  and set elevation **20 ft** on that retreat move. Repeat `charge` → `swoop`
  if the canonical gate still allows it.
- No swoop available → fly toward the target, still ending ≥2 hexes away at
  20 ft when possible.

### Mounted

- Mark a target with a non-mounted friendly mark and no other mounted mark;
  fallback to closest reachable.
- Staging ring: radius **4** hexes (Close/high org speed → **2**),
  tangent/rear-flank, outside ZoC, reachable this activation.
- Charge only when the canonical `chargeStanceFor` gate allows it
  (`canCharge`, a charge-capable formation, 2+ actions, scenario **Charge and
  Swoop** on), and:
  - it is the **first action**;
  - the target is engaged by a friendly;
  - the approach is **flank/rear**;
  - the destination is outside hostile ZoC;
  - corridor/destination is clear of other mounted units.
- After the charge attack: remaining action/MP disengages to the farthest safe
  hex from all hostiles, then upgrades to the highest affordable org formation.
- Not charging: stage on the ring and upgrade; no hold when a staging move
  exists.

### Multiple actions

Every doctrine spends as many actions/MP/FP as useful: melee and ranged attack
twice when they have two actions. Mounted is the designed exception (charge
first action → free charge attack → second action disengages). Flying may swoop
twice (each swoop costs a charge action).

## Executor steps

`move | turn | formation | attack` remain. Added:

| Step | Executor |
|---|---|---|
| `climbAttack` | `performClimbAttack` |
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
marks/caps, melee upgrade priority, multi-attack, ranged 6-hex posture and
Close-Order short-bow shots, melee staging, ZoC engagement by fully upgraded
melee, Open-Order pass-through, stop-aware target costs, structure-complex
confinement (footprint, enclosed courtyard, flyer exemption), and hardened
mounted charge / flying swoop gates (scenario toggle, `canCharge`, fly points,
no flyer swoop without FP).
Run `npm run check` (tsc, vitest, depcruise, build) and
`npm run lint:boundaries`.

## Advanced (paused)

Rebuild Advanced **on top of** Basic, reusing `board.ts` / `marks.ts` and the
approach helpers. Do not revive the deleted role planner. Candidate additions:
retaliation/overkill value, focus fire, line coordination, artillery steps, AI
magic/reactions/hero attach, full auto-turn.
