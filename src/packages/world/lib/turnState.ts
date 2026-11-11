import { AllianceGroup } from '@/types/gameProtocol';

export const ALLIANCE_ORDER: AllianceGroup[] = ['friendly', 'enemy', 'neutral'];

/**
 * Groups with at least one team assigned via scenario_team_alliance.
 * Teams default to 'friendly' when no rows exist, so friendly is always active.
 */
export function getActiveGroups(alliances: Record<string, AllianceGroup>): AllianceGroup[] {
  const present = new Set<AllianceGroup>();
  for (const group of Object.values(alliances)) {
    present.add(group);
  }
  return ALLIANCE_ORDER.filter(g => present.has(g));
}

/**
 * Advance from the current group to the next active group.
 * `null` means free play — the first active group starts.
 * `wrapped` is true when the cycle returns to the first group (full cycle complete).
 */
export function advanceTurn(
  current: AllianceGroup | null,
  activeGroups: AllianceGroup[],
): { next: AllianceGroup; wrapped: boolean } {
  const list = activeGroups.length > 0 ? activeGroups : ALLIANCE_ORDER;
  if (current === null) return { next: list[0], wrapped: false };
  const idx = list.indexOf(current);
  if (idx === -1) return { next: list[0], wrapped: false };
  const nextIdx = (idx + 1) % list.length;
  return { next: list[nextIdx], wrapped: nextIdx === 0 };
}

/**
 * Wildspace step advance. Every full alliance cycle advances the step; wrapping
 * step 5 -> 1 completes a round (`wrapped` = increment turn_number).
 * Leaving free play always starts at step 1.
 */
export function advanceShipStep(
  currentStep: number,
  allianceWrapped: boolean,
  leavingFreePlay: boolean,
): { step: number; wrapped: boolean } {
  if (leavingFreePlay) return { step: 1, wrapped: false };
  const step = Math.min(5, Math.max(1, Math.floor(currentStep) || 1));
  if (!allianceWrapped) return { step, wrapped: false };
  return step >= 5 ? { step: 1, wrapped: true } : { step: step + 1, wrapped: false };
}
