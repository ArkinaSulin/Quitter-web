// src/types/gameProtocol.ts

export const ORGANIZATION_LEVEL: Record<string, number> = {
  'Routed': 0,
  'Scattered': 0,
  'Hero': 0,
  'Open Order': 1,
  'Close Order': 2,
  'Phalanx': 3,
  'Shield Wall': 3,
};

export function getOrganizationLevel(formation: string): number {
  return ORGANIZATION_LEVEL[formation] ?? 0;
}

export type AllianceGroup = 'friendly' | 'enemy' | 'neutral';

export const ALLIANCE_COLORS: Record<AllianceGroup, string> = {
  friendly: '#0072B2',
  enemy: '#D55E00',
  neutral: '#E0E0E0',
};

// --- Core Geometry ---
export interface Hex {
  q: number;
  r: number;
  s: number; // s = -q - r
}

/** Cube-coordinate hex distance */
export function hexDistance(a: Hex, b: Hex): number {
  return Math.max(Math.abs(a.q - b.q), Math.abs(a.r - b.r), Math.abs(a.s - b.s));
}

// --- Weapon (stored as JSON) ---
export interface Weapon {
  name: string;
  attackBonus: number;
  targetType: 'single' | 'area';
  damageDice: string;
  range: number;        // hexes
  magicRadius: number;  // feet
  is_reach: boolean;    // weapon has reach (e.g., pike, lance)
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
  maxUnitHp: number;                  // was: unitHp (calculated: troopHp * troopCount)
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
  sizeCategory: number;               // 75 (Small), 100 (Medium), 200 (Large), 300 (Huge), 400 (Gargantuan)
  visualScale: number;                // 50-149
  formationAvailability: string[];
  equipCostGp: number;                // was: costGp
  weeklyCostGp: number;              // new
  customImageUrl?: string | null;
  unitTypeIconUrl?: string | null;
  canCharge: boolean;                 // new: override for race/mount can_charge
  ignoreMoraleChecks: boolean;        // unit never routs
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
  armorName: string;                  // new: copied from template
  mountId: string | null;
  mountName: string;                  // new: copied from template
  isHero: boolean;
  attachedToUnitId: string | null;    // new: hero attached to a unit
  attachedPosition: 'front' | 'back' | null; // new: hero's position on the host unit
  currentTroopCount: number;          // was: bodyCount
  maxTroopCount: number;              // was: maxBodyCount
  level: number;                      // new: copied from template
  troopHp: number;                     // was: maxHp (now renamed)
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
  currentMoraleModifier: number;
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
  isDeleted: boolean;                  // soft delete — reversed by undo
  ignoreMoraleChecks: boolean;         // unit never routs (undead, heroes, etc.)
  organizationLevel: number;           // computed from currentFormation via ORGANIZATION_LEVEL map
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
  currentTurnAlliance: AllianceGroup | null;
  turnNumber: number;
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
  ac_bonus: number;
  icon_url: string | null;
  base_hd: number;
  size_category: number;
  visual_scale: number;
  can_charge: boolean;               // new
}

export interface WeaponLookup {
  id: string;
  name: string;
  damage_dice: string;
  cost_gp: number;
  attack_bonus?: number;
  magic_radius?: number;
  range?: number;
  target_type?: string;
  is_reach?: boolean;
}

export interface Armor {
  id: string;
  name: string;
  ac_bonus: number;
  movement_penalty: number;
  cost_gp: number;
}

export interface SizeCategory {
  size_category: number;
  name: string;
  row_capacity: number;
  max_troops: number;
  max_troops_mounted: number;
}

export interface Formation {
  id: string;
  name: string;
  ac_modifier: number;
  movement_multiplier: number;
  attack_modifier: number;
  morale_modifier: number;
  row_capacity_multiplier: number;
  attack_capacity_multiplier: number;
}

export interface UnitType {
  id: string;
  name: string;
  isMounted: boolean;
  icon_url: string | null;
}

export interface Mount {
  id: string;
  name: string;
  speed: number;
  cost_gp: number;
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