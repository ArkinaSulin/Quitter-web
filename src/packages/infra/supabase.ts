// src/packages/infra/supabase.ts
// Dedicated entry point for the Supabase client + auth helpers (a top-level
// side effect). Kept out of `index.ts` so importing the infra package stays
// side-effect-free for tests and non-auth consumers.
export * from './lib/supabaseClient';
