// src/types/ship.ts
// Spelljammer ship-domain types. Mass-first model (no ship frames): the player
// designates a total mass, pays a hull-mass penalty, then furnishes the rest.
// Source of truth: the 2026 Spelljammer overhaul rules + migration 134.

export type ShipMount = 'small' | 'large' | 'special';

/** Armor option (`ship_armors`): mass is a percentage of the ship total. */
export interface ShipArmor {
  id: string;
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
  mass: number;
  crew: number;
  cost: number;
  hittable: boolean;
  ac?: number;
  imageUrl?: string;
}

/** Accessory / special fitting (`ship_accessories`). */
export interface ShipAccessory {
  id: string;
  mass: number;
  crew: number;
  cost: number;
  hittable: boolean;
  effect: string | null;
  ac?: number;
  imageUrl?: string;
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
  ac?: number;
  imageUrl?: string;
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
  armorId: string;
  /** Player-designated ship mass (tons). Hull + armor + fittings come out of this. */
  totalMass: number;
  helm: number;
  commandBridge: number;
  sails: number;
  rudders: number;
  /** Hull reinforcement units (+10 temp HP each, assigned to a component). */
  reinforcement: number;
  /** Crew complement (current crew on board). */
  crewCount: number;
  /** Authored crew-quarters tonnage (1 ton = 5 capacity). */
  crewQuarters: number;
  /** Authored passenger count (display-only for now). */
  passengers: number;
  /** Authored weapon tonnage budget; weapons must fit inside it. */
  weaponCapacity: number;
  /** Authored atmospheric speed (0–12). */
  atmosphericSpeed: number;
  /** Authored damage threshold (default 15). */
  damageThreshold: number;
  /** Ship preview image (`ship_images` bucket). */
  imageUrl: string;
  /** Designated cargo (tons). */
  cargoArea: number;
  accessories: ShipTemplateAccessory[];
  weapons: ShipTemplateWeapon[];
  crews: ShipCrew[];
  createdAt: string;
  updatedAt: string;
}
