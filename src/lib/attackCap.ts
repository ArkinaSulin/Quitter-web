import { getSetting } from '@/lib/settingsCache';

/**
 * Universal cap on attacks + retaliations per turn for units AND heroes
 * (default 5, setting `unit_attack_cap`). Every ATTACK command counts (+1),
 * incl. free-action, charge, AGR-failed, reaction shots, and retaliations.
 * Soft gate: pausing confirm modals in ScenarioMap; the cap is never a hard
 * block — confirming counts over cap with a red message.
 */
export function unitAttackCap(): number {
  return getSetting('unit_attack_cap', 5);
}

/** True while the unit's attacks+retaliations are within the cap. */
export function isAttackAllowed(attacksUsed: number, cap: number): boolean {
  return attacksUsed < cap;
}
