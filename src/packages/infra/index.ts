// src/packages/infra/index.ts
// Public entry point for the infra package. Import ONLY this from outside.
// NOTE: `supabaseClient` is intentionally NOT re-exported here — it constructs
// the Supabase client at import time (top-level side effect). Import it from the
// dedicated entry point `@/packages/infra/supabase` instead.
export * from './lib/settingsCache';
export * from './lib/formationCache';
export * from './lib/structureTemplateCache';
export * from './lib/templateMappers';
export * from './lib/weaponMappers';
export * from './lib/imageUrls';
export * from './lib/commandLog';
export * from './lib/commandHistory';
