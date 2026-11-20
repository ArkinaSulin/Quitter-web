// src/packages/ships/lib/playerShips.ts
// Persistent player ships. The design stays in the normal ship template tables;
// this row carries identity + runtime state. Versions are immutable snapshots.

import type { CargoManifestItem } from '@/types/ship';
import type { ShipSnapshot } from './shipRuntime';

export interface PlayerShip {
  id: string;
  ownerId: string | null;
  templateId: string;
  name: string;
  serialNumber: number;
  shipHp: number;
  shipHpMax: number;
  damage: Record<string, unknown>;
  crewState: Record<string, unknown>;
  cargo: CargoManifestItem[];
  deployedScenarioId: string | null;
  editorUserId: string | null;
  editorHeartbeatAt: string | null;
}

export interface PlayerShipVersion {
  id: string;
  playerShipId: string;
  versionNumber: number;
  name: string;
  shipHp: number;
  damage: Record<string, unknown>;
  crewState: Record<string, unknown>;
  cargo: CargoManifestItem[];
  snapshot: ShipSnapshot;
  sourceScenarioId: string | null;
  createdBy: string | null;
  createdAt: string;
}

function objectOrEmpty(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function cargoArray(value: unknown): CargoManifestItem[] {
  return Array.isArray(value) ? value as CargoManifestItem[] : [];
}

export function mapPlayerShipRow(row: any): PlayerShip {
  return {
    id: row.id,
    ownerId: row.owner_id || null,
    templateId: row.template_id,
    name: row.name || 'Ship',
    serialNumber: Number(row.serial_number) || 0,
    shipHp: Number(row.ship_hp) || 0,
    shipHpMax: Number(row.ship_hp_max) || 1,
    damage: objectOrEmpty(row.damage),
    crewState: objectOrEmpty(row.crew_state),
    cargo: cargoArray(row.cargo),
    deployedScenarioId: row.deployed_scenario_id || null,
    editorUserId: row.editor_user_id || null,
    editorHeartbeatAt: row.editor_heartbeat_at || null,
  };
}

export function mapPlayerShipVersionRow(row: any): PlayerShipVersion {
  return {
    id: row.id,
    playerShipId: row.player_ship_id,
    versionNumber: Number(row.version_number) || 0,
    name: row.name || 'Ship',
    shipHp: Number(row.ship_hp) || 0,
    damage: objectOrEmpty(row.damage),
    crewState: objectOrEmpty(row.crew_state),
    cargo: cargoArray(row.cargo),
    snapshot: row.snapshot as ShipSnapshot,
    sourceScenarioId: row.source_scenario_id || null,
    createdBy: row.created_by || null,
    createdAt: row.created_at || '',
  };
}
