// src/packages/ships/lib/shipRuntime.ts
// Scenario ship instances (`ship_spelljammer`). A runtime row is an instance of
// a template: `snapshot` freezes the resolved template/build/stats at placement
// so later template edits do not mutate a placed ship.

import { Hex } from '@/types/gameProtocol';
import { ShipBuild, ShipDerivedStats, computeMassBreakdown, computeShipBuild } from './shipStats';
import { ShipComponent, ShipTemplate } from '@/types/ship';
import { deckOrderedCardKeys, ensureCardSlot, normalizeDeckLayout } from './deckLayout';
import { cargoManifestMass, normalizeCargoManifest } from './cargoManifest';
import { ShipCardStepState, normalizeCardStepState } from './cardSteps';

const DEFAULT_HULL_COMPONENT: ShipComponent = {
  id: 'Hull',
  name: 'Hull',
  mass: 0,
  crew: 0,
  cost: 0,
  hittable: true,
  effect: null,
  builtIn: true,
  canCombine: true,
  dt: 15,
  ac: 10,
};

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
  /** Multi-hero stations (Cargo/Deck). */
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
  /** Lowest HP reached before the next dry-dock repair. */
  minHpAttained: number;
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
  /** Atmosphere ground-movement points spent this turn (fractions allowed). */
  mpSpent: number;
  /** Atmosphere flight points spent this turn (fractions allowed). */
  fpSpent: number;
  turnsSinceFacing: number;
  stepBudget: number[];
  stations: Record<string, ShipStationAssignment>;
  crewState: Record<string, ShipCrewState>;
  /** Team/alliance colour for the whole crew roster (null = unset). */
  crewTeam: string | null;
  /** Temporary MC reduction for the current turn (rudder trim). */
  mcReduction: number;
  /** Turn number a sail speed adjustment succeeded (0 = none). */
  sailMaxStep: number;
  /** Turn number a rudder MC trim succeeded (0 = none). */
  sailTrimStep: number;
  /** Turn number a ram was used (0 = none). */
  ramUsedTurn: number;
  reload: Record<string, ShipReloadState>;
  /** Per-card function budget (turn/step + steps used). */
  cardState: ShipCardStepState;
  imageUrl: string;
  keelLength: number;
  imageOffsetY: number;
  /** Shared scenario serial label number (A=1, B=2, ...). */
  serialNumber: number;
  /** Campaign version this instance currently represents, if any. */
  campaignId: string | null;
  /** This instance feeds its campaign row's runtime mirror. */
  campaignCarrier: boolean;
  /** Dry-dock editor window is open for this ship. */
  dryDockOpen: boolean;
  /** Bumped by the DM to re-share a locally closed dry-dock window. */
  dryDockRevision: number;
  /** DM-hidden: invisible/non-interactive for players, dim for the DM. */
  hidden: boolean;
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
  let hull = components.find(c => c.name === 'Hull');
  if (!hull) {
    hull = { ...DEFAULT_HULL_COMPONENT };
    components.push(hull);
  }
  build.components = components;
  const deckKey = `component:${deck.id || 'Deck'}`;
  const hullKey = `component:${hull.id || 'Hull'}`;
  if (build.deckLayout) {
    build.deckLayout = normalizeDeckLayout(build.deckLayout);
    build.deckLayout = ensureCardSlot(build.deckLayout, deckKey);
    build.deckLayout = ensureCardSlot(build.deckLayout, hullKey);
  }
  const template: ShipTemplate = { ...snapshot.template };
  template.manifest = normalizeCargoManifest(template.manifest);
  build.manifest = normalizeCargoManifest(build.manifest ?? template.manifest);
  if (template.deckLayout) {
    template.deckLayout = normalizeDeckLayout(template.deckLayout);
    template.deckLayout = ensureCardSlot(template.deckLayout, deckKey);
    template.deckLayout = ensureCardSlot(template.deckLayout, hullKey);
  }
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

/** Repair station capacity on the Hull card (heroes + crew, hard limit). */
export const SHIP_HULL_REPAIR_CAPACITY = 3;

/** Deck card key of the hull. */
export function shipHullCardKey(build: ShipBuild): string | null {
  return findCardKeyForComponent(build, 'Hull');
}

/** Tonnage (boxes) of the hull card. */
export function shipHullBoxes(build: ShipBuild): number {
  return Math.max(0, Math.round(computeMassBreakdown(build).hull));
}

/**
 * Hull is the ship's structural spine: once every hull box is destroyed the
 * ship falls apart and its HP is 0 regardless of any HP left.
 */
export function shipHullDestroyed(snapshot: ShipSnapshot | null | undefined, boxState: Record<string, unknown> | null | undefined): boolean {
  const build = snapshot?.build;
  if (!build) return false;
  const key = shipHullCardKey(build);
  if (!key) return false;
  const boxes = shipHullBoxes(build);
  if (boxes <= 0) return false;
  return Number(boxState?.[key] ?? 0) >= boxes;
}

/** Stored HP clamped to 0 while the hull is destroyed. */
export function effectiveShipHp(
  snapshot: ShipSnapshot | null | undefined,
  boxState: Record<string, unknown> | null | undefined,
  shipHp: number,
): number {
  return shipHullDestroyed(snapshot, boxState) ? 0 : shipHp;
}

export function mapShipRuntimeRow(row: any): ShipRuntime {
  const boxState = obj(row.box_state);
  const snapshot = row.snapshot && typeof row.snapshot === 'object' && row.snapshot.template && row.snapshot.build
    ? normalizeSnapshot(row.snapshot as ShipSnapshot)
    : null;
  return {
    id: row.id,
    scenarioId: row.scenario_id,
    templateId: row.template_id || null,
    name: row.name || '',
    team: row.team || null,
    hex: parseShipHex(row.hex),
    facing: num(row.facing),
    speedStat: num(row.speed_stat),
    shipHp: effectiveShipHp(snapshot, boxState, num(row.ship_hp)),
    shipHpMax: num(row.ship_hp_max),
    minHpAttained: row.min_hp_attained != null
      ? num(row.min_hp_attained)
      : effectiveShipHp(snapshot, boxState, num(row.ship_hp)),
    loadedCargo: num(row.loaded_cargo),
    crewAssigned: obj(row.crew_assigned),
    boxState,
    snapshot,
    elevation: num(row.elevation),
    lastSpeed: num(row.last_speed, 5),
    declaredSpeed: num(row.declared_speed),
    declaredRound: num(row.declared_round),
    speedSpent: num(row.speed_spent),
    mpSpent: num(row.mp_spent),
    fpSpent: num(row.fp_spent),
    turnsSinceFacing: num(row.turns_since_facing),
    stepBudget: parseStepBudget(row.step_budget),
    stations: obj(row.stations),
    crewState: obj(row.crew_state),
    crewTeam: row.crew_team || 'blue',
    mcReduction: num(row.mc_reduction),
    sailMaxStep: num(row.sail_max_step),
    sailTrimStep: num(row.sail_trim_step),
    ramUsedTurn: num(row.ram_used_turn),
    reload: obj(row.reload),
    cardState: normalizeCardStepState(row.card_state ?? row.weapon_state),
    imageUrl: row.image_url || '',
    keelLength: num(row.keel_length, 100),
    imageOffsetY: num(row.image_offset_y),
    serialNumber: num(row.serial_number),
    campaignId: row.campaign_id || null,
    campaignCarrier: !!row.campaign_carrier,
    dryDockOpen: !!row.dry_dock_open,
    dryDockRevision: num(row.dry_dock_revision),
    hidden: !!row.hidden,
    isDeleted: !!row.is_deleted,
    commandSeq: num(row.command_seq),
  };
}

/** Crew ids currently in a template roster. */
export function shipCrewIds(template: ShipTemplate | null | undefined): Set<string> {
  return new Set((template?.crews ?? []).map(crew => crew.id));
}

/** Drop runtime crew HP/dead entries for people no longer in the roster. */
export function pruneShipCrewState(
  crewState: Record<string, ShipCrewState> | null | undefined,
  validCrewIds: Set<string>,
): Record<string, ShipCrewState> {
  const next: Record<string, ShipCrewState> = {};
  for (const [id, state] of Object.entries(crewState ?? {})) {
    if (validCrewIds.has(id)) next[id] = state;
  }
  return next;
}

/** Drop box damage for cards that no longer exist after a refit. */
export function pruneShipBoxState(
  boxState: Record<string, unknown> | null | undefined,
  validCardKeys: Set<string>,
): Record<string, unknown> {
  const next: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(boxState ?? {})) {
    if (validCardKeys.has(key)) next[key] = value;
  }
  return next;
}

/** Drop crew assignments and hero positions for removed crew/cards. */
export function pruneShipStations(
  stations: Record<string, ShipStationAssignment> | null | undefined,
  validCrewIds: Set<string>,
  validCardKeys: Set<string>,
): Record<string, ShipStationAssignment> {
  const next: Record<string, ShipStationAssignment> = {};
  for (const [key, station] of Object.entries(stations ?? {})) {
    if (!validCardKeys.has(key)) continue;
    next[key] = {
      ...station,
      crewIds: (station.crewIds ?? []).filter(id => validCrewIds.has(id)),
      heroPositions: station.heroPositions
        ? Object.fromEntries(Object.entries(station.heroPositions))
        : undefined,
    };
  }
  return next;
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
  name?: string;
  serialNumber?: number;
  campaignId?: string | null;
  campaignCarrier?: boolean;
  shipHp?: number;
  shipHpMax?: number;
  minHpAttained?: number;
  /** Starting altitude (ft). Atmosphere ships default to 10 ft at the call site. */
  elevation?: number;
  damage?: Record<string, unknown>;
  crewState?: Record<string, unknown>;
}): Record<string, unknown> {
  const { id, scenarioId, template, build, stats, hex, team } = args;
  const snapshot: ShipSnapshot = { template, build, stats };
  return {
    id,
    scenarioId,
    templateId: template.id,
    name: args.name ?? (template.name || 'Ship'),
    serialNumber: args.serialNumber ?? 0,
    campaignId: args.campaignId ?? null,
    campaignCarrier: args.campaignCarrier ?? false,
    team: team ?? null,
    hex,
    facing: 0,
    speedStat: 0,
    shipHp: Math.max(0, args.shipHp ?? stats.shipHp),
    shipHpMax: Math.max(1, args.shipHpMax ?? stats.shipHp),
    minHpAttained: Math.max(0, args.minHpAttained ?? args.shipHp ?? stats.shipHp),
    loadedCargo: cargoManifestMass(template.manifest),
    crewAssigned: {},
    boxState: args.damage ?? {},
    crewState: args.crewState ?? {},
    snapshot,
    elevation: Math.max(0, Math.round(args.elevation ?? 0)),
    lastSpeed: 5,
    declaredSpeed: 0,
    declaredRound: 0,
    speedSpent: 0,
    mpSpent: 0,
    fpSpent: 0,
    turnsSinceFacing: 0,
    stepBudget: [0, 0, 0, 0, 0],
    stations: {},
    crewTeam: 'blue',
    mcReduction: 0,
    sailMaxStep: 0,
    sailTrimStep: 0,
    ramUsedTurn: 0,
    reload: {},
    cardState: {},
    imageUrl: template.imageUrl,
    keelLength: template.keelLength,
    imageOffsetY: template.imageOffsetY,
    dryDockOpen: false,
    dryDockRevision: 0,
    hidden: false,
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
