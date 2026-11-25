// src/packages/ships/lib/campaignShips.ts
// Campaign ships: a row IS a version of a ship family. `parent_id` links a
// version to the version it was derived from, so a family is the tree under the
// root row (`parent_id IS NULL`). Only the carrier scenario instance mirrors its
// runtime into a campaign row; every other instance is a scenario copy.
//
// Names: `name` is the base without the numeral. The numeral is a column, not
// part of the name, so renaming never breaks identification (rule 14). A
// version displays as `name + roman(numeral)` (numeral 1 is implicit) plus the
// scenario label in the campaign list.

import type { CargoManifestItem } from '@/types/ship';
import type { ShipSnapshot } from './shipRuntime';

export interface CampaignShip {
  id: string;
  ownerId: string | null;
  /** Version this row was derived from; null = family root. */
  parentId: string | null;
  /** Base name, without the numeral and without the scenario label. */
  name: string;
  /** 1 = no suffix; 2 = II, 3 = III, … */
  numeral: number;
  scenarioId: string | null;
  /** Scenario name recorded when the version was created. */
  scenarioLabel: string;
  templateId: string | null;
  serialNumber: number;
  shipHp: number;
  shipHpMax: number;
  /** Worst HP reached before the next dry-dock visit. */
  minHpAttained: number;
  damage: Record<string, unknown>;
  crewState: Record<string, unknown>;
  cargo: CargoManifestItem[];
  snapshot: ShipSnapshot | null;
  /** False once the row gained a child; releases its parent's per-scenario slot. */
  occupiesSlot: boolean;
  editorUserId: string | null;
  editorHeartbeatAt: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export type CampaignShipStatus = 'active' | 'frozen' | 'orphan';

const ROMAN_VALUES: Array<[number, string]> = [
  [1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'],
  [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'],
  [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I'],
];

/** Roman numeral for any positive integer (no upper limit). */
export function romanNumeral(value: number): string {
  let n = Math.max(0, Math.floor(value));
  if (n <= 0) return '';
  let out = '';
  for (const [amount, glyph] of ROMAN_VALUES) {
    while (n >= amount) {
      out += glyph;
      n -= amount;
    }
  }
  return out;
}

function objectOrEmpty(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function cargoArray(value: unknown): CargoManifestItem[] {
  return Array.isArray(value) ? value as CargoManifestItem[] : [];
}

export function mapCampaignShipRow(row: any): CampaignShip {
  return {
    id: row.id,
    ownerId: row.owner_id || null,
    parentId: row.parent_id || null,
    name: row.name || 'Ship',
    numeral: Math.max(1, Number(row.numeral) || 1),
    scenarioId: row.scenario_id || null,
    scenarioLabel: row.scenario_label || '',
    templateId: row.template_id || null,
    serialNumber: Number(row.serial_number) || 0,
    shipHp: Number(row.ship_hp) || 0,
    shipHpMax: Number(row.ship_hp_max) || 1,
    minHpAttained: row.min_hp_attained != null
      ? Number(row.min_hp_attained)
      : Number(row.ship_hp) || 0,
    damage: objectOrEmpty(row.damage),
    crewState: objectOrEmpty(row.crew_state),
    cargo: cargoArray(row.cargo),
    snapshot: row.snapshot && typeof row.snapshot === 'object'
      ? row.snapshot as ShipSnapshot
      : null,
    occupiesSlot: row.occupies_slot !== false,
    editorUserId: row.editor_user_id || null,
    editorHeartbeatAt: row.editor_heartbeat_at || null,
    createdBy: row.created_by || null,
    createdAt: row.created_at || '',
    updatedAt: row.updated_at || '',
  };
}

/** Name shown on the map: base + roman numeral (numeral 1 is implicit). */
export function campaignBaseName(ship: Pick<CampaignShip, 'name' | 'numeral'>): string {
  const base = ship.name.trim() || 'Ship';
  return ship.numeral > 1 ? `${base} ${romanNumeral(ship.numeral)}` : base;
}

/** Name shown in the campaign list: base + numeral + " - scenario". */
export function campaignDisplayName(
  ship: Pick<CampaignShip, 'name' | 'numeral' | 'scenarioLabel'>,
): string {
  const base = campaignBaseName(ship);
  return ship.scenarioLabel ? `${base} - ${ship.scenarioLabel}` : base;
}

/** Root of the family a row belongs to. */
export function campaignRootId(
  ship: Pick<CampaignShip, 'id' | 'parentId'>,
  byId: Map<string, Pick<CampaignShip, 'id' | 'parentId'>>,
): string {
  const seen = new Set<string>();
  let current = ship;
  while (current.parentId && !seen.has(current.id)) {
    seen.add(current.id);
    const parent = byId.get(current.parentId);
    if (!parent) break;
    current = parent;
  }
  return current.id;
}

export function campaignRoots(rows: CampaignShip[]): CampaignShip[] {
  return rows.filter(row => !row.parentId);
}

/** All rows of the family rooted at `rootId`, root first, then by creation. */
export function campaignFamily(rootId: string, rows: CampaignShip[]): CampaignShip[] {
  const byId = new Map(rows.map(row => [row.id, row]));
  return rows
    .filter(row => campaignRootId(row, byId) === rootId)
    .sort((a, b) => {
      if (a.id === rootId) return -1;
      if (b.id === rootId) return 1;
      return a.createdAt.localeCompare(b.createdAt);
    });
}

/**
 * The family a version belongs to, resolved from the row itself. Use this when
 * you have a version (not its root): passing a child id to `campaignFamily`
 * returns nothing.
 */
export function campaignFamilyOf(row: CampaignShip, rows: CampaignShip[]): CampaignShip[] {
  const byId = new Map(rows.map(item => [item.id, item]));
  return campaignFamily(campaignRootId(row, byId), rows);
}

/** Family label: the root's base name only — never a scenario. */
export function campaignFamilyLabel(root: CampaignShip): string {
  return (root.name || 'Ship').trim() || 'Ship';
}

/** Next numeral for a new version in the family (per-family, never reused). */
export function campaignNextNumeral(parent: CampaignShip, rows: CampaignShip[]): number {
  const family = campaignFamilyOf(parent, rows);
  // Seed with the parent itself so a partial list can never go backwards.
  const max = family.reduce(
    (value, row) => Math.max(value, row.numeral),
    Math.max(1, parent.numeral),
  );
  return max + 1;
}

/**
 * The version immediately before `version`: the row it was forked/converted
 * from (`parent_id`). The family root has no previous version. A deleted parent
 * nulls `parent_id` (the row becomes a root), so there is no dangling case.
 */
export function campaignPreviousVersion(
  version: Pick<CampaignShip, 'id' | 'parentId'>,
  rows: CampaignShip[],
): CampaignShip | null {
  if (!version.parentId) return null;
  return rows.find(row => row.id === version.parentId) ?? null;
}

/**
 * Derived status of a version.
 * - active: a live scenario instance references it
 * - frozen: no live instance, but it has a child
 * - orphan: no live instance and no child
 */
export function campaignStatus(
  row: CampaignShip,
  rows: CampaignShip[],
  liveCampaignIds: Set<string>,
): CampaignShipStatus {
  if (liveCampaignIds.has(row.id)) return 'active';
  return rows.some(child => child.parentId === row.id) ? 'frozen' : 'orphan';
}

/** True when the scenario already holds a leaf version under the same parent. */
export function campaignSlotTaken(
  rows: CampaignShip[],
  parentId: string | null,
  scenarioId: string | null,
): boolean {
  if (!parentId || !scenarioId) return false;
  return rows.some(row =>
    row.parentId === parentId && row.scenarioId === scenarioId && row.occupiesSlot);
}
