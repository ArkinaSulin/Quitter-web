// src/packages/infra/lib/contentOwnership.ts
// Shared ownership rules for authoring content (unit/ship/map/effect/structure
// libraries). A row is editable by its creator or an admin. `ownerId === null`
// is legacy/seeded/system content and is admin-only. Scenario tokens are not
// covered by these rules.

export type OwnershipFilter = 'all' | 'mine' | 'system' | 'orphans';

export type OwnershipKind = 'mine' | 'other' | 'system' | 'orphan';

export interface OwnedContent {
  ownerId?: string | null;
}

/** Matches the database `owns_content(owner_id)` helper. */
export function canEditOwnedContent(
  ownerId: string | null | undefined,
  userId: string | null | undefined,
  isAdmin: boolean,
): boolean {
  if (isAdmin) return true;
  return !!ownerId && !!userId && ownerId === userId;
}

export function ownershipKind(
  ownerId: string | null | undefined,
  userId: string | null | undefined,
  knownOwnerIds: Set<string>,
): OwnershipKind {
  if (!ownerId) return 'system';
  if (userId && ownerId === userId) return 'mine';
  if (!knownOwnerIds.has(ownerId)) return 'orphan';
  return 'other';
}

export function filterOwnedContent<T extends OwnedContent>(
  rows: T[],
  filter: OwnershipFilter,
  userId: string | null | undefined,
  knownOwnerIds: Set<string>,
): T[] {
  switch (filter) {
    case 'mine':
      return rows.filter(row => !!userId && row.ownerId === userId);
    case 'system':
      return rows.filter(row => !row.ownerId);
    case 'orphans':
      return rows.filter(row =>
        !!row.ownerId
        && row.ownerId !== userId
        && !knownOwnerIds.has(row.ownerId));
    default:
      return rows;
  }
}

/** Display label for an owner id. */
export function ownerLabel(
  ownerId: string | null | undefined,
  names: Record<string, string>,
  userId: string | null | undefined,
  isAdmin: boolean,
): string {
  if (!ownerId) return isAdmin ? 'System / legacy' : 'System';
  if (userId && ownerId === userId) return 'You';
  return names[ownerId] || 'Deleted user';
}
