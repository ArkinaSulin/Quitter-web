// src/packages/ships/lib/shipRuntime.ts
// Scenario ship instances (`ship_spelljammer`). A runtime row is an instance of
// a template: `snapshot` freezes the resolved template/build/stats at placement
// so later template edits do not mutate a placed ship.

import { Hex } from '@/types/gameProtocol';
import { ShipBuild, ShipDerivedStats, computeShipBuild } from './shipStats';
import { ShipComponent, ShipTemplate } from '@/types/ship';
import { deckOrderedCardKeys, ensureDeckSlot } from './deckLayout';

const DEFAULT_DECK_COMPONENT: ShipComponent = {
  id: 'Deck',
  name: 'Deck',
  mass: 0,
  crew: 0,
  cost: 0,
  hittable: true,
  effect: null,
  builtIn: true,
  canCombine: true,
  dt: 15,
  ac: 10,
  imageUrl: '',
};

/** Frozen template + resolved build + derived stats at placement. */
export interface ShipSnapshot {
  template: ShipTemplate;
  build: ShipBuild;
  stats: ShipDerivedStats;
}

export interface ShipStationAssignment {
  /** Single-hero stations (Helm/Bridge/weapons/etc.). */
  heroId?: string | null;
  /** Multi-hero stations (Crew Quarters/Deck). */
  heroIds?: string[];
  crewIds?: string[];
  /** Hero token positions as percentages of the card's inner box. */
  heroPositions?: Record<string, { xPct: number; yPct: number }>;
}

export interface ShipCrewState {
  hp: number;
  dead?: boolean;
  station?: string | null;
  leader?: boolean;
}

export interface ShipReloadState {
  progress: number;
  armed: boolean;
}

/** One scenario ship instance (row of `ship_spelljammer`). */
export interface ShipRuntime {
  id: string;
  scenarioId: string;
  templateId: string | null;
  name: string;
  team: string | null;
  hex: Hex | null;
  facing: number;
  speedStat: number;
  shipHp: number;
  shipHpMax: number;
  loadedCargo: number;
  crewAssigned: Record<string, number>;
  boxState: Record<string, unknown>;
  snapshot: ShipSnapshot | null;
  elevation: number;
  lastSpeed: number;
  declaredSpeed: number;
  /** Round number the current speed was declared for (0 = never). */
  declaredRound: number;
  speedSpent: number;
  turnsSinceFacing: number;
  stepBudget: number[];
  stations: Record<string, ShipStationAssignment>;
  crewState: Record<string, ShipCrewState>;
  /** Team/alliance colour for the whole crew roster (null = unset). */
  crewTeam: string | null;
  reload: Record<string, ShipReloadState>;
  weaponState: Record<string, unknown>;
  imageUrl: string;
  keelLength: number;
  imageOffsetY: number;
  isDeleted: boolean;
  commandSeq: number;
}

function num(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function obj<T extends Record<string, unknown>>(value: unknown): T {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as T : ({} as T);
}

export function parseShipHex(raw: unknown): Hex | null {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  const [q, r] = raw.split(',').map(Number);
  if (!Number.isFinite(q) || !Number.isFinite(r)) return null;
  return { q, r, s: -q - r };
}

export function shipHexText(hex: Hex | null | undefined): string | null {
  return hex ? `${hex.q},${hex.r}` : null;
}

export function parseStepBudget(raw: unknown): number[] {
  const list = Array.isArray(raw) ? raw.map(v => Math.max(0, Math.floor(num(v)))) : [];
  return Array.from({ length: 5 }, (_, i) => list[i] ?? 0);
}

/** Add the mandatory Deck card to legacy snapshots and refresh derived stats. */
function normalizeSnapshot(snapshot: ShipSnapshot): ShipSnapshot {
  const build: ShipBuild = { ...snapshot.build };
  const components = [...(build.components ?? [])].map(c =>
    c.name === 'Hull' || c.name === 'Deck' ? { ...c, hittable: true } : c,
  );
  let deck = components.find(c => c.name === 'Deck');
  if (!deck) {
    deck = { ...DEFAULT_DECK_COMPONENT };
    components.push(deck);
  }
  build.components = components;
  const deckKey = `component:${deck.id || 'Deck'}`;
  if (build.deckLayout) build.deckLayout = ensureDeckSlot(build.deckLayout, deckKey);
  const template: ShipTemplate = { ...snapshot.template };
  if (template.deckLayout) template.deckLayout = ensureDeckSlot(template.deckLayout, deckKey);
  return {
    template,
    build,
    stats: computeShipBuild(build),
  };
}

/** Actual deck card key for a component name (handles per-unit `:0` keys). */
export function findCardKeysForComponent(build: ShipBuild, name: string): string[] {
  const component = (build.components ?? []).find(c => c.name === name);
  if (!component) return [];
  if (!build.deckLayout) return [`component:${component.id}`];
  const keys = deckOrderedCardKeys(build.deckLayout);
  const matches = keys.filter(
    k => k === `component:${component.id}` || k.startsWith(`component:${component.id}:`),
  );
  return matches.length > 0 ? matches : [`component:${component.id}`];
}

export function findCardKeyForComponent(build: ShipBuild, name: string): string | null {
  return findCardKeysForComponent(build, name)[0] ?? null;
}

export function mapShipRuntimeRow(row: any): ShipRuntime {
  return {
    id: row.id,
    scenarioId: row.scenario_id,
    templateId: row.template_id || null,
    name: row.name || '',
    team: row.team || null,
    hex: parseShipHex(row.hex),
    facing: num(row.facing),
    speedStat: num(row.speed_stat),
    shipHp: num(row.ship_hp),
    shipHpMax: num(row.ship_hp_max),
    loadedCargo: num(row.loaded_cargo),
    crewAssigned: obj(row.crew_assigned),
    boxState: obj(row.box_state),
    snapshot: row.snapshot && typeof row.snapshot === 'object' && row.snapshot.template && row.snapshot.build
      ? normalizeSnapshot(row.snapshot as ShipSnapshot)
      : null,
    elevation: num(row.elevation),
    lastSpeed: num(row.last_speed, 5),
    declaredSpeed: num(row.declared_speed),
    declaredRound: num(row.declared_round),
    speedSpent: num(row.speed_spent),
    turnsSinceFacing: num(row.turns_since_facing),
    stepBudget: parseStepBudget(row.step_budget),
    stations: obj(row.stations),
    crewState: obj(row.crew_state),
    crewTeam: row.crew_team || null,
    reload: obj(row.reload),
    weaponState: obj(row.weapon_state),
    imageUrl: row.image_url || '',
    keelLength: num(row.keel_length, 100),
    imageOffsetY: num(row.image_offset_y),
    isDeleted: !!row.is_deleted,
    commandSeq: num(row.command_seq),
  };
}

/** Build the insert/`row` payload for a newly placed ship instance. */
export function shipRowFromParts(args: {
  id: string;
  scenarioId: string;
  template: ShipTemplate;
  build: ShipBuild;
  stats: ShipDerivedStats;
  hex: Hex;
  team?: string | null;
}): Record<string, unknown> {
  const { id, scenarioId, template, build, stats, hex, team } = args;
  const snapshot: ShipSnapshot = { template, build, stats };
  return {
    id,
    scenarioId,
    templateId: template.id,
    name: template.name || 'Ship',
    team: team ?? null,
    hex,
    facing: 0,
    speedStat: 0,
    shipHp: Math.max(1, stats.shipHp),
    shipHpMax: Math.max(1, stats.shipHp),
    loadedCargo: template.cargoArea ?? 0,
    crewAssigned: {},
    boxState: {},
    snapshot,
    elevation: 0,
    lastSpeed: 5,
    declaredSpeed: 0,
    declaredRound: 0,
    speedSpent: 0,
    turnsSinceFacing: 0,
    stepBudget: [0, 0, 0, 0, 0],
    stations: {},
    crewState: {},
    crewTeam: null,
    reload: {},
    weaponState: {},
    imageUrl: template.imageUrl,
    keelLength: template.keelLength,
    imageOffsetY: template.imageOffsetY,
    isDeleted: false,
  };
}

/**
 * Cumulative-rounding split of a declared speed over the 5 wildspace steps:
 * step_i = round(total*i/5) - round(total*(i-1)/5).
 * 8 -> [2,1,2,1,2]; 11 -> [2,2,3,2,2].
 */
export function splitSpeedAcrossSteps(total: number): number[] {
  const speed = Math.max(0, Math.floor(total));
  const out: number[] = [];
  let prev = 0;
  for (let i = 1; i <= 5; i += 1) {
    const cum = Math.round((speed * i) / 5);
    out.push(cum - prev);
    prev = cum;
  }
  return out;
}
