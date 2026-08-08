// src/lib/chargeOver.ts
// Pure helpers for the post-charge overrun: a charging unit that just delivered
// its full charge attack may ride over the target and land on its far side.
import { Hex, Unit, Formation } from '@/types/gameProtocol';
import { isInFrontArc, determineCombatPosition } from '@/lib/unitCombat';
import { canChargeThrough } from '@/lib/formationRules';
import { isMoveAffordable } from '@/lib/moveCost';

export interface CombatOutcome {
  attackerRouted: boolean;
  attackerKilled: boolean;
  defenderRouted: boolean;
  defenderKilled: boolean;
}

/** The hex 2 away from the charger, past the target (cube coords always valid). */
export function computeChargeOverLandingHex(charger: Hex, target: Hex): Hex {
  return {
    q: target.q * 2 - charger.q,
    r: target.r * 2 - charger.r,
    s: target.s * 2 - charger.s,
  };
}

/**
 * May the charger overrun the target after a full charge attack? All conditions:
 *   1. the attacker did not rout / was not killed in that combat
 *   2. the target is charge-through-able from the charger's approach arc
 *      (post-combat formation: Routed if the attack broke/killed it, else as-is)
 *   3. the target sits in the charging unit's front arc
 *   4. the charger can afford the 2 MP overrun (capacity incl. action pools)
 *   5. the landing hex behind the target is empty
 */
export function isChargeOverEligible(
  charger: Unit,
  target: Unit,
  result: CombatOutcome,
  occupied: Set<string>,
  formationsMap: Record<string, Formation>,
  maxMP: number,
): boolean {
  if (result.attackerRouted || result.attackerKilled) return false;
  if (!isInFrontArc(charger.hex, charger.facing, target.hex)) return false;
  if (!isMoveAffordable(charger, 2, maxMP)) return false;
  const targetForm = result.defenderRouted || result.defenderKilled ? 'Routed' : target.currentFormation;
  const approachArc = determineCombatPosition(charger.hex, target.hex, target.facing);
  if (!canChargeThrough(formationsMap[targetForm], approachArc)) return false;
  const land = computeChargeOverLandingHex(charger.hex, target.hex);
  if (occupied.has(`${land.q},${land.r}`)) return false;
  return true;
}
