# 08 — Combat Resolution

Combat is a pure computation in `src/lib/unitCombat.ts` + helpers
(`unitStats.ts`, `formationRules.ts`, `spellDamage.ts`, `attackCap.ts`,
`meleeFallback.ts`, `archerReaction.ts`). The ScenarioMap orchestrates the
flow (`useCombatActions.ts` → `performAttack`) and turns outcomes into
command-log sub-steps.

## The combat gate (ScenarioMap `handleAttackRequest` → `performAttack`)

1. Attacker & target exist, both have HP > 0; `canControlUnit(attacker)`.
2. **Alliance gate (hard)** — `validateTargetAlliance`: offensive weapons may
   only target a **different** alliance; healing weapons only the **same**
   alliance. Friendly fire and heal-an-enemy are blocked (no soft confirm).
3. Weapon exists; out of `maxRange`:
   - **exactly one** weapon reaches → silent auto-switch (`WEAPON_SELECT`) to it;
   - **two or more** reach → `PendingWeaponSwitch` soft confirm offering only the
     **first** reaching weapon (a caster may hold many spells — a full picker
     would flood the screen); Cancel leaves the weapon and lets the player switch
     manually and redo;
   - **none** reach → hard block + red flash.
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
- AGR is also **skipped for a reaction strike** (`opportunityAttack`, used by the
  ZoC pursue and the cornered volley): those already passed their single plain
  `d10 ≤ AGR` at selection (see **Pursue** below), so they never re-roll here.
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

- **Attacker (unit)**: `min(currentTroopCount, round(rowCapacity ×
  attack_capacity_multiplier)) × weapon.numberOfAttacks`. The multiplier is
  `formation.attack_capacity_multiplier + heroic_capacity_multiplier` (a decimal
  setting, default 1) when a same-alliance **leading or inspired hero** is within
  7 hexes (`heroicCapacityBonus`); heroes never receive this bonus. Rounded to a
  whole troop cap so decimal settings stay safe.
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
≥ effective AC` (natural 1 auto-miss, natural 20 auto-hit **crit**). On a
hit, roll the damage dice; damage per hit is capped at `troopHp` (one troop).
**Crit doubles the dice only (never the flat bonus)**; a charging attack also
doubles dice (both = ×4). Damage pools into the unit HP; troop count =
`ceil(hp / troopHp)`.

**Effective AC** (`unitStats.effectiveAc`) = `baselineAc + formation AC term
− shieldPenalty`, but the **formation term applies front/flank only — a
formation gives no AC from the REAR** (uniform for every formation; direction via
`attackDirection` — bearing-based so it works for melee and ranged). The formation
term is **split by attack type**: `melee_ac_modifier` (melee) vs
`range_ac_modifier` (ranged — bows/thrown and **single-target magic weapons**,
which roll attack rows like any weapon). Shield Wall is 3/5; every other
formation defaults ranged to 0 until tuned (values live in the `formations` table,
migration 085). Shields are **360°** (baked into `baselineAc`) and are NOT dropped
from the rear. Heroes face all sides, so a hero never takes the rear penalty.
`getShieldPenalty` drops the shield (−2) for a two-handed active weapon or while
routing.

**Edge walls** add a separate AC term: `resolveCombatSequence` takes an optional
`walls` set and adds the **crossed edge's face** AC (`meleeAc`/`rangedAc`, melee
vs ranged) to the defender — melee uses the shared edge, ranged uses the edge the
shot enters through (cube-lerp `hexLine`). See `13`.

**Shield Wall** additionally **requires a shield** to form (two-handed weapons
still block it). Its rear is where the wall is weakest — the formation AC goes to
0 there while the shield remains.

**Range bands**: `dist ≤ range` full effect · `range < dist ≤ maxRange` =
**disadvantage** (roll two D20, take the lower; a crit needs the taken roll to
be 20) · `dist > maxRange` = out of range (hard block). The band is a
disadvantage source in the unified roll mode below.

**Roll mode** (`combatRollMode`): a d20 attack roll can be `normal`, `advantage`
(two D20, take the higher) or `disadvantage` (take the lower). Sources are the
acting unit's own `advantage`/`disadvantage` effects, the target's
`grant_advantage`/`grant_disadvantage` effects (see `10`), and the long-range
band. **Any advantage cancels any disadvantage regardless of count** → normal.
The mode is recomputed per attacker (retaliation uses the retaliator's own flags
+ the first striker's grants; a front-attached hero's volley uses the hero's own
flags). Messages state the cause and verbose prints the `[adv]`/`[dis]` pair.

## Attached heroes take damage

When the defender has a **front-attached hero** (open position), the volley is
split: `ceil(total × hero_attack_split)` (0.3 = 30%) attacks resolve against
the hero's AC/troop HP, the rest against the unit (`executeSplitAttacks`). A
**back-attached (protected) hero** is untouched. The same split applies to
retaliation and to defender-first-strike paths against an attached attacker
hero. Outcomes expose `*HeroDamage` + `*HeroAttacks` for the messages.

The `unit_melee_hero_cap` (0.3) troop cap — "only 30% of troops can reach a
hero" — applies **only to a LONE hero** (attacker or defender is the hero
itself). For a **unit with an attached hero**, the 30% split already routes a
share at the hero, so the unit's volley is **not** additionally capped (it keeps
its full count and splits ~30% → hero, ~70% → unit).

## Attached hero joins the attack (auto)

A hero attached **in front AUTO-joins every attack its host makes** — melee,
ranged, charge, pursuit and parting — when it has an action and a weapon that
reaches. It spends one of its **own** actions and rolls its own weapon volley
into the attacker's blow (the first strike, or the attacker's retaliation when
the defender holds Reach). At melee range it auto-draws its first melee weapon
(or Fists); at range it uses its first weapon whose `maxRange` reaches the
target (otherwise it can't join). The hero rolls at **its own** range bands
(its own disadvantage), and its volley is **doubled while charging**.

A **back-attached (protected)** hero never joins. A front hero **with no action
left sits out** (no prompt, no negative). A **defending** hero stays a damage
pool and reaction shots never include a hero.

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

## Pursue (disengaging a kill zone)

Gated by `scenarios.zoc_pursuit_enabled` (default ON). When a unit **leaves a
hostile kill zone** (`zocDisengage.ts` → `pursuitCandidates`):

- the formed non-hero mover **drops to Scattered** (`pursuitScatters`);
- **one** melee-capable hostile whose kill zone was left **pursues**
  (`useCombatActions.performPursuits`): candidates ordered **attacker → most MaxMP
  → most available MP → random**, each rolling **`d10 <= AGR`** until one passes.
  A candidate inside a hero's Commanding Presence is HELD unless that hero's
  `command_pursuit_permit` is true (a suppressed chase is logged);
- the pursuer takes a **free 1-hex step** into the contact hex and makes a **free
  melee attack resolved at the contact hex** — regardless of the leaver's final
  distance, with the mover's **retaliation suppressed** (the event happened as it
  turned away). A ranged-active pursuer auto-draws melee.

**One AGR, checked before the move.** The `d10 <= AGR` roll at selection is the
**only** aggressiveness check: a candidate that fails it does **not move** and the
next candidate is tried; the one that passes **always** attacks. The reaction
strike itself re-rolls nothing (`resolveCombatSequence` skips its combat AGR for
`opportunityAttack`), so a pursuer can never move into the hex and then fail to
strike.

Each unit pursues **at most once per turn** (`pursuitUsed`), it is **free**, and
**counts +1 to the 5-attack cap**. A **rout-through** makes the pursuer strike
the friendly that let the pass (now Scattered) instead of the router. A router
with **no legal retreat** is CORNERED — every eligible ZoC unit strikes it in
place. A pursuit's own move never provokes. Setting OFF disables all of it.

## Reactions (opportunity fire, archery)

When any unit finishes a MOVE, eligible **archers of the opposing alliance**
with an unused reaction and a ranged weapon may fire:
`findEligibleReactionArchers` (archer reaction logic in `archerReaction.ts`).
Archer within `range` of the mover's landing hex (and, for formed formations, in
the archer's **front cone** — `arcOfTarget`); mover hidden/deleted/routed
excluded; protected (back-attached) heroes never react. Owner of the archer
clicks the blinking bow → reaction mode locks the actor. A reaction is one of:

- **Reaction shot** — the mover (‑1 action, counts to the cap, can rout); closes
  the session immediately,
- **Reposition** — move up to **one full action's movement**
  (`reactionMovePool` = leftover MP, or a full pool when MP is 0; heroes use the
  prorated hero pool), and/or **change formation** (right-click). Move and
  formation may be combined **in either order** within the same session (each
  checks its own MP); a formation change no longer ends the reaction.

The session closes on **End reaction** (toolbar) or **Escape**; a shot closes it
at once. Any sub-action sets `archerReactionUsed` (true, cleared at the unit's
own turn start). Gated by `archer_reaction_enabled`. Reaction shots ride
`resolveCombatSequence` and the command log.

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
`maxUnitHp` with no AGR/retaliation/morale/arc checks — but healing is
restricted to **same-alliance** targets (the hard alliance gate above).
Morale is checked on damaged targets after the damage lands (a spell can rout).
Magic costs an action unless `freeAction`.

## Command shape

An ATTACK command usually carries: optional WEAPON_SELECT sub-steps (auto-draw
+ AC change), the ATTACK sub-step (−1 action, +1 attacksUsed), DAMAGE
sub-steps for both units + any hero damage, and chained ROUT entries for any
units that break (see `09`). Undo reverts the whole exchange. Verbose-combat
messages format the dice (see `verboseCombat.ts`).
