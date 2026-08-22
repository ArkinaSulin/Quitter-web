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
  damageDice: string;
  range: number;        // hexes
  magicDimension: number;  // feet
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
  mountCanCharge?: boolean;           // from join (mount.can_charge)
  modelTypeId: string;
  modelTypeName?: string;
  modelTypeIconUrl?: string | null;
  isHero: boolean;
  troopCount: number;                 // was: bodyCount
  level: number;
  troopHp: number;                    // was: hp
  maxUnitHp: number;                  // was: unitHp (calculated: troopHp * troopCount)
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
  // Ability save bonuses (used by area-effect spells). Store the bonus directly.
  str: number;
  dex: number;
  con: number;
  int: number;
  wis: number;
  cha: number;
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
  isCharging: boolean;                 // mid-charge: rotate/formation locked, corridor move
  chargeDistance: number;              // hexes moved during the current charge (0 = not charged)
  organizationLevel: number;           // computed from currentFormation via ORGANIZATION_LEVEL map
  actionsAvailable: number;           // new: remaining actions for current turn
  activeWeaponIndex: number;           // index into weaponString of the active weapon (0 = first)
  // Ability save bonuses (used by area-effect spells). Store the bonus directly.
  str: number;
  dex: number;
  con: number;
  int: number;
  wis: number;
  cha: number;
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
  /** When false, no new players may join the room (existing players unaffected). */
  roomOpen: boolean;
  /** Admin who flagged this scenario for deletion (null = not flagged). */
  deleteRequestedBy: string | null;
  /** Display name snapshot of the requesting admin. */
  deleteRequestedByName: string | null;
  /** When the deletion request was made (90-day auto-delete grace starts here). */
  deleteRequestedAt: string | null;
}

// --- Participant ---
export type ScenarioRole = 'GM' | 'AssistGM' | 'SuperPlayer' | 'Player';

export interface Participant {
  id: string;
  scenarioId: string;
  userId: string;
  role: ScenarioRole;
  /** Team this player controls (null = unassigned → read-only). */
  team: string | null;
  joinedAt: string;
}

/** Row of the scenario_role_capabilities matrix (migration 030). */
export interface ScenarioRoleCapabilities {
  role: ScenarioRole;
  move_own_team: boolean;
  move_own_alliance: boolean;
  move_any_team: boolean;
  adjust_team_stats: boolean;
  adjust_alliance_stats: boolean;
  adjust_all_stats: boolean;
  view_own_team: boolean;
  view_own_alliance: boolean;
  view_any_team: boolean;
  assign_unit_team: boolean;
  change_unit_visibility: boolean;
  add_unit: boolean;
  choose_map: boolean;
  change_user_role: boolean;
  kick_player: boolean;
  close_room: boolean;
}

// --- Lookup Tables ---
export interface Race {
  id: string;
  name: string;
  base_speed: number;
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
  magic_dimension?: number;
  range?: number;
  max_range?: number;
  is_reach?: boolean;
  is_two_handed?: boolean;
  number_of_attacks?: number;
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
  melee_target_arcs: string[];
  ranged_target_arcs: string[];
  threat_arcs: string[];
  double_threat_arcs: string[];
  retaliate_arcs: { front: 'full' | 'rows' | 'none'; flank: 'full' | 'rows' | 'none'; rear: 'full' | 'rows' | 'none' };
  retaliate_vs_ranged: boolean;
  can_charge: boolean;
  stop_enemy_movement_arcs: string[];
  charge_through_arcs: string[];
  be_attacked_melee_modifier: number;
  be_attacked_range_modifier: number;
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