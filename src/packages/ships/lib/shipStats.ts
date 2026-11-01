// src/packages/ships/lib/shipStats.ts
// Pure Spelljammer mass-first formulas (2026 overhaul). Shared by the Ship Editor
// and (later) the ship engine — every value here is a pure function of the build.
//
// Model facts encoded below:
//  - The player designates a TOTAL ship mass. Hull and armor are paid out of it:
//      hullMass  = totalMass × (10% + totalMass / 500)
//      armorMass = totalMass × armor.massPct
//    The rest is furnished with components, weapons, cargo and crew quarters.
//  - HP = totalMass × 3 + 40, multiplied by the armor's HP multiplier (×2).
//  - Acceleration = (sails + rudders) / totalMass × 15 (counts, not masses).
//  - MC = x = rudders × 10 / totalMass; if x < 1 then 1/x + 2 else 4 − x.
//    Effective MC adds a speed band: −1 at speed 0–2, 0 at 3–7, +1 at 8–12.
//  - Hit boxes: 1 ton = 1 box. Boxes carry no HP; each hit destroys one box.
//    Hull + armor are safe. Reinforcement is +10 temp HP per unit (assigned later).
//  - Crew quarters are authored in tons (1 ton = 5 crew + 28 days of supplies).

import {
  ShipArmor,
  ShipComponent,
  ShipCrew,
  ShipDeckLayout,
  ShipTemplateComponent,
  ShipTemplateWeapon,
  ShipWeapon,
} from '@/types/ship';

export const MAX_SHIP_SPEED = 12;
export const DEFAULT_TOTAL_MASS = 20;
export const HULL_MASS_BASE_PCT = 0.1;
export const HULL_MASS_DIVISOR = 500;
export const HP_PER_TON = 3;
export const HP_BASE = 40;
export const ACCEL_SCALE = 15;
export const MC_RUDDER_SCALE = 10;
export const CREW_PER_QUARTER_TON = 5;
export const REINFORCEMENT_TEMP_HP = 10;
export const COMMAND_PER_BRIDGE = 5;
export const HULL_COST_PER_TON = 1000;
export const CREW_BASE_HP = 10;
export const CREW_HP_PER_LEVEL = 7;
export const CREW_WEEKLY_COST_FACTOR = 2;
export const CREW_WEEKLY_COST_FLAT = 2;
export const SHIP_WEEKLY_OPERATION_FRACTION = 0.004;

/** Default stat line for new crew. */
export const DEFAULT_CREW_STATS = {
  str: 12,
  dex: 14,
  con: 14,
  int: 10,
  wis: 14,
  cha: 10,
} as const;

/** Built-in component names (ship_components.name). */
export const COMPONENT_NAMES = {
  hull: 'Hull',
  helm: 'Helm',
  commandBridge: 'Command bridge',
  sail: 'Sail',
  rudder: 'Rudder',
  reinforcement: 'Reinforcement',
  cargo: 'Cargo',
  crewQuarters: 'Crew quarters',
  weaponCapacity: 'Weapon capacity',
} as const;

const DEFAULT_COMPONENTS: Record<string, ShipComponent> = {
  [COMPONENT_NAMES.hull]: { id: 'Hull', name: 'Hull', mass: 0, crew: 0, cost: 0, hittable: false, effect: null, builtIn: true, canCombine: true, dt: 15, ac: 10, imageUrl: '' },
  [COMPONENT_NAMES.helm]: { id: 'Helm', name: 'Helm', mass: 1, crew: 1, cost: 0, hittable: true, effect: null, builtIn: true, canCombine: false, dt: 15 },
  [COMPONENT_NAMES.commandBridge]: { id: 'Command bridge', name: 'Command bridge', mass: 3, crew: 5, cost: 0, hittable: true, effect: null, builtIn: true, canCombine: false, dt: 15 },
  [COMPONENT_NAMES.sail]: { id: 'Sail', name: 'Sail', mass: 1, crew: 0, cost: 0, hittable: true, effect: null, builtIn: true, canCombine: true, dt: 15 },
  [COMPONENT_NAMES.rudder]: { id: 'Rudder', name: 'Rudder', mass: 1.5, crew: 0.5, cost: 0, hittable: true, effect: null, builtIn: true, canCombine: true, dt: 15 },
  [COMPONENT_NAMES.reinforcement]: { id: 'Reinforcement', name: 'Reinforcement', mass: 1, crew: 0, cost: 0, hittable: true, effect: null, builtIn: true, canCombine: true, dt: 15 },
  [COMPONENT_NAMES.cargo]: { id: 'Cargo', name: 'Cargo', mass: 1, crew: 0, cost: 0, hittable: true, effect: null, builtIn: true, canCombine: true, dt: 15 },
  [COMPONENT_NAMES.crewQuarters]: { id: 'Crew quarters', name: 'Crew quarters', mass: 1, crew: 5, cost: 0, hittable: true, effect: null, builtIn: true, canCombine: true, dt: 15 },
  [COMPONENT_NAMES.weaponCapacity]: { id: 'Weapon capacity', name: 'Weapon capacity', mass: 1, crew: 0, cost: 0, hittable: true, effect: 'Weapon capacity', builtIn: true, canCombine: true, dt: 15 },
};

const EMPTY_COMPONENT: ShipComponent = {
  id: '', name: '', mass: 0, crew: 0, cost: 0, hittable: true, effect: null, builtIn: false, canCombine: true, dt: 15,
};

export function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

export function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

/** Mass is allocated in whole tons (the templates round each group). */
export function roundTons(v: number): number {
  return Math.round(v);
}

export function componentByName(components: ShipComponent[], name: string): ShipComponent {
  return (
    components.find(c => c.name === name && c.builtIn) ||
    components.find(c => c.name === name) ||
    DEFAULT_COMPONENTS[name] ||
    EMPTY_COMPONENT
  );
}

export function componentById(components: ShipComponent[], id: string): ShipComponent {
  return components.find(c => c.id === id) || EMPTY_COMPONENT;
}

export function weaponById(weapons: ShipWeapon[], id: string): ShipWeapon | undefined {
  return weapons.find(w => w.id === id);
}

/** Tons taken by one weapon installation (authored mass). */
export function weaponTons(weapon: ShipWeapon): number {
  return Math.max(0, weapon.mass);
}

/** All inputs the formulas need for one build. */
export interface ShipBuild {
  armor: ShipArmor;
  components: ShipComponent[];
  weaponsCatalog: ShipWeapon[];
  totalMass: number;
  helm: number;
  commandBridge: number;
  sails: number;
  rudders: number;
  reinforcement: number;
  crewQuarters: number;
  /** Authored weapon capacity (tons). Falls back to placed weapon tons. */
  weaponCapacity?: number;
  atmosphericSpeed?: number;
  damageThreshold?: number;
  cargoArea: number;
  templateComponents: ShipTemplateComponent[];
  templateWeapons: ShipTemplateWeapon[];
  /** Template roster used for the non-functional card crew preview. */
  crews?: ShipCrew[];
  /** Region-container deck layout. */
  deckLayout?: ShipDeckLayout;
  /** Card keys carrying a reinforcement. */
  reinforcements?: string[];
  /** Transient cargo-simulation mass; falls back to totalMass when absent. */
  performanceMass?: number;
}

// --- Crew -------------------------------------------------------------------

/** Generic crew HP default: 10 + 7 per level above 1. */
export function computeCrewHp(level: number): number {
  const lvl = Math.max(1, Math.floor(Number.isFinite(level) ? level : 1));
  return CREW_BASE_HP + CREW_HP_PER_LEVEL * (lvl - 1);
}

/** Default weekly crew cost in gp: level² × 2 + 2. */
export function computeCrewWeeklyCost(level: number): number {
  const lvl = Math.max(1, Math.floor(Number.isFinite(level) ? level : 1));
  return lvl * lvl * CREW_WEEKLY_COST_FACTOR + CREW_WEEKLY_COST_FLAT;
}

/** Actual crew on board = roster length. */
export function computeCrew(build: ShipBuild): number {
  return Math.max(0, build.crews?.length ?? 0);
}

/** Weapon crew, rounded up per weapon installation. */
export function computeWeaponCrew(build: ShipBuild): number {
  return build.templateWeapons.reduce((sum, w) => {
    const weapon = weaponById(build.weaponsCatalog, w.weaponId);
    return sum + (weapon ? Math.ceil(weapon.crew * w.count) : 0);
  }, 0);
}

/** Optional-component crew, rounded up per installation. */
export function computeOptionalComponentCrew(build: ShipBuild): number {
  return build.templateComponents.reduce((sum, row) => {
    const component = componentById(build.components, row.componentId);
    return sum + Math.ceil(component.crew * row.count);
  }, 0);
}

/**
 * Σ built-in component + optional component crew requirements.
 * Weapon handling crew is deliberately excluded: it is not needed for
 * spelljamming. Each component group is rounded up separately.
 */
export function computeComponentCrew(build: ShipBuild): number {
  const c = build.components;
  return (
    Math.ceil(build.helm * componentByName(c, COMPONENT_NAMES.helm).crew) +
    Math.ceil(build.commandBridge * componentByName(c, COMPONENT_NAMES.commandBridge).crew) +
    Math.ceil(build.sails * componentByName(c, COMPONENT_NAMES.sail).crew) +
    Math.ceil(build.rudders * componentByName(c, COMPONENT_NAMES.rudder).crew) +
    computeOptionalComponentCrew(build)
  );
}

/** Minimum crew to operate the ship — already whole after per-group rounding. */
export function computeMinCrew(build: ShipBuild): number {
  return computeComponentCrew(build);
}

/**
 * Full crew is the larger of two shifts of the minimum crew and the minimum
 * plus all weapon handling crew.
 */
export function computeFullCrew(build: ShipBuild): number {
  const min = computeMinCrew(build);
  return Math.max(min * 2, min + computeWeaponCrew(build));
}

/** Total weekly cost of the current crew roster. */
export function computeCrewWeeklyCostTotal(build: ShipBuild): number {
  return (build.crews ?? []).reduce((sum, crew) => sum + crew.cost, 0);
}

/** Weekly operation cost = 0.4% of ship cost + roster weekly cost. */
export function computeWeeklyOperationCost(build: ShipBuild): number {
  return Math.round(computeBuildCost(build) * SHIP_WEEKLY_OPERATION_FRACTION + computeCrewWeeklyCostTotal(build));
}

/** Authored crew-quarters capacity (1 ton = 5 crew). */
export function computeCrewCapacity(crewQuarters: number): number {
  const tons = Number.isFinite(crewQuarters) ? crewQuarters : 0;
  return Math.max(0, tons) * CREW_PER_QUARTER_TON;
}

// --- Mass -------------------------------------------------------------------

/** Hull mass paid out of the designated total mass. */
export function computeHullMass(totalMass: number): number {
  const m = Math.max(0, totalMass);
  return m * (HULL_MASS_BASE_PCT + m / HULL_MASS_DIVISOR);
}

/** Armor mass = % of the designated total mass. */
export function computeArmorMass(build: ShipBuild): number {
  return Math.max(0, build.totalMass) * build.armor.massPct;
}

export function computeOptionalComponentMass(build: ShipBuild): number {
  return build.templateComponents.reduce((sum, row) => {
    const component = componentById(build.components, row.componentId);
    return sum + component.mass * row.count;
  }, 0);
}

/** Actual placed weapon mass (authored mass × count). */
export function computeWeaponMass(build: ShipBuild): number {
  return build.templateWeapons.reduce((sum, w) => {
    const weapon = weaponById(build.weaponsCatalog, w.weaponId);
    return sum + (weapon ? weaponTons(weapon) * w.count : 0);
  }, 0);
}

/**
 * Mass allocated to weapons. The authored capacity is paid for even when fewer
 * weapons are placed; old data with no capacity falls back to the placed mass.
 */
export function computeWeaponCapacity(build: ShipBuild): number {
  const authored = Math.max(0, build.weaponCapacity ?? 0);
  return authored > 0 ? authored : computeWeaponMass(build);
}

/** True when one more weapon (in tons) fits inside the allocated capacity. */
export function canPlaceWeapon(placedTons: number, capacityTons: number, newTons: number): boolean {
  return placedTons + newTons <= capacityTons;
}

export interface ShipMassBreakdown {
  hull: number;
  armor: number;
  helm: number;
  commandBridge: number;
  sails: number;
  rudders: number;
  weapons: number;
  reinforcement: number;
  optionalComponents: number;
  cargo: number;
  crewQuarters: number;
  used: number;
  remaining: number;
}

/**
 * Whole-ton mass allocation. Every group is rounded to the nearest ton, which
 * is what makes the reference rows sum exactly to their total mass.
 */
export function computeMassBreakdown(build: ShipBuild): ShipMassBreakdown {
  const c = build.components;
  const hull = roundTons(computeHullMass(build.totalMass));
  const armor = roundTons(computeArmorMass(build));
  const helm = roundTons(build.helm * componentByName(c, COMPONENT_NAMES.helm).mass);
  const commandBridge = roundTons(build.commandBridge * componentByName(c, COMPONENT_NAMES.commandBridge).mass);
  const sails = roundTons(build.sails * componentByName(c, COMPONENT_NAMES.sail).mass);
  const rudders = roundTons(build.rudders * componentByName(c, COMPONENT_NAMES.rudder).mass);
  const weapons = roundTons(computeWeaponCapacity(build));
  const reinforcement = roundTons(build.reinforcement * componentByName(c, COMPONENT_NAMES.reinforcement).mass);
  const optionalComponents = roundTons(computeOptionalComponentMass(build));
  const cargo = Math.max(0, roundTons(build.cargoArea || 0));
  const crewQuarters = Math.max(0, roundTons(build.crewQuarters || 0));
  const used =
    hull + armor + helm + commandBridge + sails + rudders + weapons +
    reinforcement + optionalComponents + cargo + crewQuarters;
  return {
    hull,
    armor,
    helm,
    commandBridge,
    sails,
    rudders,
    weapons,
    reinforcement,
    optionalComponents,
    cargo,
    crewQuarters,
    used,
    remaining: Math.max(0, build.totalMass) - used,
  };
}

/** Built-in + optional components + weapons + cargo + crew quarters (rounded tons). */
export function computeFittingMass(build: ShipBuild): number {
  const m = computeMassBreakdown(build);
  return m.used - m.hull - m.armor;
}

/** Everything currently assigned to the hull (rounded tons). */
export function computeUsedMass(build: ShipBuild): number {
  return computeMassBreakdown(build).used;
}

/** Tons left to furnish (negative = overloaded). */
export function computeRemainingMass(build: ShipBuild): number {
  return computeMassBreakdown(build).remaining;
}

// --- Performance ------------------------------------------------------------

export function computeArmorClass(build: ShipBuild): number {
  return build.armor.ac;
}

/** HP = totalMass × 3 + 40, multiplied by the armor's HP multiplier. */
export function computeShipHp(build: ShipBuild): number {
  const base = Math.round(Math.max(0, build.totalMass) * HP_PER_TON + HP_BASE);
  return base * Math.max(1, build.armor.hpMult);
}

/** Mass used for performance: cargo-simulation override or the designated total. */
export function performanceMassOf(build: ShipBuild): number {
  return Math.max(1, build.performanceMass ?? build.totalMass);
}

/** Acceleration = (sails + rudders) / performanceMass × 15 (counts). */
export function computeAccel(build: ShipBuild): number {
  const mass = performanceMassOf(build);
  return round1(((build.sails + build.rudders) / mass) * ACCEL_SCALE);
}

/** Raw MC: x = rudders × 10 / performanceMass; x < 1 → 1/x + 2, else 4 − x. */
export function computeMCRaw(build: ShipBuild): number {
  const mass = performanceMassOf(build);
  const x = (Math.max(0, build.rudders) * MC_RUDDER_SCALE) / mass;
  if (x <= 0) return Number.POSITIVE_INFINITY;
  const mc = x < 1 ? 1 / x + 2 : 4 - x;
  return Math.max(0, round1(mc));
}

/** Speed band modifier added to MC. */
export function mcSpeedModifier(speed: number): number {
  if (speed <= 2) return -1;
  if (speed <= 7) return 0;
  return 1;
}

/** Effective MC at a speed (floored at 0; the Racer has base MC 0). */
export function computeEffectiveMC(build: ShipBuild, speed: number): number {
  const raw = computeMCRaw(build);
  if (!Number.isFinite(raw)) return Number.POSITIVE_INFINITY;
  return Math.max(0, round1(raw + mcSpeedModifier(speed)));
}

export interface MCBand {
  label: string;
  speedMin: number;
  speedMax: number;
  mc: number;
}

/** The three speed bands from the overhaul rules. */
export function computeMCBands(build: ShipBuild): MCBand[] {
  return [
    { label: 'Speed 0–2', speedMin: 0, speedMax: 2, mc: computeEffectiveMC(build, 0) },
    { label: 'Speed 3–7', speedMin: 3, speedMax: 7, mc: computeEffectiveMC(build, 3) },
    { label: 'Speed 8–12', speedMin: 8, speedMax: 12, mc: computeEffectiveMC(build, 8) },
  ];
}

/** Command bonus from command bridges (+5 each). */
export function computeCommandBonus(build: ShipBuild): number {
  return build.commandBridge * COMMAND_PER_BRIDGE;
}

// --- Hit boxes --------------------------------------------------------------

export interface ShipBoxGroup {
  id: string;
  label: string;
  boxes: number;
  safe: boolean;
}

function boxGroupsFromMass(m: ShipMassBreakdown, hullSafe = true): ShipBoxGroup[] {
  const groups: ShipBoxGroup[] = [
    { id: 'hull', label: 'Hull', boxes: m.hull, safe: hullSafe },
    { id: 'armor', label: 'Armor', boxes: m.armor, safe: true },
    { id: 'helm', label: 'Helm', boxes: m.helm, safe: false },
    { id: 'command_bridge', label: 'Command bridge', boxes: m.commandBridge, safe: false },
    { id: 'sails', label: 'Sails', boxes: m.sails, safe: false },
    { id: 'rudders', label: 'Rudders', boxes: m.rudders, safe: false },
    { id: 'weapons', label: 'Weapons', boxes: m.weapons, safe: false },
    { id: 'reinforcement', label: 'Reinforcement', boxes: m.reinforcement, safe: false },
    { id: 'optional_components', label: 'Components', boxes: m.optionalComponents, safe: false },
    { id: 'cargo', label: 'Cargo', boxes: m.cargo, safe: false },
    { id: 'crew_quarters', label: 'Crew quarters', boxes: m.crewQuarters, safe: false },
  ].filter(g => g.boxes > 0);

  if (m.remaining > 0) {
    groups.push({ id: 'reserve', label: 'Reserve', boxes: m.remaining, safe: false });
  }
  return groups;
}

/** 1 ton = 1 box. Armor is safe; Hull safety follows its catalog hittable flag. */
export function computeBoxGroups(build: ShipBuild): ShipBoxGroup[] {
  const hull = componentByName(build.components, COMPONENT_NAMES.hull);
  return boxGroupsFromMass(computeMassBreakdown(build), !hull.hittable);
}

// --- Cost -------------------------------------------------------------------

/** Hull cost is 1000 gp per ton of designated ship mass. */
export function computeHullCost(totalMass: number): number {
  return Math.max(0, totalMass) * HULL_COST_PER_TON;
}

/** Actual cost of every placed weapon installation. */
export function computeWeaponCost(build: ShipBuild): number {
  return build.templateWeapons.reduce(
    (sum, w) => sum + (weaponById(build.weaponsCatalog, w.weaponId)?.cost || 0) * w.count,
    0,
  );
}

export function computeBuildCost(build: ShipBuild): number {
  const c = build.components;
  const quarters = Math.max(0, build.crewQuarters || 0);
  const capacity = computeWeaponCapacity(build);
  const capacityComponent = componentByName(c, COMPONENT_NAMES.weaponCapacity);
  const componentCost =
    computeHullCost(build.totalMass) +
    Math.max(0, build.helm - 1) * componentByName(c, COMPONENT_NAMES.helm).cost +
    build.commandBridge * componentByName(c, COMPONENT_NAMES.commandBridge).cost +
    build.sails * componentByName(c, COMPONENT_NAMES.sail).cost +
    build.rudders * componentByName(c, COMPONENT_NAMES.rudder).cost +
    build.reinforcement * componentByName(c, COMPONENT_NAMES.reinforcement).cost +
    Math.max(0, build.cargoArea) * componentByName(c, COMPONENT_NAMES.cargo).cost +
    quarters * componentByName(c, COMPONENT_NAMES.crewQuarters).cost +
    capacity * capacityComponent.cost;
  const optionalComponentCost = build.templateComponents.reduce((sum, row) => {
    const component = componentById(build.components, row.componentId);
    return sum + component.cost * row.count;
  }, 0);
  return Math.round(componentCost + optionalComponentCost + computeWeaponCost(build));
}

// --- Aggregate --------------------------------------------------------------

export interface ShipDerivedStats {
  totalMass: number;
  /** Whole-ton hull allocation (the exact formula value is `hullMassExact`). */
  hullMass: number;
  hullMassExact: number;
  armorMass: number;
  armorMassExact: number;
  fittingMass: number;
  weaponMass: number;
  weaponCapacity: number;
  weaponPlacedTons: number;
  weaponCrew: number;
  atmosphericSpeed: number;
  damageThreshold: number;
  usedMass: number;
  remainingMass: number;
  overload: boolean;
  crew: number;
  minCrew: number;
  fullCrew: number;
  /** Authored crew-quarters mass. */
  crewQuarters: number;
  /** `crewQuarters × 5`. */
  crewCapacity: number;
  /** Roster weekly cost total. */
  crewWeeklyCost: number;
  /** 0.4% of ship cost + roster weekly cost, rounded to whole gp. */
  weeklyOperationCost: number;
  /** Cargo-simulation mass used by acceleration/MC. */
  performanceMass: number;
  ac: number;
  shipHp: number;
  accel: number;
  mcRaw: number;
  mcBands: MCBand[];
  commandBonus: number;
  buildCost: number;
  massBreakdown: ShipMassBreakdown;
  boxGroups: ShipBoxGroup[];
}

export function computeShipBuild(build: ShipBuild): ShipDerivedStats {
  const m = computeMassBreakdown(build);
  const buildCost = computeBuildCost(build);
  const crewWeeklyCost = computeCrewWeeklyCostTotal(build);
  const hullDef = componentByName(build.components, COMPONENT_NAMES.hull);
  return {
    totalMass: build.totalMass,
    hullMass: m.hull,
    hullMassExact: computeHullMass(build.totalMass),
    armorMass: m.armor,
    armorMassExact: computeArmorMass(build),
    fittingMass: m.used - m.hull - m.armor,
    weaponMass: computeWeaponMass(build),
    weaponCapacity: m.weapons,
    weaponPlacedTons: computeWeaponMass(build),
    weaponCrew: computeWeaponCrew(build),
    atmosphericSpeed: Math.max(0, build.atmosphericSpeed ?? 0),
    damageThreshold: Math.max(0, build.damageThreshold ?? 15),
    usedMass: m.used,
    remainingMass: m.remaining,
    overload: m.used > build.totalMass,
    crew: computeCrew(build),
    minCrew: computeMinCrew(build),
    fullCrew: computeFullCrew(build),
    crewQuarters: Math.max(0, build.crewQuarters || 0),
    crewCapacity: computeCrewCapacity(build.crewQuarters),
    crewWeeklyCost,
    weeklyOperationCost: Math.round(buildCost * SHIP_WEEKLY_OPERATION_FRACTION + crewWeeklyCost),
    performanceMass: performanceMassOf(build),
    ac: computeArmorClass(build),
    shipHp: computeShipHp(build),
    accel: computeAccel(build),
    mcRaw: computeMCRaw(build),
    mcBands: computeMCBands(build),
    commandBonus: computeCommandBonus(build),
    buildCost,
    massBreakdown: m,
    boxGroups: boxGroupsFromMass(m, !hullDef.hittable),
  };
}
