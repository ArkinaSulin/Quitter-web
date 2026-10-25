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

export const SIEGE_BREAK_TURNS = 1;

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
  nextSpawnAtTurn: number | null;
  lastSpawnedTurn: number | null;
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
    nextSpawnAtTurn: null,
    lastSpawnedTurn: null,
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

  return {
    enabled: !!source.enabled,
    turnsPerWave: finiteInt(source.turnsPerWave, 3, 1, 999),
    waves,
    nextSpawnAtTurn: finiteNumberOrNull(source.nextSpawnAtTurn),
    lastSpawnedTurn: finiteNumberOrNull(source.lastSpawnedTurn),
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

export function siegePhaseForTurn(config: HalloweenSiegeConfig, enemyTurnNumber: number): SiegePhase {
  const start = config.nextSpawnAtTurn;
  if (start === null) return { kind: 'before' };
  const waves = config.waves;
  if (waves.length === 0) return { kind: 'before' };
  const turnsPerWave = Math.max(1, Math.floor(config.turnsPerWave) || 1);
  const elapsed = enemyTurnNumber - start;
  if (elapsed < 0) return { kind: 'before' };
  const cycleLength = turnsPerWave + SIEGE_BREAK_TURNS;
  const total = waves.length * cycleLength - SIEGE_BREAK_TURNS;
  if (elapsed >= total) return { kind: 'complete' };
  const waveIndex = Math.floor(elapsed / cycleLength);
  const position = elapsed % cycleLength;
  if (position < turnsPerWave) {
    return {
      kind: 'wave',
      waveIndex,
      waveNumber: waveIndex + 1,
      turnInWave: position + 1,
      turnsPerWave,
    };
  }
  return { kind: 'break', waveNumber: waveIndex + 2 };
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
    const ring = radius === 0 ? [origin] : hexRingPure(origin, radius);    for (const hex of shuffled(ring, rng)) {
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
