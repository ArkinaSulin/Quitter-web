// src/lib/commandLog.ts
// Command-log domain types shared by the engine hook, replay, and the undo
// debug panel. Moved here from src/game/GameEngine.ts when the client-side
// undo stack was removed (commands are now executed/undone/redone server-side
// via RPCs).

import { Unit, AllianceGroup } from '@/types/gameProtocol';

export type ActionType =
  | 'MOVE'
  | 'ROTATE'
  | 'FORMATION'
  | 'TEAM'
  | 'HIDE'
  | 'TOGGLE_HIDE'
  | 'PLACE'
  | 'ATTACK'
  | 'DAMAGE'
  | 'HEAL'
  | 'ROUT'
  | 'DELETE'
  | 'ALLIANCE'
  | 'ATTACH_HERO'
  | 'DETACH_HERO'
  | 'SWAP_HERO_POSITION'
  | 'END_TURN'
  | 'SCENARIO'
  | 'CHARGE'
  | 'CHARGE_END'
  | 'WEAPON_SELECT'
  | 'CAST'
  | 'EDIT_UNIT';

export interface UnitChange {
  field: string;
  from: any;
  to: any;
}

export interface SubStep {
  type: ActionType;
  description: string;
  unitId: string;
  changes: UnitChange[];
  /** Snapshot carried for replay (e.g. full unit on PLACE). Ignored by live apply. */
  payload?: unknown;
}

export interface CommandEntry {
  id: string;
  timestamp: number;
  playerId: string;
  playerName: string;
  scenarioId: string;
  actionType: ActionType;
  description: string;
  subSteps: SubStep[];
  chained: boolean;
}

/** Row shape as stored in the `command_log` table. */
export interface CommandLogRow {
  id: string;
  scenario_id: string;
  player_id: string;
  player_name: string;
  action_type: ActionType;
  description: string;
  sub_steps: SubStep[] | string;
  chained: boolean;
  created_at: string;
  deleted_at: string | null;
}

export function parseSubSteps(raw: SubStep[] | string): SubStep[] {
  if (Array.isArray(raw)) return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

export function rowToEntry(row: CommandLogRow): CommandEntry {
  return {
    id: row.id,
    timestamp: new Date(row.created_at).getTime(),
    playerId: row.player_id,
    playerName: row.player_name,
    scenarioId: row.scenario_id,
    actionType: row.action_type,
    description: row.description,
    subSteps: parseSubSteps(row.sub_steps),
    chained: row.chained,
  };
}

/** What `undo_state` returns for one side (undo or redo). */
export interface UndoStateInfo {
  ids: string[];
  count: number;
  description: string;
  playerName: string;
  canUndo: boolean;
}

export interface RedoStateInfo {
  ids: string[];
  count: number;
  description: string;
  playerName: string;
  canRedo: boolean;
}

/** Shape of the `undo_state` RPC result. */
export interface UndoState {
  undo: UndoStateInfo | null;
  redo: RedoStateInfo | null;
}

export type { Unit, AllianceGroup };
