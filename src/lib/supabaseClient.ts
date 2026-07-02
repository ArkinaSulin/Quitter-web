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

// Helper: Get current user
export function getCurrentUser() {
  return supabase.auth.getUser();
}