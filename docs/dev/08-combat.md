# 08 — Combat Resolution

Combat is a pure computation in `src/lib/unitCombat.ts` + helpers
(`unitStats.ts`, `formationRules.ts`, `spellDamage.ts`, `attackCap.ts`,
`meleeFallback.ts`, `archerReaction.ts`). The ScenarioMap orchestrates the
flow (`useCombatActions.ts` → `performAttack`) and turns outcomes into
command-log sub-steps.

## The combat gate (ScenarioMap `handleAttackRequest` → `performAttack`)

1. Attacker & target exist, both have HP > 0; `canControlUnit(attacker)`.
2. Friendly-fire / heal-an-enemy cross-alliance → soft confirm.
3. Weapon exists; target within `maxRange`, else hard block + red flash.
4. Magic (`magicDimension > 0`) → cast window (Routed can't cast). Healing
   (`isHealing`) → heal resolution (no combat).
5. Melee gates: attacker in the defender's permitted arc for its formation
   (`canMeleeTarget`, formation `melee_target_arcs`); ranged gates
   `canRangedTarget`.
6. Charges, no-actions, at-cap → the soft-enforcement pause modals
   (`pendingChargeAttack`, `pendingAttack`, `pendingAttackCap`).
7. `performAttack(...)` → `resolveCombatSequence(...)` → apply deltas, morale
   checks, chained ROUT, messages.

`performAttack` auto-draws a melee weapon for adjacency (WEAPON_SELECT
sub-step) or falls back to **Fists** when the active weapon is ranged and no
melee weapon exists (`meleeFallback.ts`). Switching to a two-handed weapon
drops the shield (−2 AC, recomputed).

## AGR (will to attack)

- Roll d10; pass if `roll ≤ aggressiveness − threatPenalty`.
- **Threat penalty** (dynamic, not the old level-only table):
  `max(0, round(defenderThreat / attackerThreat) − 1)` using
  `computeThreatRating` on both (see `09`).
- AGR is **skipped** when the attacker is a hero, the attack is ranged, the
  defender is Routed, it's a **rear attack**, the weapon has
  `noRetaliation`/`freeAction`, or the attacker has a **front-attached hero**
  (the hero steadies the troops).
- Failure = the attack does not happen but the action is still spent (the
  ATTACK sub-step with −1 action is recorded regardless).

## Combat position & effective arcs

Raw position from attacker hex vs defender facing (`determineCombatPosition`):
front (kill zone) / flank / rear. That raw arc is then interpreted through the
**defender's formation** (`resolveRetaliationPosition`, using the data-driven
`retaliate_arcs` from `formations`): front = 'full', flank = 'rows',
rear = 'none'. Special formation overrides in code: **Hero** → all sides
front; **Scattered** → all sides flank; **Routed** → all sides rear.

## Who strikes first & simultaneity

- Attacker always first when: weapon `noRetaliation`, ranged attack, rear
  attack, or the defender is Routed.
- Otherwise compare **reach**: if exactly one side has a reach weapon, that
  side strikes first; equal reach → attacker first.
- **Equal reach = simultaneous**: both exchanges happen even if the first
  strike kills/routs the other side (morale after both). **Mismatched reach =
  ordered**: the non-reach side loses its counter if the first strike killed
  or routed it (`suppressRetaliation(outcome, killed, routed, simultaneous)`).

## Attack counts (how many die rolls)

- **Attacker (unit)**: `min(currentTroopCount, rowCapacity ×
  attack_capacity_multiplier) × weapon.numberOfAttacks`.
- **Retaliator (unit, defending)**: `rows × weapon.numberOfAttacks` where rows
  = `ceil(currentTroopCount / visualDotsPerRow)` — retaliation comes from the
  engaged front rows.
- Row capacity base by size (`row_capacity_by_size` band / `size_categories`):
  Small/Medium 10, Large 5, Huge 2, Gargantuan 1. Tight formations multiply
  (visual `row_capacity_multiplier`, attack `attack_capacity_multiplier`:
  Phalanx ×3, Close Order/Shield Wall ×2 — verify live rows).
- **Heroes** attack directly: `weapon.numberOfAttacks` rolls (no row math).
- **beAttacked modifiers** (formation of the *target* side) multiply the
  attacker's count: melee vs Scattered ×1.5, Routed ×2.0; ranged vs Open
  Order/Scattered/Routed ×0.5. Notes are attached for the message.
- **Melee-vs-hero cap**: only `unit_melee_hero_cap` (0.5) of a unit's troops
  can reach a lone (or front-attached) hero in melee — ranged is uncapped.

## To-hit, damage, crits

Per attack: roll D20. Hit when `roll + attackBonus + formation.attack_modifier
≥ target.currentAc` (natural 1 auto-miss, natural 20 auto-hit **crit**). On a
hit, roll the damage dice; damage per hit is capped at `troopHp` (one troop).
**Crit doubles the dice only (never the flat bonus)**; a charging attack also
doubles dice (both = ×4). Damage pools into the unit HP; troop count =
`ceil(hp / troopHp)`.

Routed units drop their shield: −2 AC (`getShieldPenalty` reason 'routing').

**Range bands**: `dist ≤ range` full effect · `range < dist ≤ maxRange` =
**disadvantage** (roll two D20, take the lower; a crit needs the taken roll to
be 20) · `dist > maxRange` = out of range (hard block).

## Attached heroes take damage

When the defender has a **front-attached hero** (open position), the volley is
split: `ceil(total × hero_attack_split)` (0.3 = 30%) attacks resolve against
the hero's AC/troop HP, the rest against the unit (`executeSplitAttacks`). A
**back-attached (protected) hero** is untouched. The same split applies to
retaliation and to defender-first-strike paths against an attached attacker
hero. Outcomes expose `*HeroDamage` + `*HeroAttacks` for the messages.

## Retaliation

After the first strike (unless ordered-suppressed): the defender retaliates if
its effective position ≠ rear and the weapon/formation rules allow
(`retaliate_vs_ranged` controls ranged; `noRetaliation` weapons and rear
attacks never provoke). No AGR roll for retaliation (reflexive). Count per the
retaliation table above.

## Attack cap (units AND heroes)

`units.attacks_used` counts every ATTACK command (+1 incl. free-action, charge,
AGR-failed and reaction shots) and each actual retaliation. Cap
`unit_attack_cap` = 5, **soft**: attacker at cap → pause + "attack past the
5-cap?" confirm; confirming records 6/5 + red message. Retaliator at cap →
pause; allowing records over cap, **declining suppresses the counter**
(`suppressRetaliation(..., atCap)`). The count resets on the unit's own turn
start. Heroes also respect the cap in practice via their 5-action budget.

## Charge! (mounted/eligible formations)

- Context menu "Charge!" (shown via `canFormationCharge`; gated for mounted by
  the `mounted_charge_enabled` scenario setting). Lock rotate/formation, mark
  `isCharging`, `chargeDistance = 0`.
- Moves only through the charge wedge (`07`); distance accumulates.
- Attack at distance ≥ `charge_full_distance` (2) → **free double-damage
  attack**, then drop one organization level (`CHARGE_END`). Attack < 2 →
  premature confirm (normal attack, still drops org).
- After a full-charge attack that didn't break/kill the charger, **charge-over**
  may be offered (`chargeOver.ts`): target charge-through-able from the
  approach arc, in front arc, landing hex empty, 2 MP affordable → ride over
  and land behind (a chained MOVE).
- Still charging at your own End Turn → forfeit (clear charge + org drop).

## Reactions (opportunity fire, archery)

When any unit finishes a MOVE, eligible **archers of the opposing alliance**
with an unused reaction and a ranged weapon may fire:
`findEligibleReactionArchers` (archer reaction logic in `archerReaction.ts`).
Archer within `range` of the mover's landing hex; mover hidden/deleted/routed
excluded; protected (back-attached) heroes never react. Owner of the archer
clicks the blinking bow → reaction mode locks the actor: fire a reaction shot
(−1 action, counts to the cap, can rout) or reposition to a hex within
**50% of max MP** (`getReactionMoveBudget`). All set `archerReactionUsed`
(true, cleared at the unit's own turn start). Gated by
`archer_reaction_enabled`. Reaction shots ride `resolveCombatSequence` and the
command log.

## Magic & area effects

`spellDamage.ts`: area weapons (`magicDimension > 0`) with a **shape**
(`circle` = radius · `cube` = side · `cone` = 60° wedge; `magicDimension` in
feet). The cast window places/rotates the shape on the map; the caster picks
the number of affected troops and the save. Resolution rolls the damage dice
**once** (base), then per affected troop rolls `D20 + saveBonus` against the
Save DC (`str/dex/con/int/wis/cha`):
- success → **half damage (floored)** if `onSaveHalfOrNeg`, else **0**
- failure → full base damage
- per-troop damage capped at `troopHp`.

**Healing** (weapon `isHealing`): no save; each affected troop recovers the
base roll (capped at troopHp); single-target healing rolls and heals up to
`maxUnitHp` with no AGR/retaliation/morale/arc/alliance checks (but a healing
weapon can't be aimed at enemies without the cross-alliance confirm).
Morale is checked on damaged targets after the damage lands (a spell can rout).
Magic costs an action unless `freeAction`.

## Command shape

An ATTACK command usually carries: optional WEAPON_SELECT sub-steps (auto-draw
+ AC change), the ATTACK sub-step (−1 action, +1 attacksUsed), DAMAGE
sub-steps for both units + any hero damage, and chained ROUT entries for any
units that break (see `09`). Undo reverts the whole exchange. Verbose-combat
messages format the dice (see `verboseCombat.ts`).
