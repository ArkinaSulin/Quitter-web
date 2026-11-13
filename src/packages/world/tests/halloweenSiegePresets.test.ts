import { describe, expect, it } from 'vitest';
import {
  defaultHalloweenSiegeConfig,
  type HalloweenSiegeConfig,
} from '@/packages/world/lib/halloweenSiege';
import {
  applyPlanToConfig,
  halloweenSiegePlanTemplateIds,
  halloweenSiegePresetToRow,
  isHalloweenSiegePlanValid,
  parseHalloweenSiegePresetRow,
  planFromConfig,
  type HalloweenSiegePlan,
} from '@/packages/world/lib/halloweenSiegePresets';

function config(partial: Partial<HalloweenSiegeConfig> = {}): HalloweenSiegeConfig {
  return {
    ...defaultHalloweenSiegeConfig(),
    enabled: true,
    turnsPerWave: 2,
    waves: [
      { id: 'w1', count: 2, entries: [{ templateId: 'goblin', percent: 60 }, { templateId: 'orc', percent: 40 }] },
      { id: 'w2', count: 3, entries: [{ templateId: 'ogre', percent: 100 }] },
    ],
    waveStartTurns: [1, 3],
    nextWaveStartTurn: 5,
    lastSpawnedTurn: 2,
    announcedWave: 1,
    announcedWaveTurn: 3,
    ...partial,
  };
}

const plan: HalloweenSiegePlan = {
  turnsPerWave: 2,
  waves: [
    { id: 'w1', count: 2, entries: [{ templateId: 'goblin', percent: 100 }] },
  ],
};

describe('Halloween Siege presets', () => {
  it('planFromConfig strips every runtime marker', () => {
    const extracted = planFromConfig(config());
    expect(extracted).toEqual({
      turnsPerWave: 2,
      waves: [
        { id: 'w1', count: 2, entries: [{ templateId: 'goblin', percent: 60 }, { templateId: 'orc', percent: 40 }] },
        { id: 'w2', count: 3, entries: [{ templateId: 'ogre', percent: 100 }] },
      ],
    });
    expect(extracted).not.toHaveProperty('enabled');
    expect(extracted).not.toHaveProperty('waveStartTurns');
    expect(extracted).not.toHaveProperty('nextWaveStartTurn');
  });

  it('planFromConfig deep-copies waves so later draft edits do not mutate the plan', () => {
    const source = config();
    const extracted = planFromConfig(source);
    extracted.waves[0].entries[0].percent = 1;
    expect(source.waves[0].entries[0].percent).toBe(60);
  });

  it('applyPlanToConfig copies the plan and resets runtime markers, keeping enabled', () => {
    const applied = applyPlanToConfig(config(), plan);
    expect(applied.enabled).toBe(true);
    expect(applied.turnsPerWave).toBe(2);
    expect(applied.waves).toEqual(plan.waves);
    expect(applied.waveStartTurns).toEqual([null]);
    expect(applied.nextWaveStartTurn).toBeNull();
    expect(applied.lastSpawnedTurn).toBeNull();
    expect(applied.announcedWave).toBeNull();
    expect(applied.announcedWaveTurn).toBeNull();
  });

  it('applyPlanToConfig deep-copies the loaded waves', () => {
    const applied = applyPlanToConfig(config(), plan);
    applied.waves[0].entries[0].percent = 99;
    expect(plan.waves[0].entries[0].percent).toBe(100);
  });

  it('validates a plan with the same rules as the live config', () => {
    expect(isHalloweenSiegePlanValid(plan)).toBe(true);
    expect(isHalloweenSiegePlanValid({ ...plan, turnsPerWave: 0 })).toBe(false);
    expect(isHalloweenSiegePlanValid({ ...plan, waves: [] })).toBe(false);
    expect(isHalloweenSiegePlanValid({
      ...plan,
      waves: [{ id: 'w', count: 1, entries: [{ templateId: 'goblin', percent: 90 }] }],
    })).toBe(false);
  });

  it('lists every referenced template id once', () => {
    const ids = halloweenSiegePlanTemplateIds(planFromConfig(config()));
    expect(ids.sort()).toEqual(['goblin', 'ogre', 'orc']);
  });

  it('parses a preset row and normalises invalid values', () => {
    const parsed = parseHalloweenSiegePresetRow({
      id: 'p1',
      name: 'Goblin Night',
      description: 'Three waves',
      turns_per_wave: 0,
      waves: [{ count: 0, entries: [{ templateId: 'goblin', percent: 200 }] }],
      created_at: 'a',
      updated_at: 'b',
    });
    expect(parsed.id).toBe('p1');
    expect(parsed.name).toBe('Goblin Night');
    expect(parsed.turnsPerWave).toBe(1);
    expect(parsed.waves[0].count).toBe(1);
    expect(parsed.waves[0].entries[0].percent).toBe(100);
  });

  it('maps a plan to a trimmed snake_case row', () => {
    expect(halloweenSiegePresetToRow(plan, '  Spooky  ', 'user-1')).toEqual({
      name: 'Spooky',
      turns_per_wave: 2,
      waves: plan.waves,
      created_by: 'user-1',
    });
  });
});
