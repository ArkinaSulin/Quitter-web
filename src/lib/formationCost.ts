// Pure formation-change MP math. MP is tracked as an integer.
// A formation change costs a flat fraction of the unit's CURRENT effective
// movement (the full MP pool one action converts to): Max(1, ceil(oldMax *
// getFormationChangeCost())). The remainder then rescales proportionally to the
// new formation's effective max, floored and clamped. Because the cost is a
// fraction of the current pool it can never exceed one action and never drops
// below 1 MP — slow formations (Phalanx effective 1-2) change for 1 MP, fast
// ones pay a proportional share, so no one shifts through formations cheaply.
// The cost is paid from already-materialized MP first, then by converting one
// action into a full pool per the "1 action = 1 full MP pool" economy (same
// refill rule as applyMpSpend). Actions may go negative — soft enforcement.
import { getOrganizationLevel, Unit } from '@/types/gameProtocol';
import { getSetting } from './settingsCache';

/** Code fallback for the formation-change fraction — matches migration 049 seed. */
export const FORMATION_CHANGE_COST = 0.5;

export function getFormationChangeCost(): number {
  return getSetting('formation_change_cost_per_step', FORMATION_CHANGE_COST);
}

/**
 * MP cost of a formation change from a formation with the given effective max:
 * a flat fraction of the pool, rounded up, floored at 1. Never exceeds one full
 * pool (one action) because the fraction is ≤ 1.
 */
export function getFormationChangeMpCost(oldMax: number): number {
  return Math.max(1, Math.ceil(oldMax * getFormationChangeCost()));
}

type MpBudget = Pick<Unit, 'movementPointsAvailable' | 'actionsAvailable'>;

export interface FormationChangeResult {
  movementPointsAvailable: number;
  actionsAvailable: number;
}

export function applyFormationChange(
  unit: MpBudget,
  oldMax: number,
  newMax: number,
): FormationChangeResult {
  if (oldMax <= 0) {
    return { movementPointsAvailable: newMax, actionsAvailable: unit.actionsAvailable };
  }
  const pool = Math.max(1, oldMax);
  const mp = Math.max(0, Math.floor(unit.movementPointsAvailable));
  const actions = unit.actionsAvailable;
  const cost = getFormationChangeMpCost(oldMax);

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
export function isFormationChangeAffordable(unit: MpBudget, oldMax: number): boolean {
  const pool = Math.max(1, oldMax);
  const mp = Math.max(0, Math.floor(unit.movementPointsAvailable));
  return mp + Math.max(0, unit.actionsAvailable) * pool >= getFormationChangeMpCost(oldMax);
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
