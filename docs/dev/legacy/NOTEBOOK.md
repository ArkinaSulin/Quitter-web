# Combat System Notebook

Quick worked examples showing how attack/damage plays out.

## Example 1: Frontal Assault — Sword vs Sword

**Attacker:** Human Infantry (Med, lv 4), Spear (+3 atk, 1d8), AGR 7, AC 14, troopHp 10, 200/200 HP, 20 troops, numberOfAttacks 1
**Defender:** Orc Warriors (Med, lv 4), Shortsword (+2 atk, 1d6), AGR 6, AC 13, troopHp 12, 240/240 HP, 20 troops, numberOfAttacks 1

Both in Open Order (no formation modifiers). Both weapons lack Reach. Defender faces top (facing 0), attacker in front hex.

```
Phase 1 — Position: front (attacker in defender's kill zone)
Phase 2 — AGR: roll D10 → 4 ≤ 7 ✓ (pass)
Phase 3 — Reach: neither has → attacker first
Phase 4 — Attacks (attacker): rowCap=10, total=10×1=10 rolls
```

| Roll | Hit? | Dmg | Result |
|------|------|-----|--------|
| 14   | yes (14+3+8=25 ≥ 13) | 5 | 5 dmg, 0 troops |
| 7    | yes (18 ≥ 13) | 7 | 7 dmg, 0 troops |
| 1    | auto-miss | 0 | — |
| 18   | yes (29 ≥ 13) | 6 | 6 dmg, 0 troops |
| 12   | yes (23 ≥ 13) | 8 | 8 dmg, 0 troops |
| 20   | **crit** (auto-hit, x2) | 4×2=8→cap12 | 12 dmg, 1 troop |
| 9    | yes (20 ≥ 13) | 4 | 4 dmg, 0 troops |
| 15   | yes (26 ≥ 13) | 3 | 3 dmg, 0 troops |
| 5    | yes (16 ≥ 13) | 6 | 6 dmg, 0 troops |
| 11   | yes (22 ≥ 13) | 5 | 5 dmg, 0 troops |

```
Total damage: 5+7+0+6+8+12+4+3+6+5 = 56
Defender HP: 240 - 56 = 184
Defender troops: ceil(184/12) = 16 (lost 4 troops)
```

```
Phase 5 — Defender morale: wounds = -floor((1-184/240)×10) = -2
Base 6 + mod 0 + wounds -2 + threats -1 (front) + formation 0 = 3 > 0 ✓ (holds)
```

```
Phase 6 — Retaliation (front=full): rowCap=10, total=10×1=10
```

| Roll | Hit? | Dmg | Result |
|------|------|-----|--------|
| 8    | yes (8+2+8=18 ≥ 14) | 3 | 3 dmg |
| 13   | yes (23 ≥ 14) | 5 | 5 dmg |
| ...  | ... | ... | ... |

```
Total retaliation: ~42 damage to attacker
Attacker HP: 200 - 42 = 158
Attacker troops: ceil(158/10) = 16 (lost 4 troops)

Phase 7 — Attacker morale: wounds = -floor((1-158/200)×10) = -2
Base 7 + 0 - 2 - threats = 4 > 0 ✓ (holds)
```

**Result:** Both units bloodied. Defender lost 4 troops, attacker lost 4. Neither routed.

---

## Example 2: Rear Attack (No AGR, No Retaliation)

Same units, but attacker moves behind the defender.

```
Position: rear
AGR: skipped (auto-pass)
Reach: attacker first (tie)
Attacks: 10 rolls, ~40-60 damage
Defender HP: 240 → ~184, troops: 20 → ~16
Defender morale: check with new wounds → might rout if already shaky
Retaliation: none (rear attack)
Attacker morale: no check (no damage taken)
```

**Key difference:** The attacker takes zero damage. Aggressive units with low AGR (e.g., AGR 3) love rear attacks — they get to attack without risking hesitation.

---

## Example 3: Hesitation (AGR Fail)

Same attacker, but luck is bad:

```
AGR roll: D10 → 9 > 7 ✗ (fail)
Result: No attacks — action wasted.
```

The unit is stuck for this action. Next action it can try again.

---

## Example 4: Reach Matters — Spear vs Shortsword

Attacker has spear (Reach). Defender has shortsword (no Reach).

```
Reach check: attacker has, defender doesn't → attacker first
```

Normal sequence. Attacker hits first, can break morale before defender swings back.

Defender has Pike (Reach), attacker has Shortsword (no Reach):

```
Reach check: defender has, attacker doesn't → defender first
```

**Defender strikes first.** If defender's counter-attack breaks the attacker's morale, the attacker routs before they even swing. That makes Reach weapons a powerful deterrent.

---

## Example 5: Morale Break Mid-Combat

**Attacker:** Goblin Skirmishers (Med, lv 2), Dagger (+1 atk, 1d4), AGR 5, baseMorale 4, AC 12
**Defender:** Heavy Infantry (Med, lv 6), Spear (+3 atk, 1d8), AGR 8, baseMorale 8, AC 16

Defender has Reach → strikes first. Defender lands 8 hits totaling 48 damage.
```
Attacker HP: 80 → 32
Attacker troops: ceil(32/10) = 4 (lost 4 of 8)
Attacker wounds: -floor((1-32/80)×10) = -6
Effective morale: base 4 + 0 - 6 - threats(3 from lv6 front) + 0 = -5 ≤ 0
→ ROUT! Attacker breaks before retaliating.
```

**Result:** Goblin routs immediately after defender's first strike. No goblin retaliation. Cascade check: adjacent goblins also check morale — chain rout.

---

## Example 6: Formation Attack Modifier

Same as Example 1, but attacker is in Close Order (+1 attack_modifier).

```
Effective attack bonus per roll: +3 (spear) + 1 (formation) = +4
```

Every attack roll gets +1 extra. Against AC 13, a roll of 5 now hits (5+4+8=17 ≥ 13) instead of missing (5+3+8=16 < 13). The same 10 attacks land ~2 more hits on average.

---

## The Damage Formula in One Line

```
actualDamage = min(weaponDamageCappedAtTroopHp, troopHp)
currentUnitHp -= actualDamage
currentTroopCount = ceil(currentUnitHp / troopHp)
```

This means: one attack can kill at most one troop, but cumulative chip damage across many attacks can kill additional troops even if no single hit was lethal.

---

## Row Capacity Reference

| Size Category | Examples | Row Capacity |
|---------------|----------|-------------|
| 75 (Small)   | Goblin   | 10 |
| 100 (Medium) | Human, Orc, Elf | 10 |
| 200 (Large)  | Ogre, Troll | 5 |
| 300 (Huge)   | Giant    | 2 |
| 400 (Gargantuan) | Dragon | 1 |

Total attacks per action = rowCapacity × numberOfAttacks.
