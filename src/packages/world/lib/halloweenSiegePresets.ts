// src/packages/world/lib/halloweenSiegePresets.ts
// Reusable Halloween Siege sequences (saved presets). A preset stores ONLY the
// authored plan - turnsPerWave + waves[] - never the runtime arming/spawn
// markers. Loading a preset fills the editor draft; "Save & arm" is still the
// only action that arms the siege.

import {
  isSiegePlanValid,
  parseSiegeWaves,
  type HalloweenSiegeConfig,
  type SiegeWave,
} from './halloweenSiege';

export interface HalloweenSiegePlan {
  turnsPerWave: number;
  waves: SiegeWave[];
}

export interface HalloweenSiegePreset extends HalloweenSiegePlan {
  id: string;
  name: string;
  description: string;
  createdAt: string;
  updatedAt: string;
}

function cloneWaves(waves: SiegeWave[]): SiegeWave[] {
  return waves.map(wave => ({
    id: wave.id,
    count: wave.count,
    entries: wave.entries.map(entry => ({ templateId: entry.templateId, percent: entry.percent })),
  }));
}

/** The reusable subset of a live config (runtime markers stripped). */
export function planFromConfig(config: HalloweenSiegeConfig): HalloweenSiegePlan {
  return {
    turnsPerWave: config.turnsPerWave,
    waves: cloneWaves(config.waves),
  };
}

/** Copy a saved plan into a config draft/instance. Runtime markers are reset so a
 *  plan with a different wave count cannot inherit stale start markers. The
 *  `enabled` flag and the act of arming are left to the caller. */
export function applyPlanToConfig(
  config: HalloweenSiegeConfig,
  plan: HalloweenSiegePlan,
): HalloweenSiegeConfig {
  return {
    ...config,
    turnsPerWave: plan.turnsPerWave,
    waves: cloneWaves(plan.waves),
    waveStartTurns: plan.waves.map(() => null),
    nextWaveStartTurn: null,
    lastSpawnedTurn: null,
    announcedWave: null,
    announcedWaveTurn: null,
  };
}

export function isHalloweenSiegePlanValid(plan: HalloweenSiegePlan | null | undefined): boolean {
  if (!plan) return false;
  return isSiegePlanValid(plan.turnsPerWave, plan.waves);
}

/** Every template id referenced by a plan (for stale-template warnings). */
export function halloweenSiegePlanTemplateIds(plan: HalloweenSiegePlan): string[] {
  const ids = new Set<string>();
  for (const wave of plan.waves) {
    for (const entry of wave.entries) {
      if (entry.templateId) ids.add(entry.templateId);
    }
  }
  return Array.from(ids);
}

function finiteInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/** Parse a `halloween_siege_presets` row (snake_case) into the domain shape. */
export function parseHalloweenSiegePresetRow(row: any): HalloweenSiegePreset {
  return {
    id: row.id,
    name: row.name || 'Untitled sequence',
    description: row.description || '',
    turnsPerWave: finiteInt(row.turns_per_wave, 3, 1, 999),
    waves: parseSiegeWaves(row.waves),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Map a preset plan to a snake_case row for INSERT/UPDATE/upsert. */
export function halloweenSiegePresetToRow(plan: HalloweenSiegePlan, name: string, creatorId?: string) {
  return {
    name: name.trim(),
    turns_per_wave: plan.turnsPerWave,
    waves: cloneWaves(plan.waves),
    created_by: creatorId,
  };
}
