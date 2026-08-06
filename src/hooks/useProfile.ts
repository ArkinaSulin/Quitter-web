// src/hooks/useProfile.ts
'use client';

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';

export type ProfileRole = 'admin' | 'dm' | 'player' | null;

interface CachedProfile {
  displayName: string;
  role: ProfileRole;
  requestNote: string;
}

// Session cache so Lobby -> ScenarioMap share the profile without refetching.
const profileCache = new Map<string, CachedProfile>();

// Role → capability matrix (cached per session). Lives in the `access_roles` table
// so privileges can change without code edits.
interface AccessRow {
  can_use_unit_editor: boolean;
  can_create_scenario: boolean;
  can_join_game: boolean;
  can_view_replay: boolean;
}

export interface Access {
  canUseUnitEditor: boolean;
  canCreateScenario: boolean;
  canJoinGame: boolean;
  canViewReplay: boolean;
}

const EMPTY_ACCESS: Access = { canUseUnitEditor: false, canCreateScenario: false, canJoinGame: false, canViewReplay: false };

let accessCache: Record<string, AccessRow> | null = null;

async function loadAccessMatrix(): Promise<Record<string, AccessRow>> {
  if (accessCache) return accessCache;
  const { data } = await supabase
    .from('access_roles')
    .select('role, can_use_unit_editor, can_create_scenario, can_join_game, can_view_replay');
  accessCache = (data || []).reduce((acc: Record<string, AccessRow>, row: any) => {
    acc[row.role] = {
      can_use_unit_editor: !!row.can_use_unit_editor,
      can_create_scenario: !!row.can_create_scenario,
      can_join_game: !!row.can_join_game,
      can_view_replay: !!row.can_view_replay,
    };
    return acc;
  }, {});
  return accessCache;
}

function accessForRole(role: ProfileRole): Access {
  const row = (accessCache || {})[role || 'pending'];
  if (!row) return { canUseUnitEditor: false, canCreateScenario: false, canJoinGame: false, canViewReplay: false };
  return {
    canUseUnitEditor: row.can_use_unit_editor,
    canCreateScenario: row.can_create_scenario,
    canJoinGame: row.can_join_game,
    canViewReplay: row.can_view_replay,
  };
}

function metadataFallbackName(user: any): string {
  return (
    user?.user_metadata?.full_name ||
    user?.user_metadata?.name ||
    user?.email ||
    'Unknown'
  );
}

/**
 * Loads (creating if missing) the signed-in user's profile and exposes their display
 * name, access role (admin / dm / player / null = pending) and request note.
 *
 * `updateDisplayName` / `updateRequestNote` persist only the user's own editable
 * columns (role is server-protected); `approvePlayer` runs the admin-only RPC.
 */
export function useProfile(userId: string | null | undefined) {
  const [displayName, setDisplayName] = useState<string | null>(null);
  const [role, setRole] = useState<ProfileRole>(null);
  const [requestNote, setRequestNote] = useState('');
  // Which userId the role/name currently reflect. loading is DERIVED from this so it
  // becomes true on the exact render where userId appears (not one commit later via
  // an effect) — fixing a stale-commit race that redirected admins out of the editor.
  const [resolvedUserId, setResolvedUserId] = useState<string | null | undefined>(undefined);
  const loading = userId !== null && resolvedUserId !== userId;
  // True only while the access_roles matrix is still loading (first call per session).
  // Once loaded, access is derived synchronously from the cached matrix + role, so it
  // can never lag behind a role change (which caused a stale "pending" redirect).
  const [accessLoading, setAccessLoading] = useState(true);
  const access = accessLoading ? EMPTY_ACCESS : accessForRole(role);

  useEffect(() => {
    let cancelled = false;
    loadAccessMatrix().then(() => {
      if (!cancelled) setAccessLoading(false);
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (!userId) {
      setResolvedUserId(null);
      return;
    }

    if (profileCache.has(userId)) {
      const cached = profileCache.get(userId)!;
      setDisplayName(cached.displayName);
      setRole(cached.role);
      setRequestNote(cached.requestNote);
      setResolvedUserId(userId);
      return;
    }

    (async () => {
      try {
        // Best-effort: fetch user metadata for the display-name fallback. Isolated so
        // a throw/race can NEVER skip the profile upsert below.
        let user: any = null;
        try {
          const { data: userData } = await supabase.auth.getUser();
          user = userData?.user ?? null;
        } catch (err) {
          console.error('[useProfile] getUser failed (continuing to ensure profile):', err);
        }

        const { data: rows } = await supabase
          .from('profiles')
          .select('id, display_name, role, request_note')
          .eq('id', userId)
          .maybeSingle();
        if (rows?.display_name) {
          const cached: CachedProfile = {
            displayName: rows.display_name,
            role: rows.role || null,
            requestNote: rows.request_note || '',
          };
          profileCache.set(userId, cached);
          if (!cancelled) {
            setDisplayName(cached.displayName);
            setRole(cached.role);
            setRequestNote(cached.requestNote);
            setResolvedUserId(userId);
          }
          return;
        }

        const fallback = metadataFallbackName(user);
        const { data: inserted, error: insertError } = await supabase
          .from('profiles')
          .upsert({ id: userId, display_name: fallback }, { onConflict: 'id' })
          .select('display_name, role, request_note')
          .maybeSingle();

        if (insertError) {
          console.error('[useProfile] Failed to create profile:', insertError);
        }
        const cached: CachedProfile = {
          displayName: inserted?.display_name || fallback,
          role: inserted?.role || null,
          requestNote: inserted?.request_note || '',
        };
        profileCache.set(userId, cached);
        if (!cancelled) {
          setDisplayName(cached.displayName);
          setRole(cached.role);
          setRequestNote(cached.requestNote);
          setResolvedUserId(userId);
        }
      } catch (err) {
        console.error('[useProfile] Error loading profile:', err);
        // Settle so the UI never hangs in "loading"; role stays null (pending).
        if (!cancelled) setResolvedUserId(userId);
      }
    })();

    return () => { cancelled = true; };
  }, [userId]);

  // Heartbeat: keep last_active_at fresh so admins can see real "last access".
  useEffect(() => {
    if (!userId) return;
    const touch = () => {
      supabase
        .from('profiles')
        .update({ last_active_at: new Date().toISOString() })
        .eq('id', userId)
        .then(({ error }) => {
          if (error) console.error('[useProfile] Heartbeat failed:', error);
        });
    };
    touch();
    const interval = setInterval(touch, 60_000);
    return () => clearInterval(interval);
  }, [userId]);

  const updateDisplayName = useCallback(
    async (name: string): Promise<boolean> => {
      const trimmed = (name || '').trim();
      if (!trimmed || !userId) return false;

      const { error } = await supabase
        .from('profiles')
        .update({ display_name: trimmed, updated_at: new Date().toISOString() })
        .eq('id', userId);

      if (error) {
        console.error('[useProfile] Failed to update display name:', error);
        return false;
      }

      const cached = profileCache.get(userId) || { displayName: displayName || '', role: role || null, requestNote };
      cached.displayName = trimmed;
      profileCache.set(userId, cached);
      setDisplayName(trimmed);
      return true;
    },
    [userId, displayName, role, requestNote],
  );

  const updateRequestNote = useCallback(
    async (note: string): Promise<boolean> => {
      if (!userId) return false;

      const { error } = await supabase
        .from('profiles')
        .update({ request_note: note, updated_at: new Date().toISOString() })
        .eq('id', userId);

      if (error) {
        console.error('[useProfile] Failed to update request note:', error);
        return false;
      }

      const cached = profileCache.get(userId) || { displayName: displayName || '', role: role || null, requestNote: '' };
      cached.requestNote = note;
      profileCache.set(userId, cached);
      setRequestNote(note);
      return true;
    },
    [userId, displayName, role],
  );

  const approvePlayer = useCallback(
    async (targetUserId: string, newRole: 'admin' | 'dm' | 'player'): Promise<{ ok: boolean; error?: string }> => {
      const { data, error } = await supabase.rpc('set_player_role', {
        target_user_id: targetUserId,
        new_role: newRole,
      });
      if (error) {
        console.error('[useProfile] Failed to approve player:', error);
        return { ok: false, error: error.message };
      }
      return { ok: !!data };
    },
    [],
  );

  return {
    displayName,
    role,
    requestNote,
    loading,
    accessLoading,
    access,
    updateDisplayName,
    updateRequestNote,
    approvePlayer,
  };
}
