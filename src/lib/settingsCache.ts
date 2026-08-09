// src/lib/settingsCache.ts

// Session-scoped in-memory cache of the settings table (see migration 041).
// Values are small and rarely change, so load once and read synchronously from
// memory thereafter. Call invalidateSettingsCache() after an edit (e.g. a future
// Settings UI) so the next getSetting/loadSettings refetches.
let cache: Record<string, unknown> | null = null;
let inflight: Promise<Record<string, unknown>> | null = null;

export function invalidateSettingsCache(): void {
  cache = null;
  inflight = null;
}

/** Fetch all settings rows into the in-memory cache (idempotent, shared). */
export async function loadSettings(): Promise<Record<string, unknown>> {
  if (cache) return cache;
  if (!inflight) {
    // Deferred so lib files that only read settings (never call loadSettings)
    // stay importable in environments without the Supabase env vars (tests).
    const { supabase } = await import('@/lib/supabaseClient');
    const p = supabase
      .from('settings')
      .select('key, value')
      .then(({ data }) => {
        const map: Record<string, unknown> = {};
        for (const row of data || []) {
          map[row.key] = row.value;
        }
        cache = map;
        return map;
      });
    inflight = Promise.resolve(p);
    inflight.then(
      () => { inflight = null; },
      () => { inflight = null; },
    );
  }
  return inflight;
}

/**
 * Synchronous read of a setting, falling back to `fallback` when the cache isn't
 * loaded yet or the key is absent. Code defaults are kept in sync with the seeds
 * so behavior is correct even before loadSettings() resolves.
 */
export function getSetting<T>(key: string, fallback: T): T {
  if (cache && key in cache) return cache[key] as T;
  return fallback;
}
