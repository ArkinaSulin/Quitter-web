// src/types/ship.ts
// Spelljammer ship-domain types. Mass-first model (no ship frames): the player
// designates a total mass, pays a hull-mass penalty, then furnishes the rest.
// Ship catalogs use UUID ids + a unique `name` (migration 137).

export type ShipCatalogKind = 'component' | 'weapon';

/** Armor option (`ship_armors`): mass is a percentage of the ship total. */
export interface ShipArmor {
  id: string;
  name: string;
  /** Mass fraction of total ship mass (0.05 = 5%). */
  massPct: number;
  ac: number;
  /** HP multiplier (ceramic/stone = 2, everything else = 1). */
  hpMult: number;
  imageUrl?: string;
}

/** Component catalog row (`ship_components`). */
export interface ShipComponent {
  id: string;
  name: string;
  mass: number;
  crew: number;
  cost: number;
  hittable: boolean;
  effect: string | null;
  dt: number;
  /** Built-in rule component (hull/helm/.../weapon_capacity); optional rows are false. */
  builtIn: boolean;
  /** True = one aggregate card; false = one card per unit. */
  canCombine: boolean;
  ac?: number;
  /** True for the two ram components (piercing/bludgeoning). */
  isRam?: boolean;
  imageUrl?: string;
}

export type ShipAreaShape = 'circle' | 'cube' | 'cone' | 'line';
export type ShipSaveChoice = 'Str' | 'Dex' | 'Con' | 'Int' | 'Wis' | 'Cha' | 'none';

/** Weapon catalog row (`ship_weapons`). */
export interface ShipWeapon {
  id: string;
  name: string;
  mass: number;
  damage: string;
  /** Optional mass-scaled damage formula, e.g. `{mass/10}d10`. */
  damageFormula: string | null;
  minRange: number;
  range: number;
  maxRange: number;
  /** Steps needed to reload: 0 = fire every step, 4 = fire on step 5. */
  reloadSteps: number;
  dt: number;
  crew: number;
  cost: number;
  ammoCost: number | null;
  /** Area-effect footprint (0 = single target); mirrors spell AoE. */
  magicDimension: number;
  shape: ShipAreaShape;
  savingThrow: ShipSaveChoice;
  saveDC: number;
  onSaveHalfOrNeg: boolean;
  /** Free-form weapon note. */
  special: string | null;
  ac?: number;
  imageUrl?: string;
}

/** Unified row shape used by the Component Workshop list/form. */
export interface ShipComponentTemplate {
  id: string;
  kind: ShipCatalogKind;
  name: string;
  mass: number;
  crew: number;
  hittable: boolean;
  cost: number;
  effect: string;
  builtIn: boolean;
  canCombine: boolean;
  dt: number;
  damage: string;
  damageFormula: string;
  minRange: number;
  range: number;
  maxRange: number;
  reloadSteps: number;
  magicDimension: number;
  shape: ShipAreaShape;
  savingThrow: ShipSaveChoice;
  saveDC: number;
  onSaveHalfOrNeg: boolean;
  special: string;
  ac: number;
  imageUrl: string;
  isRam: boolean;
}

/** Selected optional component on a template (`ship_template_components`). */
export interface ShipTemplateComponent {
  componentId: string;
  count: number;
}

/** Weapon assignment on a template (`ship_template_weapons`). */
export interface ShipTemplateWeapon {
  /** Stable row id; the layout card key is `weapon:<id>`. */
  id: string;
  weaponId: string;
  count: number;
}

export type ShipDeckRegion = 'bow' | 'stern' | 'port' | 'body' | 'starboard';

export type WeaponArc = 'bow' | 'port' | 'starboard' | 'stern';

export interface WeaponArcOverrides {
  added?: WeaponArc[];
  removed?: WeaponArc[];
}

export type ShipWeaponArcMap = Record<string, WeaponArcOverrides>;

/** One deck slot. */
export interface ShipDeckSlot {
  cardKey: string | null;
}

/** Deck region containers. Middle regions can grow when all slots are full. */
export interface ShipDeckLayout {
  /** 2 = current Bow4/Body8 shape; absent = legacy layout to reshape. */
  version?: number;
  bow: ShipDeckSlot[];
  stern: ShipDeckSlot[];
  port: ShipDeckSlot[];
  body: ShipDeckSlot[];
  starboard: ShipDeckSlot[];
}

/** A single crew member on a template (`ship_crews`). */
export interface ShipCrew {
  id: string;
  name: string | null;
  level: number;
  hp: number;
  str: number;
  dex: number;
  con: number;
  int: number;
  wis: number;
  cha: number;
  /** Weekly cost in gp. */
  cost: number;
}

/** A built ship template (`ship_templates` + its two join tables). */
export interface ShipTemplate {
  id: string;
  name: string;
  role: string | null;
  /** UUID from ship_armors. */
  armorId: string;
  /** Player-designated ship mass (tons). Hull + armor + fittings come out of this. */
  totalMass: number;
  helm: number;
  commandBridge: number;
  sails: number;
  rudders: number;
  /** Hull reinforcement units (+10 temp HP each, assigned to a component). */
  reinforcement: number;
  /** Authored crew-quarters mass (1 ton = 5 capacity). */
  crewQuarters: number;
  /** Authored weapon capacity mass; placed weapons must fit inside it. */
  weaponCapacity: number;
  /** Region-container deck layout. Empty until the editor syncs purchases. */
  deckLayout: ShipDeckLayout;
  /** Card keys carrying a reinforcement. */
  reinforcements: string[];
  /** Per weapon-card firing-arc overrides. */
  weaponArcs: ShipWeaponArcMap;
  /** Authored atmospheric speed (0–12). */
  atmosphericSpeed: number;
  /** Authored damage threshold (default 15). */
  damageThreshold: number;
  /** Ship preview image (`ship_images` bucket). */
  imageUrl: string;
  /** Authored keel length in feet (image scales to this height). */
  keelLength: number;
  /** Image vertical offset in feet; positive = up, negative = down. */
  imageOffsetY: number;
  /** Designated cargo (tons). */
  cargoArea: number;
  optionalComponents: ShipTemplateComponent[];
  weapons: ShipTemplateWeapon[];
  crews: ShipCrew[];
  createdAt: string;
  updatedAt: string;
}
