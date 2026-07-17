// src/types/gameProtocol.ts

// --- Core Geometry ---
export interface Hex {
  q: number;
  r: number;
  s: number; // s = -q - r
}

// --- Weapon (stored as JSON in unit_templates.weapon_string) ---
export interface Weapon {
  name: string;
  attackBonus: number;
  targetType: 'single' | 'area';
  damageDice: string;
  range: number;        // hexes
  magicRadius: number;  // feet
  reach: boolean;       // weapon has reach (e.g., pike, lance)
  notes: string;        // descriptive notes (e.g., "Versatile", "Finesse")
}

// --- Unit Data (for game map) ---
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
  weaponString: string;   // JSON array of Weapon objects
  sizeCategory: number;   // 100, 200, 300, 400
  visualScale: number;    // 50-149
  customImageUrl?: string | null;
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
  raceBaseHd?: number | null;
  modelTypeId: string;
  modelTypeName?: string;
  modelTypeIconUrl?: string | null;
  isHero: boolean;
  // isPlayerHero removed
  bodyCount: number;
  level: number;
  hp: number;
  unitHp: number;
  attack: number;
  armorId: string;
  armorName?: string;
  isShielded: boolean;
  baseAc: number;
  weaponString: string;   // JSON array of Weapon objects
  mountId: string;
  mountName?: string;
  movementPoints: number;
  aggressiveness: number;
  baseMorale: number;
  sizeCategory: number;   // 100, 200, 300, 400
  visualScale: number;    // 50-149
  formationAvailability: string[];
  costGp: number;
  acSpecialModifier?: string;
  customImageUrl?: string | null;  // custom unit/hero image URL
  createdAt: string;
  updatedAt: string;
}

// --- Lookup Tables ---
export interface Race {
  id: string;
  name: string;
  defaultTroopScale: number; // legacy – will be removed; use visual_scale
  baseSpeed: number;
  acBonus: number;
  iconUrl: string | null;
  base_hd: number;
  size_category: number;    // 100, 200, 300, 400
  visual_scale: number;     // 50-149
}

export interface WeaponLookup {
  id: string;
  name: string;
  damageDice: string;
  notes: string | null;
  costGp: number;
  attackBonus?: number;
  magicRadius?: number;
  range?: number;
  targetType?: string;      // 'single' or 'area'
  reach?: boolean;
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

export interface UnitType {
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
  size_category: number;   // 100, 200, 300, 400
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