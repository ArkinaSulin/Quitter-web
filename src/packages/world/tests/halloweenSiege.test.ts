import { describe, expect, it } from 'vitest';
import {
  activeSiegeWaveIndex,
  assignSiegeTeams,
  beginNextWave,
  chooseSiegeSpawnHexes,
  completedWaveForPhase,
  defaultHalloweenSiegeConfig,
  isHalloweenSiegeComplete,
  isHalloweenSiegeConfigValid,
  nextEnemyTurnNumber,
  parseHalloweenSiegeConfig,
  pickSiegeMonster,
  planSiegeSpawn,
  shouldAnnounceWaveCompletion,
  siegePhaseForTurn,
  toggleNextWaveArm,
  type HalloweenSiegeConfig,
  type SiegeWave,
} from '@/packages/world/lib/halloweenSiege';

function config(partial: Partial<HalloweenSiegeConfig> = {}): HalloweenSiegeConfig {
  return {
    ...defaultHalloweenSiegeConfig(),
    enabled: true,
    turnsPerWave: 2,
    waves: [
      { id: 'w1', count: 2, entries: [{ templateId: 'goblin', percent: 100 }] },
      { id: 'w2', count: 3, entries: [{ templateId: 'ogre', percent: 100 }] },
    ],
    waveStartTurns: [1, null],
    nextWaveStartTurn: null,
    lastSpawnedTurn: 1,
    announcedWave: null,
    announcedWaveTurn: null,
    ...partial,
  };
}

describe('Halloween Siege wave phases', () => {
  it('runs N spawn turns for the active wave', () => {
    const cfg = config();
    expect(siegePhaseForTurn(cfg, 1)).toEqual({
      kind: 'wave', waveIndex: 0, waveNumber: 1, turnInWave: 1, turnsPerWave: 2,
    });
    expect(siegePhaseForTurn(cfg, 2)).toEqual({
      kind: 'wave', waveIndex: 0, waveNumber: 1, turnInWave: 2, turnsPerWave: 2,
    });
  });

  it('pauses in break indefinitely until the next wave is started', () => {
    const cfg = config();
    expect(siegePhaseForTurn(cfg, 3)).toEqual({ kind: 'break', waveNumber: 2 });
    expect(siegePhaseForTurn(cfg, 4)).toEqual({ kind: 'break', waveNumber: 2 });
    expect(siegePhaseForTurn(cfg, 50)).toEqual({ kind: 'break', waveNumber: 2 });
    expect(activeSiegeWaveIndex(cfg, 50)).toBe(0);
  });

  it('starts the next wave when beginNextWave runs', () => {
    const started = beginNextWave(config(), 4);
    expect(started?.waveIndex).toBe(1);
    expect(started?.config.waveStartTurns).toEqual([1, 4]);
    expect(started?.config.nextWaveStartTurn).toBeNull();
    expect(started && siegePhaseForTurn(started.config, 4)).toEqual({
      kind: 'wave', waveIndex: 1, waveNumber: 2, turnInWave: 1, turnsPerWave: 2,
    });
  });

  it('has no trailing break after the final wave', () => {
    const started = beginNextWave(config(), 4)!.config;
    expect(siegePhaseForTurn(started, 5).kind).toBe('wave');
    expect(siegePhaseForTurn(started, 6)).toEqual({ kind: 'complete' });
    expect(isHalloweenSiegeComplete(started, 6)).toBe(true);
  });

  it('reports before when no wave has started yet', () => {
    expect(siegePhaseForTurn(config({ waveStartTurns: [5, null] }), 4)).toEqual({ kind: 'before' });
  });
});

describe('Halloween Siege arming', () => {
  it('targets the next enemy turn from the current alliance', () => {
    expect(nextEnemyTurnNumber(null, 0)).toBe(1);
    expect(nextEnemyTurnNumber('friendly', 4)).toBe(4);
    expect(nextEnemyTurnNumber('enemy', 4)).toBe(5);
    expect(nextEnemyTurnNumber('neutral', 4)).toBe(5);
  });

  it('toggles the armed next-wave start on and off', () => {
    const armed = toggleNextWaveArm(config(), 'enemy', 3);
    expect(armed.nextWaveStartTurn).toBe(4);
    expect(toggleNextWaveArm(armed, 'enemy', 3).nextWaveStartTurn).toBeNull();
  });

  it('arms the same round from a friendly turn and the next round from neutral', () => {
    expect(toggleNextWaveArm(config(), 'friendly', 4).nextWaveStartTurn).toBe(4);
    expect(toggleNextWaveArm(config(), 'neutral', 4).nextWaveStartTurn).toBe(5);
  });

  it('does not change the break phase while armed', () => {
    const armed = toggleNextWaveArm(config(), 'enemy', 3);
    expect(siegePhaseForTurn(armed, 3)).toEqual({ kind: 'break', waveNumber: 2 });
    expect(siegePhaseForTurn(armed, 4)).toEqual({ kind: 'break', waveNumber: 2 });
  });
});

describe('Halloween Siege completion', () => {
  it('reports the completed wave only on the break and complete phases', () => {
    const cfg = config();
    expect(completedWaveForPhase(cfg, siegePhaseForTurn(cfg, 2), 2)).toBeNull();
    expect(completedWaveForPhase(cfg, siegePhaseForTurn(cfg, 3), 2)).toBe(1);
    const started = beginNextWave(cfg, 4)!.config;
    expect(completedWaveForPhase(started, siegePhaseForTurn(started, 6), 5)).toBe(2);
  });

  it('does not announce mid-wave or before a spawn', () => {
    const cfg = config();
    expect(completedWaveForPhase(cfg, siegePhaseForTurn(cfg, 1), 1)).toBeNull();
    expect(completedWaveForPhase(cfg, siegePhaseForTurn(cfg, 2), null)).toBeNull();
  });

  it('repairs a missing or premature announcement marker once', () => {
    const cfg = config();
    expect(shouldAnnounceWaveCompletion(cfg, 1)).toBe(true);
    expect(shouldAnnounceWaveCompletion({ ...cfg, announcedWave: 1, announcedWaveTurn: null }, 1)).toBe(true);
    // Wave 1 starts on turn 1 with N=2: the break boundary is turn 3. A marker
    // written on turn 2 (last spawn turn) is premature.
    expect(shouldAnnounceWaveCompletion({ ...cfg, announcedWave: 1, announcedWaveTurn: 2 }, 1)).toBe(true);
    expect(shouldAnnounceWaveCompletion({ ...cfg, announcedWave: 1, announcedWaveTurn: 3 }, 1)).toBe(false);
    expect(shouldAnnounceWaveCompletion({ ...cfg, announcedWave: 1, announcedWaveTurn: 3 }, 2)).toBe(true);
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
    expect(parsed?.waveStartTurns).toEqual([null]);
    expect(parsed?.nextWaveStartTurn).toBeNull();
    expect(parsed?.announcedWave).toBeNull();
    expect(parsed?.announcedWaveTurn).toBeNull();
  });

  it('backfills legacy nextSpawnAtTurn into waveStartTurns[0]', () => {
    const parsed = parseHalloweenSiegeConfig({
      enabled: true,
      turnsPerWave: 3,
      nextSpawnAtTurn: 7,
      waves: [{ id: 'w1', count: 1, entries: [] }, { id: 'w2', count: 1, entries: [] }],
    });
    expect(parsed?.waveStartTurns).toEqual([7, null]);
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
