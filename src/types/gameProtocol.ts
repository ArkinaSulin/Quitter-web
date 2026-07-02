// src/types/gameProtocol.ts

// --- Core Geometry ---
export interface Hex {
  q: number;
  r: number;
  s: number; // s = -q - r
}

// --- Unit Data (MVP subset) ---
export interface Unit {
  id: string;
  templateId?: string;
  name: string;
  hex: Hex;
  facing: number; // 0-5 (vertex index)
  team: 'blue' | 'yellow' | 'black' | 'violet';
  hp: number;
  maxHp: number;
  isHero: boolean;
  formation: 'Tight' | 'Loose' | 'Scattered' | 'Routed';
  // For MVP, we keep it simple.
}

// --- Web Worker Message Protocol ---
export type WorkerMessageType =
  | 'MOVE_UNIT'
  | 'ATTACK'
  | 'LOCK_UNIT'
  | 'UNLOCK_UNIT'
  | 'UNDO'
  | 'GET_STATE'
  | 'SYNC_STATE';

export interface WorkerMessage<T = any> {
  type: WorkerMessageType;
  payload: T;
  messageId?: string; // For request/response tracking
}

// --- Payloads for each message type ---
export interface MoveUnitPayload {
  unitId: string;
  targetHex: Hex;
  newFacing?: number; // optional, if you want to rotate at destination
}

export interface AttackPayload {
  attackerId: string;
  targetId: string;
}

export interface LockUnitPayload {
  unitId: string;
  lockedBy: string; // user ID
}

export interface UnlockUnitPayload {
  unitId: string;
}

export interface UndoPayload {
  // empty
}

// --- Worker Response ---
export interface WorkerResponse<T = any> {
  type: 'SUCCESS' | 'ERROR' | 'STATE_UPDATE';
  payload: T;
  messageId?: string;
  error?: string;
}

// --- Supabase Realtime Sync Events ---
export interface SyncEvent {
  type: 'UNIT_MOVED' | 'UNIT_ATTACKED' | 'UNIT_LOCKED' | 'UNIT_UNLOCKED';
  payload: any;
  timestamp: number;
  userId: string;
}