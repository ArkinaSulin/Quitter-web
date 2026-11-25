'use client';

// Ownership context for the authoring editors: current user, admin flag, owner
// display names, and the small set of helpers every editor shares.

import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useProfile } from '@/hooks/useProfile';
import { supabase } from '@/packages/infra/supabase';
import {
  canEditOwnedContent,
  filterOwnedContent,
  ownerLabel,
  ownershipKind,
  type OwnershipFilter,
  type OwnershipKind,
  type OwnedContent,
} from '@/packages/infra';

export function useContentOwnership() {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const { role, displayName } = useProfile(userId);
  const isAdmin = role === 'admin';
  const [names, setNames] = useState<Record<string, string>>({});
  const [knownOwnerIds, setKnownOwnerIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    void supabase
      .from('user_profile')
      .select('id, display_name')
      .then(({ data }) => {
        if (cancelled) return;
        const map: Record<string, string> = {};
        for (const row of (data || []) as Array<{ id: string; display_name: string | null }>) {
          map[row.id] = row.display_name || 'Unnamed DM';
        }
        setNames(map);
        setKnownOwnerIds(new Set(Object.keys(map)));
      });
    return () => { cancelled = true; };
  }, []);

  return useMemo(() => ({
    userId,
    displayName,
    isAdmin,
    names,
    knownOwnerIds,
    canEdit: (ownerId: string | null | undefined) => canEditOwnedContent(ownerId, userId, isAdmin),
    kind: (ownerId: string | null | undefined): OwnershipKind =>
      ownershipKind(ownerId, userId, knownOwnerIds),
    label: (ownerId: string | null | undefined): string =>
      ownerLabel(ownerId, names, userId, isAdmin),
    filter: <T extends OwnedContent>(rows: T[], filterBy: OwnershipFilter): T[] =>
      filterOwnedContent(rows, filterBy, userId, knownOwnerIds),
  }), [userId, displayName, isAdmin, names, knownOwnerIds]);
}
