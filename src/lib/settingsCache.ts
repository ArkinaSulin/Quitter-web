// src/lib/settingsCache.ts

// Session-scoped in-memory cache of the settings table (see migration 041).
// Values are small and rarely change, so load once and read synchronously from
// memory thereafter. Call invalidateSettingsCache() after an edit (e.g. a future
// Settings UI) so the next getSetting/loadSettings refetches.
let cache: Record<string, unknown> | null = null;
let inflight: Promise<Record<string, unknown>> | null = null;

/** Code fallback for undo/redo history depth — matches the migration 047 seed. */
export const DEFAULT_UNDO_STACK_SIZE = 2000;

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

/** A descending-min band (e.g. [{min:19,value:6},{min:0,value:0}]). */
export interface SettingBand {
  min: number;
  value: number;
}

/**
 * Look up a banded setting: bands are ordered highest-min first; the first band
 * whose `min` the input meets wins. Falls back to `fallback` when the cache isn't
 * loaded, the key is absent, or the stored value isn't a non-empty band list.
 */
export function getBandSetting(key: string, fallback: SettingBand[], input: number): number {
  const stored = getSetting<SettingBand[] | null>(key, null);
  const bands = Array.isArray(stored) && stored.length > 0 ? stored : fallback;
  for (const b of bands) {
    if (input >= b.min) return b.value;
  }
  return fallback[fallback.length - 1]?.value ?? 0;
}
