// src/lib/archerReaction.ts
import { Unit, AllianceGroup, Formation } from '@/types/gameProtocol';
import { Weapon, parseWeapons } from '@/lib/weaponParser';
import { isUnitRouted } from '@/lib/unitMorale';
import { isHostile } from '@/lib/alliances';
import { isProtectedHero } from '@/lib/unitInteractions';
import { canRangedTarget } from '@/lib/formationRules';
import { arcOfTarget } from '@/lib/attackDirection';
import { computeMovePool, computeHeroMovePool } from '@/lib/moveCost';
import { hexDistance } from '@/types/gameProtocol';

/** A weapon that can shoot beyond adjacency (bow, thrown, magic). */
export function isRangedCapableWeapon(w: Pick<Weapon, 'range' | 'maxRange'> | null | undefined): boolean {
  if (!w) return false;
  const range = w.range ?? 1;
  const maxRange = w.maxRange ?? range;
  return maxRange > 1 || range > 1;
}

/**
 * Can `archer` react at `mover` with `weapon`? Requires a ranged-capable weapon
 * whose **range** (not maxRange — a reaction is a snap shot, no long-range
 * band) covers the mover, and the mover inside the archer's ranged arc.
 */
export function canReactWithWeapon(
  archer: Pick<Unit, 'hex' | 'facing' | 'currentFormation'>,
  mover: Pick<Unit, 'hex'>,
  weapon: Pick<Weapon, 'range' | 'maxRange'> | null | undefined,
  rangeBonus = 0,
  form?: Formation | null,
): boolean {
  if (!weapon || !isRangedCapableWeapon(weapon)) return false;
  if (hexDistance(archer.hex, mover.hex) > (weapon.range ?? 1) + rangeBonus) return false;
  return canRangedTarget(form, arcOfTarget(archer.hex, archer.facing, mover.hex));
}

/**
 * Movement available to a reaction reposition: one FULL action's pool (not the
 * old half move) — the leftover MP on hand, or a full pool when MP is exhausted
 * and an action remains. Heroes use the prorated hero pool. Mirrors the reach of
 * a normal single drag (`computeMovePool` / `computeHeroMovePool`).
 */
export function reactionMovePool(
  unit: Pick<Unit, 'isHero' | 'movementPointsAvailable' | 'actionsAvailable'>,
  maxMP: number,
): number {
  return unit.isHero ? computeHeroMovePool(unit, maxMP) : computeMovePool(unit, maxMP);
}

/**
 * Archers that may react to `mover` finishing a move: hostile alliance, has an
 * action, holds a ranged-capable active weapon, hasn't used its reaction this
 * turn, and stands within that weapon's `range` (not maxRange) of the mover.
 * Formed archers may only react into their front arc (`formationsMap`; absent
 * means all-round). Hidden / deleted / routed units are never eligible on either
 * side, and a hero attached BEHIND a unit (protected — no line of sight) never
 * reacts.
 */
export function findEligibleReactionArchers(
  mover: Unit,
  units: Unit[],
  alliances: Record<string, AllianceGroup>,
  formationsMap?: Record<string, Formation>,
  /** Optional per-archer weapon-range bonus (e.g. a watch tower). */
  rangeBonus?: (unit: Unit) => number,
): Unit[] {
  if (mover.hidden) return []; // a hidden mover is concealed — archers never react to it
  return units.filter(o => {
    if (o.id === mover.id || o.isDeleted || o.hidden || isUnitRouted(o) || isProtectedHero(o)) return false;
    if ((o.currentUnitHp ?? 0) <= 0) return false; // corpses never react
    if (!isHostile(o.team, mover.team, alliances)) return false;
    if ((o.actionsAvailable ?? 0) < 1 || o.archerReactionUsed) return false;
    const weapon = parseWeapons(o.weaponString || '')[o.activeWeaponIndex ?? 0];
    return canReactWithWeapon(o, mover, weapon, rangeBonus?.(o) ?? 0, formationsMap?.[o.currentFormation] ?? null);
  });
}
