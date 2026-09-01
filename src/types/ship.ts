// src/types/ship.ts
// Spelljammer ship-domain types. Mirrors the Shipyard v8.1 FINAL model.
// Source of truth: .scratch/shipyard-formula/shipyard.csv, .scratch/spelljammer-mod/spec.md,
// and the ship_* tables from migrations 066/067.

export type ShipPoolType = 'mass_x_boxhp' | 'small_anchor' | 'safe' | 'none';

export type ShipMount = 'small' | 'large' | 'special';

export type ShipEnvironment = 'space' | 'atmosphere';

/** Per-frame hull (migration 066 `ship_frames`). */
export interface ShipFrame {
  id: string;
  massCap: number;
  baseHp: number;
  deckSpace: number;
  topSpeed: number;
  maxRudders: number;
  baseCost: number;
  hullSpaces: number;
}

/** Armor option (`ship_armors`): mass_factor eats MassCap, box_hp sets box HP. */
export interface ShipArmor {
  id: string;
  massFactor: number;
  ac: number;
  boxHp: number;
  costMult: number;
}

/** Component (`ship_components`); `reinforce_order` = which Hull R reinforces it. */
export interface ShipComponent {
  id: string;
  mass: number;
  deck: number;
  crew: number;
  cost: number;
  reinforceOrder: number | null;
  hittable: boolean;
}

/** Accessory / special (`ship_accessories`); pool_type drives its hit-box pool. */
export interface ShipAccessory {
  id: string;
  mass: number;
  deck: number;
  crew: number;
  cost: number;
  poolType: ShipPoolType;
  hittable: boolean;
  effect: string | null;
}

/** Weapon catalog row (`ship_weapons`). */
export interface ShipWeapon {
  id: string;
  mount: ShipMount;
  damage: string;
  rangeStd: number;
  rangeDis: number | null;
  fireCycleRd: number;
  crew: number;
  cost: number;
  ammoCost: number | null;
  special: string | null;
}

/** Selected accessory instance on a template (`ship_template_accessories`). */
export interface ShipTemplateAccessory {
  accessoryId: string;
  count: number;
}

/** Weapon assignment (weapon + mount slot) on a template (`ship_template_weapons`). */
export interface ShipTemplateWeapon {
  weaponId: string;
  mountSlot: string;
  count: number;
}

/** A single crew member on a template (`ship_crews`). `name`/`cost` are optional (null). */
export interface ShipCrew {
  id: string;
  name: string | null;
  level: number;
  str: number;
  dex: number;
  con: number;
  int: number;
  wis: number;
  cha: number;
  cost: number | null;
}

/** A built ship template (`ship_templates` + its two join tables). */
export interface ShipTemplate {
  id: string;
  name: string;
  role: string | null;
  frameId: string;
  armorId: string;
  /** Authored Atmosphere speed (given, not calculated). */
  atmosphereSpeed: number;
  rudders: number;
  sails: number;
  lWeap: number;
  sWeap: number;
  hullR: number;
  bridge: number;
  auxHelm: number;
  extraCrew: number;
  /** Designated load (tons) — drives the laden readout. */
  cargoArea: number;
  accessories: ShipTemplateAccessory[];
  weapons: ShipTemplateWeapon[];
  crews: ShipCrew[];
  createdAt: string;
  updatedAt: string;
}
