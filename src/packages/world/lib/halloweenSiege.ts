import { Hex } from '@/types/gameProtocol';
import { HEX_DIRS } from '@/packages/primitives';

function hexRingPure(center: Hex, radius: number): Hex[] {
  if (radius <= 0) return [];
  const results: Hex[] = [];
  const add = (a: Hex, b: Hex): Hex => ({ q: a.q + b.q, r: a.r + b.r, s: a.s + b.s });
  let hex = add(center, { q: HEX_DIRS[4].q * radius, r: HEX_DIRS[4].r * radius, s: HEX_DIRS[4].s * radius });
  for (let i = 0; i < 6; i++) {
    for (let j = 0; j < radius; j++) {
      results.push(hex);
      hex = add(hex, HEX_DIRS[i]);
    }
  }
  return results;
}

export interface SiegeEntry {
  templateId: string;
  percent: number;
}

export interface SiegeWave {
  id: string;
  count: number;
  entries: SiegeEntry[];
}

export interface HalloweenSiegeConfig {
  enabled: boolean;
  turnsPerWave: number;
  waves: SiegeWave[];
  waveStartTurns: (number | null)[];
  nextWaveStartTurn: number | null;
  lastSpawnedTurn: number | null;
  announcedWave: number | null;
}

export type SiegePhase =
  | { kind: 'before' }
  | { kind: 'wave'; waveIndex: number; waveNumber: number; turnInWave: number; turnsPerWave: number }
  | { kind: 'break'; waveNumber: number }
  | { kind: 'complete' };

export interface SiegeSpawnPlanRow {
  templateId: string;
  team: string;
  hex: Hex;
}

export function newSiegeWave(id?: string): SiegeWave {
  return {
    id: id || (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `wave-${Date.now()}`),
    count: 5,
    entries: [],
  };
}

export function defaultHalloweenSiegeConfig(): HalloweenSiegeConfig {
  return {
    enabled: false,
    turnsPerWave: 3,
    waves: [],
    waveStartTurns: [],
    nextWaveStartTurn: null,
    lastSpawnedTurn: null,
    announcedWave: null,
  };
}

function finiteInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function finiteNumberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Math.floor(Number(value));
  return Number.isFinite(n) ? n : null;
}

export function parseHalloweenSiegeConfig(raw: unknown): HalloweenSiegeConfig | null {
  if (!raw || typeof raw !== 'object') return null;
  const source = raw as Record<string, any>;
  const waves: SiegeWave[] = Array.isArray(source.waves)
    ? source.waves.map((wave: any, index: number) => ({
        id: typeof wave?.id === 'string' && wave.id ? wave.id : `wave-${index + 1}`,
        count: finiteInt(wave?.count, 1, 1, 999),
        entries: Array.isArray(wave?.entries)
          ? wave.entries
              .filter((entry: any) => entry && typeof entry.templateId === 'string' && entry.templateId)
              .map((entry: any) => ({
                templateId: entry.templateId,
                percent: Math.min(100, Math.max(0, Number(entry.percent) || 0)),
              }))
          : [],
      }))
    : [];

  const waveStartTurns: (number | null)[] = waves.map((_, index) => {
    if (Array.isArray(source.waveStartTurns)) return finiteNumberOrNull(source.waveStartTurns[index]);
    if (index === 0) return finiteNumberOrNull(source.nextSpawnAtTurn);
    return null;
  });

  return {
    enabled: !!source.enabled,
    turnsPerWave: finiteInt(source.turnsPerWave, 3, 1, 999),
    waves,
    waveStartTurns,
    nextWaveStartTurn: finiteNumberOrNull(source.nextWaveStartTurn),
    lastSpawnedTurn: finiteNumberOrNull(source.lastSpawnedTurn),
    announcedWave: finiteNumberOrNull(source.announcedWave),
  };
}

export function isHalloweenSiegeConfigValid(config: HalloweenSiegeConfig | null | undefined): boolean {
  if (!config) return false;
  if (!Number.isFinite(config.turnsPerWave) || config.turnsPerWave < 1) return false;
  if (!Array.isArray(config.waves) || config.waves.length === 0) return false;
  return config.waves.every(wave => {
    if (!Number.isFinite(wave.count) || wave.count < 1) return false;
    if (!Array.isArray(wave.entries) || wave.entries.length === 0) return false;
    if (wave.entries.some(entry => !entry.templateId || !Number.isFinite(entry.percent))) return false;
    const sum = wave.entries.reduce((total, entry) => total + entry.percent, 0);
    return Math.abs(sum - 100) < 1e-6;
  });
}

export function nextEnemyTurnNumber(currentAlliance: string | null, turnNumber: number): number {
  if (currentAlliance === null) return turnNumber + 1;
  if (currentAlliance === 'friendly') return turnNumber;
  return turnNumber + 1;
}

export function activeSiegeWaveIndex(config: HalloweenSiegeConfig, enemyTurnNumber: number): number | null {
  let active: number | null = null;
  const starts = config.waveStartTurns ?? [];
  for (let index = 0; index < config.waves.length; index++) {
    const start = starts[index];
    if (start !== null && start !== undefined && start <= enemyTurnNumber) active = index;
  }
  return active;
}

export function siegePhaseForTurn(config: HalloweenSiegeConfig, enemyTurnNumber: number): SiegePhase {
  const waves = config.waves;
  if (waves.length === 0) return { kind: 'before' };
  const activeIndex = activeSiegeWaveIndex(config, enemyTurnNumber);
  if (activeIndex === null) return { kind: 'before' };
  const start = config.waveStartTurns[activeIndex];
  if (start === null || start === undefined) return { kind: 'before' };
  const turnsPerWave = Math.max(1, Math.floor(config.turnsPerWave) || 1);
  const elapsed = enemyTurnNumber - start;
  if (elapsed < 0) return { kind: 'before' };
  if (elapsed < turnsPerWave) {
    return {
      kind: 'wave',
      waveIndex: activeIndex,
      waveNumber: activeIndex + 1,
      turnInWave: elapsed + 1,
      turnsPerWave,
    };
  }
  if (activeIndex + 1 < waves.length) {
    return { kind: 'break', waveNumber: activeIndex + 2 };
  }
  return { kind: 'complete' };
}

export function toggleNextWaveArm(
  config: HalloweenSiegeConfig,
  currentAlliance: string | null,
  turnNumber: number,
): HalloweenSiegeConfig {
  return {
    ...config,
    nextWaveStartTurn: config.nextWaveStartTurn == null
      ? nextEnemyTurnNumber(currentAlliance, turnNumber)
      : null,
  };
}

export function beginNextWave(
  config: HalloweenSiegeConfig,
  enemyTurnNumber: number,
): { config: HalloweenSiegeConfig; waveIndex: number } | null {
  const activeIndex = activeSiegeWaveIndex(config, enemyTurnNumber);
  const waveIndex = activeIndex === null ? 0 : activeIndex + 1;
  if (waveIndex >= config.waves.length) return null;
  const waveStartTurns = [...config.waveStartTurns];
  while (waveStartTurns.length < config.waves.length) waveStartTurns.push(null);
  waveStartTurns[waveIndex] = enemyTurnNumber;
  return {
    config: { ...config, waveStartTurns, nextWaveStartTurn: null },
    waveIndex,
  };
}

export function completedWaveForPhase(
  config: HalloweenSiegeConfig,
  phase: SiegePhase,
  lastSpawnedTurn: number | null,
): number | null {
  if (lastSpawnedTurn == null) return null;
  if (phase.kind === 'wave') {
    return phase.turnInWave === phase.turnsPerWave ? phase.waveNumber : null;
  }
  if (phase.kind === 'break') {
    return phase.waveNumber > 1 ? phase.waveNumber - 1 : null;
  }
  if (phase.kind === 'complete') {
    return config.waves.length > 0 ? config.waves.length : null;
  }
  return null;
}

export function isHalloweenSiegeComplete(config: HalloweenSiegeConfig, enemyTurnNumber: number): boolean {
  return siegePhaseForTurn(config, enemyTurnNumber).kind === 'complete';
}

export function pickSiegeMonster(entries: SiegeEntry[], rng: () => number = Math.random): SiegeEntry | null {
  const eligible = entries.filter(entry => entry.templateId && entry.percent > 0);
  const total = eligible.reduce((sum, entry) => sum + entry.percent, 0);
  if (total <= 0) return null;
  let roll = rng() * total;
  for (const entry of eligible) {
    if (roll < entry.percent) return entry;
    roll -= entry.percent;
  }
  return eligible[eligible.length - 1] ?? null;
}

export function assignSiegeTeams(count: number, teams: string[]): string[] {
  if (teams.length === 0) return [];
  return Array.from({ length: Math.max(0, Math.floor(count)) }, (_, index) => teams[index % teams.length]);
}

function shuffled<T>(items: T[], rng: () => number): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

export function chooseSiegeSpawnHexes(
  count: number,
  gridRadius: number,
  occupied: Set<string>,
  rng: () => number = Math.random,
): Hex[] {
  const wanted = Math.max(0, Math.floor(count));
  if (wanted === 0) return [];
  const chosen: Hex[] = [];
  const used = new Set(occupied);
  const origin: Hex = { q: 0, r: 0, s: 0 };
  const maxRadius = Math.max(0, Math.floor(gridRadius));
  for (let radius = maxRadius; radius >= 0 && chosen.length < wanted; radius--) {
    const ring = radius === 0 ? [origin] : hexRingPure(origin, radius);
    for (const hex of shuffled(ring, rng)) {
      if (chosen.length >= wanted) break;
      const key = `${hex.q},${hex.r}`;
      if (used.has(key)) continue;
      used.add(key);
      chosen.push(hex);
    }
  }
  return chosen;
}

export function planSiegeSpawn(args: {
  wave: SiegeWave;
  enemyTeams: string[];
  gridRadius: number;
  occupied: Set<string>;
  rng?: () => number;
}): SiegeSpawnPlanRow[] {
  const rng = args.rng ?? Math.random;
  const count = Math.max(0, Math.floor(args.wave.count));
  if (count === 0 || args.enemyTeams.length === 0) return [];
  const entries = args.wave.entries.filter(entry => entry.templateId && entry.percent > 0);
  if (entries.length === 0) return [];
  const hexes = chooseSiegeSpawnHexes(count, args.gridRadius, args.occupied, rng);
  const teams = assignSiegeTeams(count, args.enemyTeams);
  const plan: SiegeSpawnPlanRow[] = [];
  for (let i = 0; i < hexes.length; i++) {
    const entry = pickSiegeMonster(entries, rng);
    if (!entry) break;
    plan.push({ templateId: entry.templateId, team: teams[i], hex: hexes[i] });
  }
  return plan;
}
