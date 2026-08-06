// src/lib/supabaseClient.ts
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

// Helper: Sign in with Google
export async function signInWithGoogle() {
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: window.location.origin,
    },
  });
  if (error) console.error('Google login error:', error);
  return { data, error };
}

// Helper: Sign out
export async function signOut() {
  const { error } = await supabase.auth.signOut();
  if (error) console.error('Sign out error:', error);
  return { error };
}

// Helper: Get current user (network-validated token check)
export function getCurrentUser() {
  return supabase.auth.getUser();
}

// Helper: Get the stored session (reads localStorage, near-instant — no network).
// Use for initial UI hydration; DB queries still validate the JWT server-side.
export function getSessionUser() {
  return supabase.auth.getSession();
}

// Helper: subscribe to auth changes. In supabase-js v2, the first event fired on
// subscribe is a synchronous INITIAL_SESSION built from the stored session, so
// consumers can render the right state on the very first paint (no login flash).
export function onAuthStateChange(cb: (event: string, session: any) => void) {
  return supabase.auth.onAuthStateChange(cb);
}