import { AllianceGroup } from '@/types/gameProtocol';

export const ALLIANCE_ORDER: AllianceGroup[] = ['friendly', 'enemy', 'neutral'];

/**
 * Groups with at least one team assigned via team_alliances.
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
