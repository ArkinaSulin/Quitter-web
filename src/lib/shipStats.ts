// src/lib/shipStats.ts
// Pure Shipyard v8.1 FINAL formulas. Source of truth: .scratch/shipyard-formula/shipyard.csv
// + HANDBOOK §17.4/§17.5. Shared by the Ship Editor and (later) the ship engine — every
// value here is a pure function of the build inputs.
//
// Key model facts encoded below:
//  - Armor eats mass capacity: armorMass = MassCap × armorFactor.
//  - Ship mass = armor + Σ components + loaded cargo; budget = MassCap.
//  - Accel = 18 × sails ÷ mass; laden uses mass + cargo (cargo-load slider drives it live).
//  - MC = turn capacity per GAME TURN (band formula; spent across the 5 segments). The
//    curve is computed against the FRAME TopSpeed and is unchanged by the environment
//    setting — the environment only picks the active speed cap (TopSpeed vs AtmosphereSpd).
//  - Hit boxes: 1 t of MassCap = 1 box; only armor + Hull R are safe. BoxHP = ceil(5×(1+factor)).
//    Weapon anchors S=10 / L=20, doubled when reinforced. Ship HP = frame base + hullR×25. DT = 15.
//  - Crew quarters = ceil(totalCrew/5) whole tons.

import {
  ShipAccessory,
  ShipArmor,
  ShipComponent,
  ShipEnvironment,
  ShipFrame,
  ShipTemplateAccessory,
  ShipTemplateWeapon,
  ShipWeapon,
} from '@/types/ship';

export const SAIL_THRUST = 18;
export const SHIP_DT = 15;
export const SMALL_WEAPON_ANCHOR = 10;
export const LARGE_WEAPON_ANCHOR = 20;
export const REINFORCED_MULT = 2;
export const SHIP_HP_PER_HULL_R = 25;
export const CREW_PER_QUARTER_TON = 5;
export const SAFE_BOX_HP_CEIL = 5;

export const COMPONENT_IDS = {
  helmBridge: 'helm_bridge',
  auxHelm: 'aux_helm',
  sail: 'sail',
  rudder: 'rudder',
  lWeap: 'l_weap',
  sWeap: 's_weap',
  hullR: 'hull_r',
  crewQuarters: 'crew_quarters',
  commandBridge: 'command_bridge',
} as const;

const EMPTY_COMPONENT: ShipComponent = {
  id: '', mass: 0, deck: 0, crew: 0, cost: 0, reinforceOrder: null, hittable: true,
};

export function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

export function componentById(components: ShipComponent[], id: string): ShipComponent {
  return components.find(c => c.id === id) || EMPTY_COMPONENT;
}

export function accessoryById(accessories: ShipAccessory[], id: string): ShipAccessory | undefined {
  return accessories.find(a => a.id === id);
}

export function weaponById(weapons: ShipWeapon[], id: string): ShipWeapon | undefined {
  return weapons.find(w => w.id === id);
}

/** All inputs the formulas need for one build. */
export interface ShipBuild {
  frame: ShipFrame;
  armor: ShipArmor;
  components: ShipComponent[];
  accessoriesCatalog: ShipAccessory[];
  weaponsCatalog: ShipWeapon[];
  atmosphereSpeed: number;
  rudders: number;
  sails: number;
  lWeap: number;
  sWeap: number;
  hullR: number;
  bridge: number;
  auxHelm: number;
  extraCrew: number;
  cargoArea: number;
  templateAccessories: ShipTemplateAccessory[];
  templateWeapons: ShipTemplateWeapon[];
}

// --- Crew -------------------------------------------------------------------

export function computeCrew(build: ShipBuild): number {
  const c = build.components;
  const helm = componentById(c, COMPONENT_IDS.helmBridge);
  const aux = componentById(c, COMPONENT_IDS.auxHelm);
  const sail = componentById(c, COMPONENT_IDS.sail);
  const rudder = componentById(c, COMPONENT_IDS.rudder);
  const lw = componentById(c, COMPONENT_IDS.lWeap);
  const sw = componentById(c, COMPONENT_IDS.sWeap);
  const bridge = componentById(c, COMPONENT_IDS.commandBridge);
  const accessoryCrew = build.templateAccessories.reduce(
    (sum, a) => sum + (accessoryById(build.accessoriesCatalog, a.accessoryId)?.crew || 0) * a.count,
    0,
  );
  return (
    helm.crew +
    build.auxHelm * aux.crew +
    build.rudders * rudder.crew +
    build.sails * sail.crew +
    build.lWeap * lw.crew +
    build.sWeap * sw.crew +
    build.bridge * bridge.crew +
    build.extraCrew +
    accessoryCrew
  );
}

export function computeCrewQuartersTons(crew: number): number {
  return Math.ceil(crew / CREW_PER_QUARTER_TON);
}

// --- Mass -------------------------------------------------------------------

export function computeArmorMass(frame: ShipFrame, armor: ShipArmor): number {
  return frame.massCap * armor.massFactor;
}

export function computeAccessoryMass(build: ShipBuild): number {
  return build.templateAccessories.reduce(
    (sum, a) => sum + (accessoryById(build.accessoriesCatalog, a.accessoryId)?.mass || 0) * a.count,
    0,
  );
}

/** Σ component masses + crew quarters + specials (excludes armor and cargo). */
export function computeGearMass(build: ShipBuild): number {
  const c = build.components;
  const helm = componentById(c, COMPONENT_IDS.helmBridge);
  const aux = componentById(c, COMPONENT_IDS.auxHelm);
  const sail = componentById(c, COMPONENT_IDS.sail);
  const rudder = componentById(c, COMPONENT_IDS.rudder);
  const lw = componentById(c, COMPONENT_IDS.lWeap);
  const sw = componentById(c, COMPONENT_IDS.sWeap);
  const hull = componentById(c, COMPONENT_IDS.hullR);
  const bridge = componentById(c, COMPONENT_IDS.commandBridge);
  const crewQ = componentById(c, COMPONENT_IDS.crewQuarters);
  const crewQuartersTons = computeCrewQuartersTons(computeCrew(build));
  return (
    helm.mass +
    build.auxHelm * aux.mass +
    build.rudders * rudder.mass +
    build.sails * sail.mass +
    build.lWeap * lw.mass +
    build.sWeap * sw.mass +
    build.hullR * hull.mass +
    build.bridge * bridge.mass +
    crewQuartersTons * crewQ.mass +
    computeAccessoryMass(build)
  );
}

/** Empty (unladen) ship mass = armor + gear. */
export function computeEmptyMass(build: ShipBuild): number {
  return computeArmorMass(build.frame, build.armor) + computeGearMass(build);
}

export function computeAvailableSpace(build: ShipBuild): number {
  return build.frame.massCap - computeEmptyMass(build);
}

export function computeUnclaimedSpace(build: ShipBuild): number {
  return computeAvailableSpace(build) - build.cargoArea;
}

/** Mass at a given load (tons of cargo). */
export function computeLadenMass(build: ShipBuild, loadedCargo: number): number {
  return computeEmptyMass(build) + loadedCargo;
}

// --- Performance ------------------------------------------------------------

export function computeAccel(build: ShipBuild, mass: number): number {
  if (mass <= 0) return 0;
  return Math.round((SAIL_THRUST * build.sails) / mass);
}

/** The active speed cap depends on the scenario environment setting. */
export function computeActiveTopSpeed(
  frame: ShipFrame,
  atmosphereSpeed: number,
  environment: ShipEnvironment,
): number {
  if (environment === 'space') return frame.topSpeed;
  return atmosphereSpeed > 0 ? atmosphereSpeed : frame.topSpeed;
}

export function computeShipHp(build: ShipBuild): number {
  return build.frame.baseHp + build.hullR * SHIP_HP_PER_HULL_R;
}

export function computeBoxHp(armor: ShipArmor): number {
  return Math.ceil(SAFE_BOX_HP_CEIL * (1 + armor.massFactor));
}

// --- MC band (maneuver class) ------------------------------------------------
//
// Corrected terminology (designer-authoritative): **MC** = how many hexes the ship
// must travel before one 60° turn — an integer, LOWER = tighter turn = better.
// **60°/turn** = `speed ÷ MC(at that speed)` — non-integer, HIGHER = better.
// The tier/center/W/peak band below produces MC at each per-turn speed s.

export interface MCParams {
  mass: number;
  tier: number;
  center: number;
  W: number;
  peak: number;
}

export function computeMCParams(build: ShipBuild, mass?: number): MCParams {
  const m = mass ?? computeLadenMass(build, build.cargoArea);
  const tier = Math.floor(m / 25);
  const center = clamp(Math.round(build.frame.topSpeed * 0.65) - tier, 2, 8);
  const W = Math.max(0, build.rudders - tier);
  const peak = clamp(build.rudders - Math.floor(m / 45), 1, 3);
  return { mass: m, tier, center, W, peak };
}

export function computeMCAtSpeed(build: ShipBuild, speed: number, mass?: number): number {
  const { mass: m, tier, center, W, peak } = computeMCParams(build, mass);
  if (m < 25 && build.rudders >= 2 && Math.abs(speed - center) <= 0.5) return 4;
  if (peak >= 3 && Math.abs(speed - center) <= W) return 3;
  if (Math.abs(speed - center) <= W + 2) return 2;
  return 1;
}

export interface MCResult {
  speed: number;
  mc: number;
}

export function computeMCBand(build: ShipBuild, mass?: number): MCResult[] {
  const out: MCResult[] = [];
  for (let s = 1; s <= build.frame.topSpeed; s++) {
    out.push({ speed: s, mc: computeMCAtSpeed(build, s, mass) });
  }
  return out;
}

/** 60° turns per game turn at a speed: `speed ÷ MC`, rounded to 1 decimal. */
export function turnsPerGameTurn(speed: number, mc: number): number {
  if (mc <= 0) return 0;
  return Math.round((speed / mc) * 10) / 10;
}

// --- Hit-box pools ----------------------------------------------------------

/** Pool HP contributed by one accessory instance (specials = mass × boxHP; Claws/Eyestalk = small anchor). */
export function accessoryPoolHp(accessory: ShipAccessory, boxHp: number): number {
  if (accessory.poolType === 'safe' || accessory.poolType === 'none') return 0;
  if (accessory.poolType === 'small_anchor') return SMALL_WEAPON_ANCHOR;
  return accessory.mass * boxHp;
}

export interface ShipPools {
  helm: number;
  auxHelm: number;
  sails: number;
  rudders: number;
  lWeap: number;
  sWeap: number;
  bridge: number;
  accessories: number;
  cargo: number;
  unclaimed: number;
  crewQuarters: number;
  total: number;
}

/** Per-subsystem box pools. Each Hull R doubles the next-in-order subsystem (Helm→Bridge→extra→L→Rudder→S). */
export function computePools(build: ShipBuild): ShipPools {
  const boxHp = computeBoxHp(build.armor);
  const c = build.components;
  const helm = componentById(c, COMPONENT_IDS.helmBridge);
  const aux = componentById(c, COMPONENT_IDS.auxHelm);
  const sail = componentById(c, COMPONENT_IDS.sail);
  const rudder = componentById(c, COMPONENT_IDS.rudder);
  const bridge = componentById(c, COMPONENT_IDS.commandBridge);
  const reinforced = (n: number) => (n >= 1 ? REINFORCED_MULT : 1);

  const helmPool = helm.mass * boxHp * reinforced(build.hullR);
  const auxPool = build.auxHelm * aux.mass * boxHp * reinforced(build.hullR >= 3 ? 1 : 0);
  const sailsPool = build.sails * sail.mass * boxHp;
  const ruddersPool = build.rudders * rudder.mass * boxHp * reinforced(build.hullR >= 5 ? 1 : 0);
  const lWeapPool = build.lWeap * LARGE_WEAPON_ANCHOR * reinforced(build.hullR >= 4 ? 1 : 0);
  const sWeapPool = build.sWeap * SMALL_WEAPON_ANCHOR * reinforced(build.hullR >= 6 ? 1 : 0);
  const bridgePool = build.bridge * bridge.mass * boxHp * reinforced(build.hullR >= 2 ? 1 : 0);
  const accessoriesPool = build.templateAccessories.reduce(
    (sum, a) => sum + (accessoryById(build.accessoriesCatalog, a.accessoryId) ? accessoryPoolHp(accessoryById(build.accessoriesCatalog, a.accessoryId)!, boxHp) * a.count : 0),
    0,
  );
  const cargoPool = Math.max(0, build.cargoArea) * boxHp;
  const unclaimedPool = Math.max(0, computeUnclaimedSpace(build)) * boxHp;
  const crewQuartersPool = computeCrewQuartersTons(computeCrew(build)) * boxHp;

  const total =
    helmPool + auxPool + sailsPool + ruddersPool + lWeapPool + sWeapPool +
    bridgePool + accessoriesPool + cargoPool + unclaimedPool + crewQuartersPool;

  return {
    helm: helmPool,
    auxHelm: auxPool,
    sails: sailsPool,
    rudders: ruddersPool,
    lWeap: lWeapPool,
    sWeap: sWeapPool,
    bridge: bridgePool,
    accessories: accessoriesPool,
    cargo: cargoPool,
    unclaimed: unclaimedPool,
    crewQuarters: crewQuartersPool,
    total,
  };
}

// --- Deck -------------------------------------------------------------------

export function computeDeckUsed(build: ShipBuild): number {
  const c = build.components;
  const helm = componentById(c, COMPONENT_IDS.helmBridge);
  const aux = componentById(c, COMPONENT_IDS.auxHelm);
  const sail = componentById(c, COMPONENT_IDS.sail);
  const rudder = componentById(c, COMPONENT_IDS.rudder);
  const lw = componentById(c, COMPONENT_IDS.lWeap);
  const sw = componentById(c, COMPONENT_IDS.sWeap);
  const hull = componentById(c, COMPONENT_IDS.hullR);
  const bridge = componentById(c, COMPONENT_IDS.commandBridge);
  const crewQ = componentById(c, COMPONENT_IDS.crewQuarters);
  const accessoryDeck = build.templateAccessories.reduce(
    (sum, a) => sum + (accessoryById(build.accessoriesCatalog, a.accessoryId)?.deck || 0) * a.count,
    0,
  );
  return (
    helm.deck +
    build.auxHelm * aux.deck +
    build.rudders * rudder.deck +
    build.sails * sail.deck +
    build.lWeap * lw.deck +
    build.sWeap * sw.deck +
    build.hullR * hull.deck +
    build.bridge * bridge.deck +
    computeCrewQuartersTons(computeCrew(build)) * crewQ.deck +
    accessoryDeck
  );
}

// --- Cost -------------------------------------------------------------------

export function computeBuildCost(build: ShipBuild): number {
  const c = build.components;
  const helm = componentById(c, COMPONENT_IDS.helmBridge);
  const aux = componentById(c, COMPONENT_IDS.auxHelm);
  const sail = componentById(c, COMPONENT_IDS.sail);
  const rudder = componentById(c, COMPONENT_IDS.rudder);
  const lw = componentById(c, COMPONENT_IDS.lWeap);
  const sw = componentById(c, COMPONENT_IDS.sWeap);
  const hull = componentById(c, COMPONENT_IDS.hullR);
  const bridge = componentById(c, COMPONENT_IDS.commandBridge);
  const crewQ = componentById(c, COMPONENT_IDS.crewQuarters);
  const componentCost =
    helm.cost +
    build.auxHelm * aux.cost +
    build.rudders * rudder.cost +
    build.sails * sail.cost +
    build.lWeap * lw.cost +
    build.sWeap * sw.cost +
    build.hullR * hull.cost +
    build.bridge * bridge.cost +
    computeCrewQuartersTons(computeCrew(build)) * crewQ.cost;
  const baseCost = Math.round(build.frame.baseCost * build.armor.costMult);
  const accessoryCost = build.templateAccessories.reduce(
    (sum, a) => sum + (accessoryById(build.accessoriesCatalog, a.accessoryId)?.cost || 0) * a.count,
    0,
  );
  const weaponCost = build.templateWeapons.reduce(
    (sum, w) => sum + (weaponById(build.weaponsCatalog, w.weaponId)?.cost || 0) * w.count,
    0,
  );
  return baseCost + componentCost + accessoryCost + weaponCost;
}

// --- Aggregate --------------------------------------------------------------

export interface ShipDerivedStats {
  crew: number;
  crewQuarters: number;
  armorMass: number;
  gearMass: number;
  emptyMass: number;
  availableSpace: number;
  unclaimedSpace: number;
  ladenMass: number;
  accelEmpty: number;
  accelLaden: number;
  topSpeed: number;
  atmosphereSpeed: number;
  shipHp: number;
  dt: number;
  boxHp: number;
  pools: ShipPools;
  deckUsed: number;
  deckSpace: number;
  buildCost: number;
  mcBandEmpty: MCResult[];
  mcBandLaden: MCResult[];
}

export function computeShipBuild(build: ShipBuild): ShipDerivedStats {
  const emptyMass = computeEmptyMass(build);
  const ladenMass = computeLadenMass(build, Math.max(0, build.cargoArea));
  return {
    crew: computeCrew(build),
    crewQuarters: computeCrewQuartersTons(computeCrew(build)),
    armorMass: computeArmorMass(build.frame, build.armor),
    gearMass: computeGearMass(build),
    emptyMass,
    availableSpace: computeAvailableSpace(build),
    unclaimedSpace: computeUnclaimedSpace(build),
    ladenMass,
    accelEmpty: computeAccel(build, emptyMass),
    accelLaden: computeAccel(build, ladenMass),
    topSpeed: build.frame.topSpeed,
    atmosphereSpeed: build.atmosphereSpeed,
    shipHp: computeShipHp(build),
    dt: SHIP_DT,
    boxHp: computeBoxHp(build.armor),
    pools: computePools(build),
    deckUsed: computeDeckUsed(build),
    deckSpace: build.frame.deckSpace,
    buildCost: computeBuildCost(build),
    mcBandEmpty: computeMCBand(build, emptyMass),
    mcBandLaden: computeMCBand(build, ladenMass),
  };
}
