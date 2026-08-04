// Pure formation-change MP math. MP is tracked as an integer.
// Each organization-level step costs 1 MP; the remainder then rescales
// proportionally to the new formation's effective max, floored and clamped.
import { getOrganizationLevel } from '@/types/gameProtocol';

export function applyFormationChange(
  currentMP: number,
  steps: number,
  oldMax: number,
  newMax: number,
): number {
  if (oldMax <= 0) return newMax;
  const rescaled = (currentMP - steps) * (newMax / oldMax);
  return Math.min(newMax, Math.max(0, Math.floor(rescaled)));
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
