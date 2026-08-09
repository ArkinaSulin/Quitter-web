import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/supabaseClient', () => ({
  supabase: {
    from: () => ({
      select: () => ({
        then: (cb: any) => Promise.resolve(cb({ data: [
          { key: 'hero_attack_split', value: 0.35 },
          { key: 'threat_increment_level', value: [{ min: 19, value: 6 }, { min: 13, value: 5 }, { min: 0, value: 0 }] },
        ], error: null })),
      }),
    }),
  },
}));

import { loadSettings, getSetting, getBandSetting, invalidateSettingsCache, SettingBand } from './settingsCache';

const LEVEL_BANDS: SettingBand[] = [
  { min: 19, value: 6 },
  { min: 13, value: 5 },
  { min: 8, value: 4 },
  { min: 5, value: 3 },
  { min: 3, value: 2 },
  { min: 2, value: 1 },
  { min: 0, value: 0 },
];

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

  it('getBandSetting uses the cached bands once loaded', async () => {
    await loadSettings();
    expect(getBandSetting('threat_increment_level', LEVEL_BANDS, 14)).toBe(5);
  });

  it('getBandSetting falls back to the code default bands when not loaded', () => {
    expect(getBandSetting('threat_increment_level', LEVEL_BANDS, 20)).toBe(6);
    expect(getBandSetting('threat_increment_level', LEVEL_BANDS, 9)).toBe(4);
    expect(getBandSetting('threat_increment_level', LEVEL_BANDS, 5)).toBe(3);
    expect(getBandSetting('threat_increment_level', LEVEL_BANDS, 2)).toBe(1);
    expect(getBandSetting('threat_increment_level', LEVEL_BANDS, 1)).toBe(0);
  });
});
