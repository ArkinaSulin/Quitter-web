import { getSetting } from '@/lib/settingsCache';

/**
 * Universal cap on attacks + retaliations per turn for non-hero units
 * (default 5). Heroes are bounded by their 5-action budget instead.
 */
export function unitAttackCap(): number {
  return getSetting('unit_attack_cap', 5);
}

/** True while the unit's attacks+retaliations are within the cap. */
export function isAttackAllowed(attacksUsed: number, cap: number): boolean {
  return attacksUsed < cap;
}
