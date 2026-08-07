// Pure formation-change MP math. MP is tracked as an integer.
// Each organization-level step costs FORMATION_CHANGE_COST (2) MP; the remainder
// then rescales proportionally to the new formation's effective max, floored and
// clamped. The cost is paid from already-materialized MP first, then by converting
// one action into a full pool per the "1 action = 1 full MP pool" economy (same
// refill rule as applyMpSpend). Actions may go negative — soft enforcement.
import { getOrganizationLevel, Unit } from '@/types/gameProtocol';

export const FORMATION_CHANGE_COST = 2;

type MpBudget = Pick<Unit, 'movementPointsAvailable' | 'actionsAvailable'>;

export interface FormationChangeResult {
  movementPointsAvailable: number;
  actionsAvailable: number;
}

export function applyFormationChange(
  unit: MpBudget,
  steps: number,
  oldMax: number,
  newMax: number,
): FormationChangeResult {
  if (oldMax <= 0) {
    return { movementPointsAvailable: newMax, actionsAvailable: unit.actionsAvailable };
  }
  const pool = Math.max(1, oldMax);
  const mp = Math.max(0, Math.floor(unit.movementPointsAvailable));
  const actions = unit.actionsAvailable;
  const cost = steps * FORMATION_CHANGE_COST;

  const rescale = (leftoverMp: number): number =>
    Math.min(newMax, Math.max(0, Math.floor(leftoverMp * (newMax / pool))));

  const total = mp + Math.max(0, actions) * pool;
  if (cost <= total) {
    const leftover = total - cost;
    return {
      movementPointsAvailable: rescale(leftover % pool),
      actionsAvailable: Math.floor(leftover / pool),
    };
  }

  // Over-budget soft enforcement: spend all materialized MP, then each full pool
  // costs one action (may go negative).
  const needed = cost - mp;
  const actionsSpent = Math.ceil(needed / pool);
  const remainder = needed % pool;
  return {
    movementPointsAvailable: rescale(remainder === 0 ? 0 : pool - remainder),
    actionsAvailable: actions - actionsSpent,
  };
}

/** A formation change is affordable when the refill accounting does not go negative on actions. */
export function isFormationChangeAffordable(unit: MpBudget, steps: number, oldMax: number): boolean {
  const pool = Math.max(1, oldMax);
  const mp = Math.max(0, Math.floor(unit.movementPointsAvailable));
  return mp + Math.max(0, unit.actionsAvailable) * pool >= steps * FORMATION_CHANGE_COST;
}

// Preferred target when dropping exactly one organization level. Level 3 has two
// formations (Phalanx, Shield Wall); anything above level 1 drops to Open Order,
// and level 1 drops to Scattered. Level 0 (Scattered/Routed) has no lower.
const NEXT_LOWER_BY_LEVEL: Record<number, string> = {
  2: 'Open Order',
  1: 'Scattered',
};

/**
 * The formation one organization level below `currentFormation`, or null when
 * already at the floor. Used for the post-charge org drop (Phalanx/Shield Wall ->
 * Close Order -> Open Order -> Scattered).
 */
export function nextLowerFormation(currentFormation: string): string | null {
  const level = getOrganizationLevel(currentFormation);
  if (level <= 0) return null;
  if (level === 3) return 'Close Order';
  return NEXT_LOWER_BY_LEVEL[level] ?? null;
}
