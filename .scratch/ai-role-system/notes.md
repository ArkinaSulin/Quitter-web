# AI role system — session notes and fill-in forms

Status: **role-marker overlay shipped; taxonomy design open for next session.**
The overlay is display-only. The **Shock/A behaviour is NOT implemented yet.**

## What shipped

- Per-player, device-local option: **Scenario Settings -> This device -> Show AI
  role overlay**. Available only when **Advanced AI** is on and the viewer is
  DM/effective GM or **Allow players to use AI assist** is on. Stored per
  scenario/user (`quitter.showAiRoleOverlay:<scenarioId>:<userId>`); default off.
- There is **no** scenario-level role-marker flag anymore. Migration 132 drops
  the old `scenarios.ai_role_markers` column (131 is superseded).
- Markers: large faint role letter over the **upper 2/3 of the token**, over the
  troop circles (elevation-aware). M/A/C/S/R/G.
  - M = frontline melee anchor
  - A = high-damage frontage / shock (display-only)
  - C = flank/rear flanker
  - S = skirmisher / ranged
  - R = reserve
  - G = structure / garrison
- Legend in the AI panel: M | A | C | S | R | G.
- Visibility: DM/effective GM sees all; a player sees only units in their own
  team; DM in player mode is treated as a player.
- Roles recomputed from current positions/hostile numbers, independent of
  Preview/Execute. **Advanced AI only.**
- AI stance lifted from `AiPanel` to `ScenarioMap` so persistent roles use the
  selected Aggressive/Defensive posture.
## High-damage (A) rule

Do **not** use `isTwoHanded`.

```
average per attack action =
  numberOfAttacks * (sum of damage-dice averages + flat bonus)
```

- Active **melee** weapon only.
- Standard benchmark: `1d8+2` = **6.5**.
- A when average is **strictly greater than 6.5** and the current role is
  `frontage` (A replaces M).
- High-damage flankers/reserves keep C/R.

Examples: `1d8+2`/`d12` = M; `2d6`, `2x d6`, `1d10+2` = A if frontage;
`2x d4` = M.

## Why the overlay may be invisible

Check in this order:

1. **Advanced AI on?** The overlay is Advanced-AI only.
2. **Did you enable the local option?** Scenario Settings -> This device ->
   Show AI role overlay. It is available only for DM or allowed players.
3. **Migration 132 applied?** It drops the old `ai_role_markers` column; no
   role flag is needed now.
4. **AI assist enabled?** The overlay is gated on `ai_assist_enabled`.
5. **At least one team in the AI control box?** `aiTeams` is currently
   **session-local**, not persisted. After reload it is empty.
6. **Turn 1+ with an active alliance?** Free play / Turn 0 has no active
   alliance and therefore no roles.
7. **Active alliance has AI-controlled units?** Roles are only computed for the
   current side.
8. **Visibility:** player mode filters to own team. If the AI controls the other
   team, that player sees none.
9. Unit filters/fog can hide tokens; clear filters and use DM view to test.
## Known gaps for next session

- **Persist `ai_teams`** (and probably `ai_excluded`) on the scenario, or role
  markers disappear after reload.
- Add an empty-state hint: "Role markers on, but no AI teams assigned / no
  active turn."
- Consider disabling/annotating the role-marker checkbox when AI assist is off.
- **Shock/A behaviour** is deferred. A is currently display-only.
- Hero marker: not shown (AI never controls heroes).
- Air role: deferred.
- Artillery: currently ranged -> S; revisit if a dedicated role is needed.

## Role taxonomy (current design intent)

- **M — Frontline Melee (The Anchor)**: hold the line and zone-control. Prioritise
  the closest enemy entering the engagement zone; reward formation cohesion and
  locking enemy melee so they cannot slip to the backline.
- **A — Shock / Line Breaker (The Hammer)**: high-aggression focus fire; push a
  weak point, fight in ZoC, win by damage, force a breakthrough. **Behaviour
  pending.**
- **C — Flanker (The Pincer)**: sweep wide around the main engagement; prioritise
  soft targets (archers, standalone heroes) unless an enemy flanker intercepts,
  then counter-flank.
- **S — Skirmisher / Archer (The Harasser)**: distance management; kite, keep
  LoS/firing arcs, relocate when closed on, use the frontline as a buffer.
- **R — Reserve (The Contingency)**: low-cost hold/patrol; event-driven trigger
  (line breached, enemy in flank zone), then plug the gap or reinforce, and
  assume frontline behaviour once committed. Freed reserves return to reserve
  duty.
- **G — Structure / Camp Defender (The Garrison)**: tethered to a wall/tower/camp
  interior; ignore open-field skirmishes; react to ladders, gate-bashing or
  perimeter entry with doorway/vertical defence.

---

# Fill-in forms

Fill the global form once, then one role form per M/A/C/S/R/G. Add 3-5 small
board examples. Concrete positions and thresholds are more useful than prose.

## Global form

```md
# Global AI role policy

Role precedence (highest first):
1. [...]
2. [...]
3. [...]
4. [...]
5. [...]
6. [...]

If two roles apply to one unit: [...]
Role assignment cadence: [per turn / per activation / after each move]
Roles persist until: [...]
Never assign a role to: [heroes / hidden / routed / attached / other]
Fallback when no role qualifies: [...]
Visibility: [DM all / player own team / other]
Marker codes: M A C S R G (H hero optional; Air deferred)
```

## Per-role form

```md
# Role: [M/A/C/S/R/G] — [name]

Purpose (one sentence):
[...]

State name:
[Anchor / Shock / Pincer / Harass / Contingency / Garrison]

Eligibility:
- Unit type / doctrine: [...]
- Weapon requirements: [...]
- Formation requirements: [...]
- Stats: [level, aggression, HP, troops, other]
- Exclusions: [...]

Entry trigger:
- Relative position: [...]
- Enemy condition: [...]
- Friendly condition: [...]
- Numeric threshold: [...]

Exit / transition:
- Leaves when: [...]
- Transitions to [role] when: [...]
- Overridden by [role] when: [...]

Target priority (ordered):
1. [...]
2. [...]
3. [...]
4. [...]

Movement / steering:
- Preferred distance from enemy: [...]
- Distance from friendly line: [...]
- Cohesion radius: [...]
- Avoid: [...]
- Allowed: [...]

Attack policy:
- When to attack: [...]
- Preferred arc: [...]
- Focus fire: [...]
- Charge policy: [...]
- Retreat/disengage: [...]

Formation policy:
- Preferred: [...]
- Upgrade when: [...]
- Downgrade when: [...]

Coordination:
- Pairing: [...]
- Claims: [...]
- Support: [...]

Anti-idle / fallback:
- No valid target: [...]
- Path blocked: [...]

Priority:
- Beats: [...]
- Loses to: [...]

Marker: [M/A/C/S/R/G]

Example board:
- Positions: [...]
- Expected role: [...]
- Expected first action: [...]
- Must not do: [...]
```

## Example board form

```md
# Scenario example: [name]

Friendly units: [id, team, hex, weapon, formation, HP/MP/actions]
Enemy units: [id, team, hex, weapon, formation, HP/MP/actions]
Terrain/structures/zones: [...]

Expected roles:
- [unit] -> [role]
- [unit] -> [role]

Expected behaviour:
- First move: [...]
- First attack: [...]
- Facing: [...]
- Formation: [...]

Must NOT happen:
- [...]

Acceptance assertion:
- [...]
```

## State-transition form

```md
From state: [...]
To state: [...]
Trigger:
- Position: [...]
- Enemy count/distance: [...]
- Friendly condition: [...]
- HP/MP/action threshold: [...]
Cooldown: [once per activation / once per turn / every activation]
Immediate changes:
- Target: [...]
- Movement: [...]
- Attack: [...]
- Formation: [...]
Marker: [stays / changes to ...]
```

## Tuning form

```md
Engagement-zone radius: [N]
Cohesion radius: [N]
Flank swing radius: [>= N]
Reserve station depth: [N]
Reserve trigger distance: [N]
Soft-target priority: [...]
Weak-point definition: [...]
High-damage threshold: 6.5 (fixed)
Focus-fire minimum expected damage: [N]
HP retreat threshold: [%]
AGR threshold for shock/focus: [N]
```

## Next-session checklist

1. Apply migration 132 in Supabase (drops the old role-marker column).
2. Verify the marker toggle stays checked and badges appear:
   - AI assist on, AI team assigned, Turn 1+, DM view.
3. Decide persistence for `ai_teams` / `ai_excluded`.
4. Fill the role forms above, especially A (Shock) and C (counter-flank).
5. Add board examples as acceptance tests.
6. Implement Shock behaviour only after the forms are settled.
