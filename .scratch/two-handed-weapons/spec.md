# Two-Handed Weapons & Shield Rules

Status: done

## Problem

Weapons could not express whether they occupy both hands, so a shielded unit could
never lose its shield, and nothing prevented Shield Wall from forming with a
two-handed weapon.

## Requirements

1. Add an `isTwoHanded` boolean to the weapon string and the `weapons` table.
2. `isTwoHanded` determines whether a unit can use a shield while wielding that
   weapon. Units without a shield are unaffected.
3. A shielded unit cannot use a shield and a two-handed weapon together —
   practically remove the shield and drop 2 AC.
4. A two-handed weapon prevents forming Shield Wall.
5. Placing a token and switching weapons trigger the check.
6. The unit tooltip reflects the state.
7. The Add Weapon modal has a Two-Handed checkbox.
8. Switching weapons is a **free move** (no MP/action cost).
9. Heroes carry the same shield/weapon logic.

## Decisions (user-confirmed)

- **Reversible / effective** — the −2 AC applies only while a two-handed weapon is
  the *active* weapon; switching back to a one-handed weapon restores the shield
  bonus. `isShielded` is never mutated.
- **Broadcast state** — the active weapon is a shared unit fact
  (`units.active_weapon_index`), changed via a logged `WEAPON_SELECT` command that
  also rewrites `currentAc`. Undo/redo work because it rides the command log.
- **Block** — refuse selecting a two-handed weapon while in Shield Wall, and refuse
  changing *to* Shield Wall while the active weapon is two-handed (both push an
  error message).
- Defender retaliation uses the defender's active weapon (was always weapon[0]).

## Implementation

- `weaponParser.ts`: `Weapon.isTwoHanded`, CSV field #11
  (`Name,AttackBonus,TargetType,DamageDice,Range,MagicRadius,Reach,NoRetaliation,FreeAction,IgnoreAttackMultiplier,IsTwoHanded`);
  older strings default the missing flag to `false`.
- `gameProtocol.ts`: `WeaponLookup.is_two_handed?`, `Unit.activeWeaponIndex`.
- `unitStats.ts`: `getShieldPenalty(unit)` → 2 when `isShielded` + active weapon
  two-handed, else 0.
- `useGameEngine.ts`: `selectWeapon(unit, index)` — blocks 2H selection while in
  Shield Wall, otherwise sets `activeWeaponIndex` and
  `currentAc = baselineAc - shieldPenalty`; single `WEAPON_SELECT` command, no
  MP/action cost (free move). `changeFormation` to `'Shield Wall'` blocked when the
  active weapon is two-handed.
- `useSupabaseSync.ts`: maps/persists `active_weapon_index`; `addUnitFromTemplate`
  spawns a shielded unit holding a two-handed first weapon at `currentAc = baselineAc - 2`.
- `ScenarioMap.tsx`: replaced the session-local `selectedWeapons` state with
  `unit.activeWeaponIndex`; defender retaliation now reads `target.activeWeaponIndex`.
- `ContextMenu.tsx`: `2H` badge; Shield Wall option disabled when the active weapon
  is two-handed.
- `UnitEditor.tsx`: Two-Handed checkbox in the Add/Edit Weapon modal (from
  `weaponsLookup.is_two_handed` on library pick).
- `UnitTooltip.tsx`: `[2H]` marker on weapons; AC breakdown shows
  `baseline − 2 (two-handed)`; Shielded row shows `Yes (dropped — two-handed)`.
- Migration `022_is_two_handed.sql`: `weapons.is_two_handed`,
  `units.active_weapon_index`.

## Tests

- `weaponParser.test.ts`: new flag parse, roundtrip, old 10-field default false.
- `unitStats.test.ts`: `getShieldPenalty` (no shield / 1H / 2H / active-index /
  missing-index default).
- Full suite 203 passing, `tsc --noEmit` clean.

## Notes / deferred

- **Data seeding is manual**: existing `weapons` rows all default to
  `is_two_handed=false`; the flag must be set on real two-handed weapons in the DB.
- Defender retaliation now uses the active weapon index (consistent with broadcast
  selection).
