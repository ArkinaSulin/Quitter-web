Status: ready-for-agent

# Combat Resolution (Attack / Damage)

## Problem Statement

The Scenario Map has MOVE, ROUT, FORMATION, and other actions fully implemented, but dragging a unit onto an occupied hex only produces a stub ATTACK message — no damage is dealt, no AGR check is performed, and no retaliation occurs. Units cannot damage each other, so there is no way to resolve combat. The player drags onto an enemy and nothing happens beyond a log message.

Separately, the existing routing trigger (morale ≤ 0 after MOVE) has no integration with damage. A unit that takes casualties in combat should have its wound penalty recalculated and potentially rout mid-combat, before retaliation.

## Solution

A complete attack/damage system with seven phases, all computed on the fly (no persisted combat state beyond HP/troop count deltas):

1. **Position check** — determines whether the attacker is in the defender's front, flank, or rear based on hex positions and defender facing
2. **Aggressiveness (AGR) check** — roll D10; must ≤ AGR to attack; fail = no attack (action wasted). Skipped if attacker is in the defender's rear
3. **Reach check** — the side with a Reach weapon strikes first; if both have or both lack Reach, the attacker strikes first
4. **Attack rolls** — each front-row troop makes `numberOfAttacks` attacks. For each: roll D20; 1=auto-miss, 20=auto-hit+double damage; hit if `D20 + attackBonus + 8 ≥ target.currentAc`. Damage = weapon damage dice, capped at target's `troopHp`. Accumulated damage subtracts from `currentUnitHp`. Troop count = `ceil(currentUnitHp / troopHp)`.
5. **Defender morale check** — after first strike, defender evaluates effective morale (wounds at new HP, isolation, enemy threats, formation). If ≤ 0 → routs with chained ROUT cascade to adjacent non-hero units.
6. **Retaliation** — if defender didn't rout and position isn't rear: full attacks if front, half (rounded down) if flank, none if rear. No AGR check (reflexive). Same attack roll and damage formula.
7. **Attacker morale check** — after retaliation, attacker evaluates effective morale. If ≤ 0 → routs with cascade.

All damage deltas (`currentUnitHp`, `currentTroopCount`) are stored as sub-steps in the ATTACK command entry. Any ROUT entries are chained (`chained: true`) so one Ctrl+Z undoes the entire combat sequence.

## User Stories

1. As a player, when I drag my unit onto an adjacent enemy in my front kill zone, I want the full combat sequence to resolve, so that the game automatically handles AGR, attack rolls, damage, and retaliation.
2. As a player, I want only the front row of my formation to attack, so that depth of formation matters (troops in back ranks don't contribute to damage output).
3. As a player, I want the number of attack rolls to be `rowCapacity × numberOfAttacks`, so that units with multiple attacks per troop are more dangerous.
4. As a player, I want my unit to need an AGR check (D10 ≤ AGR) before attacking, so that low-aggression units hesitate and unreliable troops have battlefield consequences.
5. As a player, I want my unit (in the defender's rear) to skip the AGR check completely, so that rear attacks are a reliable way to break stalemates.
7. As a player, I want the side with a Reach weapon to strike first, so that pikes and lances have tactical initiative.
8. As a player, when both sides have or both lack Reach, I want the attacker to strike first, so that the initiating side has a natural advantage.
9. As a player, I want each attack roll to follow D&D-style: natural 1 auto-misses, natural 20 auto-hits and doubles damage, and a hit requires `D20 + attackBonus + 8 ≥ target.currentAc`, so that the system is familiar to D&D players.
10. As a player, I want single-target weapon damage capped at the target's `troopHp` per hit, so that one attack can kill at most one troop regardless of overkill.
11. As a player, I want cumulative damage across multiple attacks to be tracked on `currentUnitHp`, with troop count recalculated as `ceil(currentUnitHp / troopHp)`, so that accumulated wounds can kill additional troops even if no single hit was lethal.
12. As a player, when my unit takes damage in combat, I want its effective morale recalculated with the new wound penalty, so that a bloody counter-attack can shatter my unit before it retaliates.
13. As a player, when my enemy's morale breaks after my first strike, I want them to rout immediately and skip their retaliation, so that breaking morale has a direct defensive benefit.
14. As a player, I want my unit to retaliate at full capacity if the attacker is in my front, half capacity on my flank, and not at all to my rear, so that positioning behind an enemy is rewarded.
15. As a player, I want retaliation attacks to follow the same roll formula as the first strike, so that combat outcomes are consistent.
16. As a player, I want retaliation to require no AGR check, so that counter-attacks are a reflexive response.
17. As a player, I want the routing cascade to fire after combat-generated routs too (checking adjacent non-hero units), so that a shattered unit causes a chain reaction on the battlefield.
18. As a GM, when a unit routes from combat, I want the ROUT entries chained to the ATTACK command, so that one Ctrl+Z unwinds the entire combat plus resulting routs.
19. As a player, I want to be unable to attack friendly-alliance units, so that I cannot damage my own side.
20. As a player, I want my unit's formation attack modifier applied to each attack roll, so that Close Order and Phalanx formations hit harder.
21. As a player, when the defender has Reach and I don't, I want the defender to strike first (and potentially rout me before I attack), so that Reach-priority matters for defense too.
22. As a developer, I want the combat resolution to be a pure function accepting an RNG, so that it is fully testable with seeded values.
23. As a developer, I want the existing `computeEffectiveMoraleModifier` to be reused for after-combat morale checks, so that wound penalties, isolation, enemy threats, and formation morale are all accounted for.
24. As a developer, I want the combat result to return each individual attack's roll, hit status, and damage, so that the UI can display detailed combat logs.

## Implementation Decisions

### Computation Layer (unitCombat.ts — pure functions, no side effects)

- **`computeRowCapacity(sizeCategory)`**: Returns 10 for Medium (sizeCategory ≤199), 5 for Large (200–299), 2 for Huge (300–399), 1 for Gargantuan (400+). Reflects how many troops can fight from the front rank.
- **`computeTotalAttacks(rowCapacity, numberOfAttacks)`**: Multiplies row capacity by the unit's `numberOfAttacks` stat (attacks per front-row troop).
- **`determineCombatPosition(attackerHex, defenderHex, defenderFacing)`**: Uses the same 6-direction cube-coordinate system as the existing morale module. Maps the attacker hex relative to the defender to 'front' (kill zone), 'flank' (side), or 'rear' (behind).
- **`rollD20(rng)`** / **`rollDamage(diceStr, rng)`**: Dice helpers accepting a seedable RNG function for deterministic testing.
- **`resolveCombatSequence(attacker, defender, attackerWeapon, defenderWeapon, formationAttackModifier, rng)`**: Orchestrates the full 7-phase sequence. Returns a `CombatOutcome` with all attack results, damage totals, and the striker-priority decision.
- **`executeAttacks(count, attackBonus, damageDice, targetAc, targetTroopHp, rng)`**: Internal worker that generates `count` attack rolls, applies the hit formula, caps damage at `targetTroopHp`, and returns the aggregate.

### Data Flow

- The `onAttack` callback in ScenarioMap is now async. It:
  1. Checks alliance group (blocks friendly fire)
  2. Parses attacker's weapon string (and defender's, for reach and retaliation damage)
  3. Looks up formation attack modifier from the formations map
  4. Calls `resolveCombatSequence`
  5. Converts the `CombatOutcome` into command sub-steps (`currentUnitHp`, `currentTroopCount` changes)
  6. Executes the ATTACK command via `useGameEngine.execute`
  7. Checks defender/attacker morale using `computeEffectiveMoraleModifier` with the new HP values
  8. Routes broken units via chained `execute('ROUT', ..., { chained: true })` with the same cascade pattern as `handleUnitMove`
- Formation attack modifier is applied: `effectiveAttackBonus = weapon.attackBonus + formation.attack_modifier`
- No schema changes were needed — damage only modifies existing `units.currentUnitHp` and `units.currentTroopCount` fields.

### Weapon Format

- Weapons are stored as CSV strings in `weapon_string` on the unit DB row. Parsed by the existing `parseWeapons` utility which returns `{ name, attackBonus, targetType, damageDice, range, magicRadius, reach }`.
- The first weapon in the array is used for attacks (weapon selection UI is future work).
- The `reach` field from the parser maps to `is_reach` for the gameProtocol type convention.

### Morale After Combat

- Wound penalty changes are the primary morale factor after combat (isolation and threats remain the same since no unit moves).
- The existing `computeEffectiveMoraleModifier` is called with a synthetic unit object carrying the new `currentUnitHp` value.
- Routing cascade evaluates adjacent non-hero, non-routing units — same logic as the post-MOVE cascade.

### Undo

- The ATTACK command stores multiple DAMAGE sub-steps, each with field-level `from`/`to` deltas for `currentUnitHp` and `currentTroopCount`.
- Any ROUT entries spawned from combat morale checks use `chained: true`, so the entire sequence unwinds as one batch.

## Testing Decisions

A good test for this system tests the external behavior of pure functions: given known inputs (unit stats, positions, weapons, seeded RNG), assert correct outputs. Avoid testing async React integration, canvas rendering, or Supabase writes.

### Modules to test

1. **`unitCombat.ts`** (new, 29 tests written)
   - `computeRowCapacity` — each size category returns expected value; boundary testing around category thresholds
   - `computeTotalAttacks` — multiplication correctness; zero handling
   - `determineCombatPosition` — all three positions for facing 0; different facings; non-adjacent fallback
   - `rollD20` — value range [1,20]; determinism with same seed
   - `rollDamage` — dice notation parsing (1d8, 2d6, 1d6+2); invalid format returns 0; determinism
   - `resolveCombatSequence`:
     - AGR pass vs fail (fail returns no attacks)
     - AGR pass produces correct attack count (rowCapacity × numberOfAttacks)
     - Rear attack skips AGR and produces no retaliation
     - Flank attack produces half retaliation
     - Defender strikes first when defender has Reach, attacker doesn't
     - Attacker strikes first when both have or both lack Reach
     - Damage capped at troopHp per hit
     - Formation attack modifier is accepted (passthrough test)

2. **Existing morale module** — `computeEffectiveMoraleModifier` is reused, already tested.

### Prior art

- `tokenUtils.test.ts`: Tests pure functions with various inputs.
- `weaponParser.test.ts`: Tests parsing with boundary cases and roundtrips.
- Existing `unitCombat.test.ts`: 29 tests following the same pure-function pattern with seeded RNG.

### Not tested (manual QA / integration-only)

- The full `onAttack` async handler in ScenarioMap (DB writes, chained ROUT execution, message display)
- Alliance-group friendly-fire prevention
- Routing cascade after combat (same pattern as MOVE cascade, tested via integration)
- Undo/redo of ATTACK + chained ROUT entries (same mechanism as existing MOVE+ROUT chain)
- Weapon selection UI (not yet built)

## Out of Scope

- Weapon selection (player chooses which weapon to attack with) — currently uses the first weapon from `weaponString`
- Area-effect weapons (`target_type: 'area'`) and spell targeting UI (modal with circle placement for percentage-based damage)
- Ranged attacks (no AGR check, no retaliation, any direction within range) — partially supported by the position check returning front, but full range rule needs separation
- Phalanx first-entry bonus (2 ranks attack when an enemy enters kill zone)
- Turn system (2 actions per turn, move-or-attack) — future milestone after combat basics
- Unit removal when `currentTroopCount` reaches 0 (currently the unit persists with 0 troops)
- Combat log/feed in the Messages panel with per-attack detail (currently shows summary line)
- AGR level modifier (higher-level enemies intimidating lower-level attackers)

## Further Notes

- The `numberOfAttacks` field on Unit and UnitTemplate represents attacks per front-row troop per action. Combined with row capacity (which varies by size category), this produces the total attack count: `rowCapacity × numberOfAttacks`.
- The `+8` in the attack formula (`D20 + attackBonus + 8 ≥ currentAc`) replaces the standard D&D d20+atk vs AC by shifting the baseline so a level-appropriate attack hits AC 14 on a 7+. This keeps D20 as the core randomness while making unbounded AC scaling unnecessary.
- The RNG parameter on `resolveCombatSequence` accepts `Math.random` in production and any `() => number` function (e.g., seeded PRNG) in tests. This is the only non-determinism in the combat module.
- Combat does not use the `actionsAvailable` field yet — that's part of the future turn system.
- The `unitCaps.ts` file exists in the lib directory but is not used by the combat system; it appears to be leftover from an earlier iteration.
