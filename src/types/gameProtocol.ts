// src/types/gameProtocol.ts

// --- Core Geometry ---
export interface Hex {
  q: number;
  r: number;
  s: number; // s = -q - r
}

// --- Weapon (stored as JSON) ---
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

// --- Unit Template (Master List / Blueprint) ---
export interface UnitTemplate {
  id: string;
  unitName: string;                   // was: name
  raceId: string;
  raceName?: string;                  // from join
  raceBaseHd?: number | null;         // from join
  raceIconUrl?: string;               // from join
  raceCanCharge?: boolean;            // from join (race.can_charge)
  modelTypeId: string;
  modelTypeName?: string;
  modelTypeIconUrl?: string | null;
  isHero: boolean;
  troopCount: number;                 // was: bodyCount
  level: number;
  troopHp: number;                    // was: hp
  unitHp: number;                     // was: unitHp (calculated: troopHp * troopCount)
  numberOfAttacks: number;            // was: attack
  armorId: string;
  armorName?: string;
  isShielded: boolean;
  baseAc: number;                     // from race (kept in template)
  baselineAc: number;                 // new: AC after equipment (enters battle with this)
  weaponString: string;
  mountId: string;
  mountName?: string;
  movementPoints: number;
  aggressiveness: number;
  baseMorale: number;
  sizeCategory: number;               // 100, 200, 300, 400
  visualScale: number;                // 50-149
  formationAvailability: string[];
  equipCostGp: number;                // was: costGp
  weeklyCostGp: number;              // new
  customImageUrl?: string | null;
  unitTypeIconUrl?: string | null;
  canCharge: boolean;                 // new: override for race/mount can_charge
//  acSpecialModifier?: string;
  createdAt: string;
  updatedAt: string;
}

// --- Unit (Instance on the battlefield) ---
export interface Unit {
  id: string;
  scenarioId: string;
  templateId: string | null;
  unitName: string;                   // was: name
  raceId: string;                     // new: copied from template
  raceName: string;                   // new: copied from template
  armorId: string;                    // new: copied from template
  armorName: string;                  // new: copied from template
  mountId: string | null;
  mountName: string;                  // new: copied from template
  isHero: boolean;
  troopCount: number;                 // was: bodyCount
  maxTroopCount: number;              // was: maxBodyCount
  level: number;                      // new: copied from template
  unitHp: number;                     // was: maxHp (now renamed)
  maxUnitHp: number;                  // was: maxHp (renamed)
  currentUnitHp: number;              // was: hp (renamed)
  numberOfAttacks: number;            // was: attack
  isShielded: boolean;
  baselineAc: number;                 // new: AC after equipment (copied from template)
  currentAc: number;                  // dynamic battlefield AC
  weaponString: string;
  movementPoints: number;             // max movement (copied from template)
  movementPointsAvailable: number;    // new: remaining for current turn
  aggressiveness: number;
  baseMorale: number;
  currentMorale: number;
  sizeCategory: number;
  visualScale: number;
  currentFormation: string;           // was: formation
  formationAvailability: string[];
  equipCostGp: number;                // was: costGp
  raceIconUrl?: string;
  unitTypeIconUrl?: string;
  customImageUrl?: string;
  canCharge: boolean;                 // new: calculated from race.canCharge || mount.canCharge
  hex: Hex;
  facing: number;
  team: string;
  isRouting: boolean;
  hidden: boolean;
  actionsAvailable: number;           // new: remaining actions for current turn
}

// --- Scenario ---
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

// --- Participant ---
export interface Participant {
  id: string;
  scenarioId: string;
  userId: string;
  role: 'GM' | 'AssistGM' | 'SuperPlayer' | 'Player';
  joinedAt: string;
}

// --- Lookup Tables ---
export interface Race {
  id: string;
  name: string;
  defaultTroopScale: number;
  baseSpeed: number;
  acBonus: number;
  iconUrl: string | null;
  base_hd: number;
  size_category: number;
  visual_scale: number;
  can_charge: boolean;               // new
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
  targetType?: string;
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
  size_category: number;
  can_charge: boolean;               // new
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

export interface WorkerResponse<T = any> {
  type: 'SUCCESS' | 'ERROR' | 'STATE_UPDATE';
  payload: T;
  messageId?: string;
  error?: string;
}

export interface SyncEvent {
  type: 'UNIT_MOVED' | 'UNIT_ATTACKED' | 'UNIT_LOCKED' | 'UNIT_UNLOCKED';
  payload: any;
  timestamp: number;
  userId: string;
}