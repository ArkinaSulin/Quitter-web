// src/lib/archerReaction.ts
import { Unit, AllianceGroup, Formation } from '@/types/gameProtocol';
import { Weapon, parseWeapons } from '@/lib/weaponParser';
import { isUnitRouted } from '@/lib/unitMorale';
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
  const moverAlliance = alliances[mover.team] || 'friendly';
  return units.filter(o => {
    if (o.id === mover.id || o.isDeleted || o.hidden || isUnitRouted(o) || isProtectedHero(o)) return false;
    if ((o.currentUnitHp ?? 0) <= 0) return false; // corpses never react
    if ((alliances[o.team] || 'friendly') === moverAlliance) return false;
    if ((o.actionsAvailable ?? 0) < 1 || o.archerReactionUsed) return false;
    const weapon = parseWeapons(o.weaponString || '')[o.activeWeaponIndex ?? 0];
    if (!weapon || !isRangedCapableWeapon(weapon)) return false;
    const reach = weapon.range + (rangeBonus?.(o) ?? 0);
    if (hexDistance(o.hex, mover.hex) > reach) return false;
    const form = formationsMap?.[o.currentFormation] ?? null;
    return canRangedTarget(form, arcOfTarget(o.hex, o.facing, mover.hex));
  });
}
