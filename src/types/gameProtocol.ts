// src/types/gameProtocol.ts

// --- Core Geometry ---
export interface Hex {
  q: number;
  r: number;
  s: number; // s = -q - r
}

// --- Weapon (parsed from weaponString) ---
export interface Weapon {
  name: string;
  targetType: 'single' | 'area';
  damageDice: string;
  range: number;  // 1 = adjacent (melee), >1 = ranged
}

// --- Unit Data ---
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
  formation: 'Tight' | 'Loose' | 'Scattered' | 'Routed' | 'Phalanx' | 'Shield Wall';
  aggressiveness: number;
  baseMorale: number;
  currentMorale: number;
  baseAc: number;
  currentAc: number;
  isRouting: boolean;
  weaponString: string;  // NEW
}

// --- Scenario & Participants ---
export interface Scenario {
  id: string;
  name: string;
  creatorId: string;
  creatorName: string;
  passwordHash?: string;
  mapData?: any;
  createdAt: string;
  updatedAt: string;
  screenshotUrl: string | null;
}

export interface Participant {
  id: string;
  scenarioId: string;
  userId: string;
  role: 'GM' | 'AssistGM' | 'SuperPlayer' | 'Player';
  joinedAt: string;
}

// --- Unit Template (Master List) ---
export interface UnitTemplate {
  id: string;
  name: string;
  raceId: string;
  raceName?: string;
  modelTypeId: string;
  modelTypeName?: string;
  isHero: boolean;
  isPlayerHero: boolean;
  bodyCount: number;
  level: number;
  hp: number;
  armorId: string;
  armorName?: string;
  isShielded: boolean;
  baseAc: number;
  weaponString: string;  // NEW
  mountId: string;
  mountName?: string;
  movementPoints: number;
  aggressiveness: number;
  baseMorale: number;
  troopScale: number;
  formationAvailability: string[];
  costGp: number;
  acSpecialModifier: string;
  createdAt: string;
  updatedAt: string;
}

// --- Lookup Tables ---
export interface Race {
  id: string;
  name: string;
  defaultTroopScale: number;
  baseSpeed: number;
  acBonus: number;
  iconUrl: string | null;
}

export interface WeaponLookup {
  id: string;
  name: string;
  damageDice: string;
  special: string | null;
  costGp: number;
}

export interface Armor {
  id: string;
  name: string;
  acBonus: number;
  movementPenalty: number;
  costGp: number;
}

export interface Formation {
  id: string;
  name: string;
  acModifier: number;
  movementModifier: number;
  attackModifier: number;
}

export interface ModelType {
  id: string;
  name: string;
  isMounted: boolean;
  iconUrl: string | null;
}

export interface Mount {
  id: string;
  name: string;
  speed: number;
  costGp: number;
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
  messageId?: string;
}

// --- Payloads for each message type ---
export interface MoveUnitPayload {
  unitId: string;
  targetHex: Hex;
  newFacing?: number;
}

export interface AttackPayload {
  attackerId: string;
  targetId: string;
}

export interface LockUnitPayload {
  unitId: string;
  lockedBy: string;
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