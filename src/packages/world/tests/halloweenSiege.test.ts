import { describe, expect, it } from 'vitest';
import {
  SIEGE_BREAK_TURNS,
  assignSiegeTeams,
  chooseSiegeSpawnHexes,
  defaultHalloweenSiegeConfig,
  isHalloweenSiegeComplete,
  isHalloweenSiegeConfigValid,
  nextEnemyTurnNumber,
  parseHalloweenSiegeConfig,
  pickSiegeMonster,
  planSiegeSpawn,
  siegePhaseForTurn,
  type HalloweenSiegeConfig,
  type SiegeWave,
} from '@/packages/world/lib/halloweenSiege';

function config(partial: Partial<HalloweenSiegeConfig> = {}): HalloweenSiegeConfig {
  return {
    ...defaultHalloweenSiegeConfig(),
    enabled: true,
    turnsPerWave: 2,
    nextSpawnAtTurn: 1,
    waves: [
      { id: 'w1', count: 2, entries: [{ templateId: 'goblin', percent: 100 }] },
      { id: 'w2', count: 3, entries: [{ templateId: 'ogre', percent: 100 }] },
    ],
    ...partial,
  };
}

describe('Halloween Siege wave phases', () => {
  it('runs N spawn turns, one break turn, then the next wave', () => {
    const cfg = config();
    expect(siegePhaseForTurn(cfg, 1)).toEqual({
      kind: 'wave', waveIndex: 0, waveNumber: 1, turnInWave: 1, turnsPerWave: 2,
    });
    expect(siegePhaseForTurn(cfg, 2)).toEqual({
      kind: 'wave', waveIndex: 0, waveNumber: 1, turnInWave: 2, turnsPerWave: 2,
    });
    expect(siegePhaseForTurn(cfg, 3)).toEqual({ kind: 'break', waveNumber: 2 });
    expect(siegePhaseForTurn(cfg, 4)).toEqual({
      kind: 'wave', waveIndex: 1, waveNumber: 2, turnInWave: 1, turnsPerWave: 2,
    });
    expect(siegePhaseForTurn(cfg, 5)).toEqual({
      kind: 'wave', waveIndex: 1, waveNumber: 2, turnInWave: 2, turnsPerWave: 2,
    });
  });

  it('has no trailing break after the final wave', () => {
    const cfg = config();
    expect(siegePhaseForTurn(cfg, 5).kind).toBe('wave');
    expect(siegePhaseForTurn(cfg, 6)).toEqual({ kind: 'complete' });
    expect(isHalloweenSiegeComplete(cfg, 6)).toBe(true);
    expect(SIEGE_BREAK_TURNS).toBe(1);
  });

  it('reports before when the siege is armed for a future turn', () => {
    expect(siegePhaseForTurn(config({ nextSpawnAtTurn: 5 }), 4)).toEqual({ kind: 'before' });
  });

  it('shows the upcoming wave number during a break', () => {
    const phase = siegePhaseForTurn(config(), 3);
    expect(phase.kind).toBe('break');
    if (phase.kind === 'break') expect(phase.waveNumber).toBe(2);
  });
});

describe('Halloween Siege arming', () => {
  it('targets the next enemy turn from the current alliance', () => {
    expect(nextEnemyTurnNumber(null, 0)).toBe(1);
    expect(nextEnemyTurnNumber('friendly', 4)).toBe(4);
    expect(nextEnemyTurnNumber('enemy', 4)).toBe(5);
    expect(nextEnemyTurnNumber('neutral', 4)).toBe(5);
  });
});

describe('Halloween Siege validation and parsing', () => {
  it('requires every wave to total 100% and have at least one entry', () => {
    expect(isHalloweenSiegeConfigValid(config())).toBe(true);
    expect(isHalloweenSiegeConfigValid(config({
      waves: [{ id: 'w', count: 1, entries: [{ templateId: 'a', percent: 60 }, { templateId: 'b', percent: 30 }] }],
    }))).toBe(false);
    expect(isHalloweenSiegeConfigValid(config({
      waves: [{ id: 'w', count: 1, entries: [] }],
    }))).toBe(false);
  });

  it('normalizes missing fields on read', () => {
    const parsed = parseHalloweenSiegeConfig({
      enabled: true,
      turnsPerWave: 0,
      waves: [{ id: 'w', count: 0, entries: [{ templateId: 'a', percent: 100 }] }],
    });
    expect(parsed?.turnsPerWave).toBe(1);
    expect(parsed?.waves[0].count).toBe(1);
    expect(parsed?.nextSpawnAtTurn).toBeNull();
  });
});

describe('Halloween Siege spawn plan', () => {
  it('picks monsters by weight', () => {
    const entries = [{ templateId: 'a', percent: 25 }, { templateId: 'b', percent: 75 }];
    expect(pickSiegeMonster(entries, () => 0)?.templateId).toBe('a');
    expect(pickSiegeMonster(entries, () => 0.5)?.templateId).toBe('b');
  });

  it('splits units evenly across enemy teams', () => {
    expect(assignSiegeTeams(7, ['black', 'orange'])).toEqual([
      'black', 'orange', 'black', 'orange', 'black', 'orange', 'black',
    ]);
  });

  it('uses the rim first and falls back inward when full', () => {
    const rim = chooseSiegeSpawnHexes(6, 1, new Set(), () => 0.99);
    expect(rim).toHaveLength(6);
    expect(rim.every(hex => Math.max(Math.abs(hex.q), Math.abs(hex.r), Math.abs(hex.s)) === 1)).toBe(true);
    const occupied = new Set(rim.map(hex => `${hex.q},${hex.r}`));
    expect(chooseSiegeSpawnHexes(1, 1, occupied, () => 0.5)).toEqual([{ q: 0, r: 0, s: 0 }]);
  });

  it('plans one spawn per requested unit when space allows', () => {
    const wave: SiegeWave = { id: 'w', count: 3, entries: [{ templateId: 'a', percent: 100 }] };
    const plan = planSiegeSpawn({
      wave,
      enemyTeams: ['black', 'orange'],
      gridRadius: 3,
      occupied: new Set(),
      rng: () => 0.1,
    });
    expect(plan).toHaveLength(3);
    expect(plan.map(row => row.templateId)).toEqual(['a', 'a', 'a']);
    expect(plan.map(row => row.team)).toEqual(['black', 'orange', 'black']);
  });
});
