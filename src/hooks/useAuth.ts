// src/hooks/useAuth.ts
'use client';

import { useEffect, useState } from 'react';
import { getSessionUser, onAuthStateChange } from '@/lib/supabaseClient';

/**
 * Synchronous-ish auth hydration. supabase-js v2 fires an INITIAL_SESSION event
 * immediately on subscribe using the stored session (localStorage — effectively a
 * cookie), so `user` and `authLoading` settle on the first paint without waiting on
 * a network `getUser()` call. This eliminates the "flashes to login / kicked to
 * lobby" gaps on every page load.
 */
export function useAuth() {
  const [user, setUser] = useState<any>(null);
  const [authLoading, setAuthLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    // onAuthStateChange fires INITIAL_SESSION synchronously on subscribe with the
    // stored session, then SIGNED_IN / SIGNED_OUT on later changes.
    const { data } = onAuthStateChange((_event, session) => {
      if (cancelled) return;
      setUser(session?.user ?? null);
      setAuthLoading(false);
    });

    // Fallback: if the listener doesn't fire (no session / edge case), settle from
    // getSession() so the app never hangs in "loading".
    getSessionUser().then(({ data: sessionData }) => {
      if (cancelled) return;
      if (sessionData?.session?.user) {
        setUser(sessionData.session.user);
      } else if (!sessionData?.session) {
        setUser(null);
      }
      setAuthLoading(false);
    });

    return () => {
      cancelled = true;
      data?.subscription.unsubscribe();
    };
  }, []);

  return { user, authLoading };
}
