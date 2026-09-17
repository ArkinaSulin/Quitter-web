Status: open

# Ranged balance — archers without AGR or retaliation

## Problem Statement

Melee combat is intentionally attritional: an attacker rolls an AGR check,
resolves its volley, then the defender retaliates with its engaged front rows.
A ranged attacker (beyond adjacency) skips that exchange entirely:

- **No AGR check** — a marksman never hesitates, so a low-AGR unit fires reliably.
- **No retaliation** — the target cannot strike back (melee retaliation applies
  only to the adjacent attacker; see `unitCombat.resolveCombatSequence`).
- **No contact** — the archer stays at range and can reposition with `Scattered`
  (loose movement) if anyone closes.

Observation from playtest: this makes ranged units — especially a longbow
(`1d8`, 3-hex range) — outshine melee well beyond their cost, "like wizards in
D&D." Melee pays AGR + retaliation + (now) parting-shot risk; ranged pays none
of it. **This is a design question, not a bug** — captured here so the change is
deliberate.

## Candidate levers (pick one or combine)

1. **Ranged AGR** — apply the same AGR check before a ranged volley (the unit
   can hesitate under threat), reusing `resolveCombatSequence`'s existing
   `aggrPassed` path.
2. **Counter-battery reactions** — a target that is *shot at* by an in-range
   enemy archer gets an opportunity shot back via the existing archer-reaction
   system (`useReactionActions`), bounded by `archer_reaction_enabled` and the
   once-per-turn reaction flag. Closest to "you can shoot, but they shoot back."
3. **Long-range penalty** — the `LONG RANGE - DISADVANTAGE` tag already exists
   in the verbose output; make it mechanical (e.g. −2 to hit between `range` and
   `maxRange`, or attacks at disadvantage).
4. **Scattered while shooting** — a unit that fires must be in a formed
   formation or gains no benefit; prevents the "Shoot then Scatter away" free
   reposition.
5. **Ammo / reload** — ranged volleys limited per battle or per turn.

## Constraints

- Keep the game **soft-enforcement** where possible, but ranged dominance is a
  balance issue best fixed by a hard rule if a lever needs one.
- Reuse the existing combat pipeline (`performAttack` / `resolveCombatSequence`)
  and reaction system rather than adding a parallel one.
- Any new per-turn flag mirrors `archerReactionUsed` / `opportunityAttackUsed`
  (column + `unit_field_to_column` allowlist + turn-start reset).

## Open questions

- Which lever (or combination) fits the intended feel best?
- Should the fix be a scenario **setting** (GM toggle) or always-on?
- Does it interact with the new **parting shot** (an archer disengaging still
  provokes one; should being shot at also provoke)?

## Not in scope (this session)

Kill-zone stop + parting shot shipped in `084_parting_shot.sql`; this issue is
the follow-up balance pass on ranged units.
