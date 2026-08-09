import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/supabaseClient', () => ({
  supabase: {
    from: () => ({
      select: () => ({
        then: (cb: any) => Promise.resolve(cb({ data: [{ key: 'hero_attack_split', value: 0.35 }], error: null })),
      }),
    }),
  },
}));

import { loadSettings, getSetting, invalidateSettingsCache } from './settingsCache';

describe('settingsCache', () => {
  beforeEach(() => invalidateSettingsCache());

  it('falls back to the code default when the cache is not loaded', () => {
    expect(getSetting('hero_attack_split', 0.3)).toBe(0.3);
  });

  it('returns the DB value once loaded (proving the cache is read)', async () => {
    await loadSettings();
    expect(getSetting('hero_attack_split', 0.3)).toBe(0.35);
  });

  it('invalidate clears the cache so getSetting falls back again', async () => {
    await loadSettings();
    invalidateSettingsCache();
    expect(getSetting('hero_attack_split', 0.3)).toBe(0.3);
  });
});
