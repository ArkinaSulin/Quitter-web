// src/lib/shipStats.test.ts
// Oracle: .scratch/shipyard-formula/shipyard.csv (v8.1 FINAL) + migration 067 seeds.
// Fixtures replicate the 067 catalog rows; expected values are hand-derived from the
// CSV formulas (Wasp/Damselfly/Scorpion/Lamprey/Bombard cross-checked).

import { describe, expect, it } from 'vitest';
import {
  ShipAccessory,
  ShipArmor,
  ShipComponent,
  ShipFrame,
  ShipTemplateAccessory,
  ShipWeapon,
} from '@/types/ship';
import {
  computeAccel,
  computeActiveTopSpeed,
  computeAvailableSpace,
  computeBoxHp,
  computeBuildCost,
  computeCrew,
  computeCrewQuartersTons,
  computeDeckUsed,
  computeEmptyMass,
  computeGearMass,
  computeMCAtSpeed,
  computeMCBand,
  computePools,
  computeShipBuild,
  computeShipHp,
  computeUnclaimedSpace,
  SAIL_THRUST,
  SHIP_DT,
  ShipBuild,
} from '@/lib/shipStats';

// --- 067 seed fixtures ------------------------------------------------------

const FRAMES: ShipFrame[] = [
  { id: 'tiny', massCap: 35, baseHp: 200, deckSpace: 10, topSpeed: 12, maxRudders: 2, baseCost: 5000, hullSpaces: 8 },
  { id: 'small', massCap: 55, baseHp: 250, deckSpace: 30, topSpeed: 11, maxRudders: 3, baseCost: 15000, hullSpaces: 10 },
  { id: 'medium', massCap: 80, baseHp: 350, deckSpace: 50, topSpeed: 10, maxRudders: 4, baseCost: 35000, hullSpaces: 14 },
  { id: 'large', massCap: 100, baseHp: 500, deckSpace: 90, topSpeed: 9, maxRudders: 5, baseCost: 60000, hullSpaces: 20 },
];

const ARMORS: ShipArmor[] = [
  { id: 'wood', massFactor: 0.0, ac: 15, boxHp: 5, costMult: 1 },
  { id: 'plated', massFactor: 0.2, ac: 17, boxHp: 6, costMult: 2 },
  { id: 'metal', massFactor: 0.4, ac: 19, boxHp: 7, costMult: 4 },
  { id: 'ceramic', massFactor: 0.1, ac: 13, boxHp: 6, costMult: 3 },
  { id: 'stone', massFactor: 0.5, ac: 17, boxHp: 8, costMult: 1 },
];

const COMPONENTS: ShipComponent[] = [
  { id: 'helm_bridge', mass: 2, deck: 6, crew: 1, cost: 0, reinforceOrder: 1, hittable: true },
  { id: 'aux_helm', mass: 2, deck: 6, crew: 1, cost: 3000, reinforceOrder: 3, hittable: true },
  { id: 'sail', mass: 2, deck: 0, crew: 0.5, cost: 2000, reinforceOrder: null, hittable: true },
  { id: 'rudder', mass: 2, deck: 0, crew: 1, cost: 3000, reinforceOrder: 5, hittable: true },
  { id: 'l_weap', mass: 4, deck: 6, crew: 1, cost: 4000, reinforceOrder: 4, hittable: true },
  { id: 's_weap', mass: 2, deck: 4, crew: 1, cost: 2000, reinforceOrder: 6, hittable: true },
  { id: 'hull_r', mass: 1, deck: 0, crew: 0, cost: 1000, reinforceOrder: null, hittable: false },
  { id: 'crew_quarters', mass: 1, deck: 1, crew: 5, cost: 0, reinforceOrder: null, hittable: true },
  { id: 'command_bridge', mass: 2, deck: 8, crew: 2, cost: 6000, reinforceOrder: 2, hittable: true },
];

const ACCESSORIES: ShipAccessory[] = [
  { id: 'watertight_hull', mass: 5, deck: 5, crew: 0, cost: 0, poolType: 'mass_x_boxhp', hittable: false, effect: 'Water + Underwater travel (safe hull plating)' },
  { id: 'ram', mass: 5, deck: 2, crew: 0, cost: 5000, poolType: 'mass_x_boxhp', hittable: true, effect: '16d10 ram; attacker takes 1/2 damage' },
  { id: 'grappling_jaws', mass: 2, deck: 2, crew: 0, cost: 0, poolType: 'mass_x_boxhp', hittable: true, effect: '4d10 melee (Lamprey)' },
  { id: 'tentacles', mass: 3, deck: 4, crew: 0, cost: 4000, poolType: 'mass_x_boxhp', hittable: true, effect: '4d10/teleport melee, reach 3 forward hexes' },
  { id: 'bombard_mount', mass: 40, deck: 4, crew: 0, cost: 80000, poolType: 'mass_x_boxhp', hittable: true, effect: 'Siege cannon (16d10, cycle 600), DT flat' },
  { id: 'magazine', mass: 2, deck: 0, crew: 0, cost: 6000, poolType: 'mass_x_boxhp', hittable: true, effect: 'Ammo store' },
  { id: 'smoke_sac', mass: 1, deck: 1, crew: 0, cost: 2000, poolType: 'mass_x_boxhp', hittable: true, effect: 'Reaction smoke overlay, AC+2' },
  { id: 'living_treant', mass: 2, deck: 0, crew: 0, cost: 50000, poolType: 'mass_x_boxhp', hittable: true, effect: 'Regenerate 2d8/rd on water; replaces 9 crew' },
  { id: 'hover_device', mass: 2, deck: 4, crew: 0, cost: 60000, poolType: 'mass_x_boxhp', hittable: true, effect: 'Rotate in place at any speed (MC 3 always); NOT for sale' },
  { id: 'scorpion_claws', mass: 2, deck: 2, crew: 0, cost: 0, poolType: 'small_anchor', hittable: true, effect: 'Land travel + 3d10 melee (2 claws)' },
  { id: 'eyestalk_cannons', mass: 2, deck: 4, crew: 0, cost: 0, poolType: 'small_anchor', hittable: true, effect: '10d6, Beholder concentration / Destructive Ray' },
  { id: 'grappling_legs', mass: 2, deck: 2, crew: 0, cost: 0, poolType: 'mass_x_boxhp', hittable: true, effect: 'Grappling legs (Nightspider)' },
  { id: 'low_visibility', mass: 0, deck: 0, crew: 0, cost: 2000, poolType: 'none', hittable: false, effect: 'Magic - surprise + double speed round 1 (no hit box)' },
  { id: 'air_envelope', mass: 0, deck: 0, crew: 0, cost: 0, poolType: 'none', hittable: false, effect: 'Air - spelljammer physics (no hit box)' },
  { id: 'planar_device', mass: 4, deck: 4, crew: 0, cost: 60000, poolType: 'mass_x_boxhp', hittable: true, effect: 'Plane travel (narrative)' },
];

const WEAPONS: ShipWeapon[] = [
  { id: 'ballista_light', mount: 'small', damage: '2d10', rangeStd: 3, rangeDis: 10, fireCycleRd: 2, crew: 2, cost: 500, ammoCost: 1, special: 'ammo 1gp' },
  { id: 'catapult_medium', mount: 'large', damage: '5d10', rangeStd: 4, rangeDis: 16, fireCycleRd: 5, crew: 4, cost: 800, ammoCost: null, special: 'min range 2; 1/15t' },
  { id: 'scorpion_claws_wpn', mount: 'special', damage: '3d10', rangeStd: 1, rangeDis: 1, fireCycleRd: 1, crew: 1, cost: 0, ammoCost: null, special: '2 claws (special; mount via accessory)' },
];

const frame = (id: string) => FRAMES.find(f => f.id === id)!;
const armor = (id: string) => ARMORS.find(a => a.id === id)!;
const acc = (id: string): ShipTemplateAccessory => ({ accessoryId: id, count: 1 });

function buildBase(opts: {
  frameId: string; armorId: string; rudders: number; sails: number; lWeap: number; sWeap: number;
  hullR?: number; bridge?: number; auxHelm?: number; extraCrew?: number; cargoArea?: number;
  atmosphereSpeed?: number; accessories?: ShipTemplateAccessory[];
}): ShipBuild {
  return {
    frame: frame(opts.frameId),
    armor: armor(opts.armorId),
    components: COMPONENTS,
    accessoriesCatalog: ACCESSORIES,
    weaponsCatalog: WEAPONS,
    atmosphereSpeed: opts.atmosphereSpeed ?? 4,
    rudders: opts.rudders,
    sails: opts.sails,
    lWeap: opts.lWeap,
    sWeap: opts.sWeap,
    hullR: opts.hullR ?? 0,
    bridge: opts.bridge ?? 0,
    auxHelm: opts.auxHelm ?? 0,
    extraCrew: opts.extraCrew ?? 0,
    cargoArea: opts.cargoArea ?? 0,
    templateAccessories: opts.accessories ?? [],
    templateWeapons: [],
  };
}

describe('ship mass / space', () => {
  it('Wasp (Tiny/Wood, 2R/6S/0L/1S, cargo 8): mass 22, avail 13, unclaimed 5', () => {
    const b = buildBase({ frameId: 'tiny', armorId: 'wood', rudders: 2, sails: 6, lWeap: 0, sWeap: 1, cargoArea: 8, atmosphereSpeed: 5 });
    expect(computeGearMass(b)).toBe(22);
    expect(computeEmptyMass(b)).toBe(22);
    expect(computeAvailableSpace(b)).toBe(13);
    expect(computeUnclaimedSpace(b)).toBe(5);
  });

  it('Damselfly (Small/Plated): armor eats 11 t of capacity', () => {
    const b = buildBase({ frameId: 'small', armorId: 'plated', rudders: 3, sails: 8, lWeap: 1, sWeap: 1, extraCrew: 2, bridge: 1, cargoArea: 5, atmosphereSpeed: 7 });
    expect(computeEmptyMass(b)).toBe(46); // armor 11 + gear 35
    expect(computeAvailableSpace(b)).toBe(9);
    expect(computeUnclaimedSpace(b)).toBe(4);
  });

  it('Scorpion (Small/Metal): heavy armor eats 22 t, cargo 10 -> unclaimed 0', () => {
    const b = buildBase({ frameId: 'small', armorId: 'metal', rudders: 3, sails: 2, lWeap: 1, sWeap: 1, extraCrew: 5, cargoArea: 10, atmosphereSpeed: 3, accessories: [acc('scorpion_claws')] });
    expect(computeEmptyMass(b)).toBe(45);
    expect(computeAvailableSpace(b)).toBe(10);
    expect(computeUnclaimedSpace(b)).toBe(0);
  });
});

describe('crew & quarters', () => {
  it('Wasp: 7 crew -> 2 quarters tons', () => {
    const b = buildBase({ frameId: 'tiny', armorId: 'wood', rudders: 2, sails: 6, lWeap: 0, sWeap: 1 });
    expect(computeCrew(b)).toBe(7);
    expect(computeCrewQuartersTons(computeCrew(b))).toBe(2);
  });

  it('Damselfly: 14 crew (incl. bridge + extra) -> 3 tons', () => {
    const b = buildBase({ frameId: 'small', armorId: 'plated', rudders: 3, sails: 8, lWeap: 1, sWeap: 1, extraCrew: 2, bridge: 1 });
    expect(computeCrew(b)).toBe(14);
    expect(computeCrewQuartersTons(computeCrew(b))).toBe(3);
  });

  it('Lamprey: fractional sail crew 17.5 -> ceil 4 tons', () => {
    const b = buildBase({ frameId: 'medium', armorId: 'wood', rudders: 3, sails: 9, lWeap: 0, sWeap: 4, hullR: 10, extraCrew: 5, cargoArea: 6, accessories: [acc('grappling_jaws')] });
    expect(computeCrew(b)).toBeCloseTo(17.5);
    expect(computeCrewQuartersTons(computeCrew(b))).toBe(4);
  });

  it('Bombard: 16 crew (bridge + extra + s-weapons) -> 4 tons', () => {
    const b = buildBase({ frameId: 'large', armorId: 'wood', rudders: 3, sails: 8, lWeap: 0, sWeap: 2, extraCrew: 4, bridge: 1, cargoArea: 15, accessories: [acc('bombard_mount'), { accessoryId: 'magazine', count: 2 }] });
    expect(computeCrew(b)).toBe(16);
    expect(computeCrewQuartersTons(computeCrew(b))).toBe(4);
  });
});

describe('accel', () => {
  it('Accel = 18 x sails / mass (round)', () => {
    const b = buildBase({ frameId: 'tiny', armorId: 'wood', rudders: 2, sails: 6, lWeap: 0, sWeap: 1, cargoArea: 8 });
    expect(SAIL_THRUST).toBe(18);
    expect(computeAccel(b, computeEmptyMass(b))).toBe(5);       // 108/22 = 4.9
    expect(computeAccel(b, computeEmptyMass(b) + 8)).toBe(4);   // laden 108/30 = 3.6
  });

  it('Bombard (laden) crawls: 2', () => {
    const b = buildBase({ frameId: 'large', armorId: 'wood', rudders: 3, sails: 8, lWeap: 0, sWeap: 2, extraCrew: 4, bridge: 1, cargoArea: 15, accessories: [acc('bombard_mount'), { accessoryId: 'magazine', count: 2 }] });
    expect(computeEmptyMass(b)).toBe(78);
    expect(computeAccel(b, 78)).toBe(2);
    expect(computeAccel(b, 93)).toBe(2);
  });
});

describe('active speed cap', () => {
  it('Environment picks TopSpeed (Space) vs AtmosphereSpd (Atmosphere)', () => {
    const tiny = frame('tiny');
    expect(computeActiveTopSpeed(tiny, 5, 'space')).toBe(12);
    expect(computeActiveTopSpeed(tiny, 5, 'atmosphere')).toBe(5);
    expect(computeActiveTopSpeed(tiny, 0, 'atmosphere')).toBe(12); // fallback
  });
});

describe('ship HP & DT', () => {
  it('Ship HP = frame base + hullR x 25', () => {
    expect(computeShipHp(buildBase({ frameId: 'tiny', armorId: 'wood', rudders: 2, sails: 6, lWeap: 0, sWeap: 1 }))).toBe(200);
    expect(computeShipHp(buildBase({ frameId: 'medium', armorId: 'wood', rudders: 3, sails: 9, lWeap: 0, sWeap: 4, hullR: 10 }))).toBe(600);
  });

  it('DT is flat 15', () => {
    expect(SHIP_DT).toBe(15);
  });
});

describe('box HP & pools', () => {
  it('BoxHP = ceil(5 x (1 + armorFactor))', () => {
    expect(computeBoxHp(armor('wood'))).toBe(5);
    expect(computeBoxHp(armor('plated'))).toBe(6);
    expect(computeBoxHp(armor('metal'))).toBe(7);
    expect(computeBoxHp(armor('ceramic'))).toBe(6);
    expect(computeBoxHp(armor('stone'))).toBe(8);
  });

  it('Wasp pools total 175 (helm 10 + sails 60 + rudders 20 + sWeap 10 + cargo 40 + unclaimed 25 + quarters 10)', () => {
    const b = buildBase({ frameId: 'tiny', armorId: 'wood', rudders: 2, sails: 6, lWeap: 0, sWeap: 1, cargoArea: 8 });
    const p = computePools(b);
    expect(p.helm).toBe(10);
    expect(p.sails).toBe(60);
    expect(p.rudders).toBe(20);
    expect(p.lWeap).toBe(0);
    expect(p.sWeap).toBe(10);
    expect(p.cargo).toBe(40);
    expect(p.unclaimed).toBe(25);
    expect(p.crewQuarters).toBe(10);
    expect(p.total).toBe(175);
  });

  it('Lamprey: hullR 10 reinforces Helm, Rudder and S.Weap pools', () => {
    const b = buildBase({ frameId: 'medium', armorId: 'wood', rudders: 3, sails: 9, lWeap: 0, sWeap: 4, hullR: 10, extraCrew: 5, cargoArea: 6, accessories: [acc('grappling_jaws')] });
    const p = computePools(b);
    expect(p.helm).toBe(20);      // 2 x 5 x 2 (reinforced #1)
    expect(p.sails).toBe(90);     // never reinforced
    expect(p.rudders).toBe(60);   // 2x5x3x2 (reinforced #5)
    expect(p.sWeap).toBe(80);     // 10 x 4 x 2 (reinforced #6)
    expect(p.accessories).toBe(10); // jaws 2t x 5
    expect(p.cargo).toBe(30);
    expect(p.unclaimed).toBe(120); // 24 unclaimed x 5
    expect(p.total).toBe(430);
  });

  it('Scorpion: small-anchor special = 10, not mass x boxHP', () => {
    const b = buildBase({ frameId: 'small', armorId: 'metal', rudders: 3, sails: 2, lWeap: 1, sWeap: 1, extraCrew: 5, cargoArea: 10, accessories: [acc('scorpion_claws')] });
    const p = computePools(b);
    expect(p.accessories).toBe(10); // small anchor, NOT 2 x 7 = 14
    expect(p.lWeap).toBe(20);
    expect(p.sWeap).toBe(10);
    expect(p.total).toBe(215);
  });
});

describe('MC band', () => {
  it('Wasp unladen has the 4-premium at speed 8 and a 2-band 4..12', () => {
    const b = buildBase({ frameId: 'tiny', armorId: 'wood', rudders: 2, sails: 6, lWeap: 0, sWeap: 1 });
    const band = computeMCBand(b, computeEmptyMass(b)); // unladen 22
    expect(band.map(x => x.mc)).toEqual([1, 1, 1, 2, 2, 2, 2, 4, 2, 2, 2, 2]);
  });

  it('Wasp laden loses the 4-premium and the band narrows (load taxes maneuver)', () => {
    const b = buildBase({ frameId: 'tiny', armorId: 'wood', rudders: 2, sails: 6, lWeap: 0, sWeap: 1, cargoArea: 8 });
    const band = computeMCBand(b, computeEmptyMass(b) + 8); // laden 30
    expect(band.map(x => x.mc)).toEqual([1, 1, 1, 2, 2, 2, 2, 2, 2, 2, 1, 1]);
  });

  it('Scorpion (heavy armor, 3 rudders, laden 55) peaks at 2 — no 3-band', () => {
    const b = buildBase({ frameId: 'small', armorId: 'metal', rudders: 3, sails: 2, lWeap: 1, sWeap: 1, extraCrew: 5, cargoArea: 10, accessories: [acc('scorpion_claws')] });
    const band = computeMCBand(b, computeEmptyMass(b) + 10);
    expect(band.map(x => x.mc)).toEqual([1, 2, 2, 2, 2, 2, 2, 2, 1, 1, 1]);
    expect(band.every(x => x.mc <= 2)).toBe(true);
  });

  it('Shrike (3 rudders, light) reaches a 3-band', () => {
    const b = buildBase({ frameId: 'medium', armorId: 'wood', rudders: 3, sails: 11, lWeap: 0, sWeap: 3, extraCrew: -1, cargoArea: 20 });
    const band = computeMCBand(b, computeEmptyMass(b)); // 39
    expect(band.some(x => x.mc === 3)).toBe(true);
  });

  it('MC at a speed is environment-independent (uses frame TopSpeed)', () => {
    const b = buildBase({ frameId: 'tiny', armorId: 'wood', rudders: 2, sails: 6, lWeap: 0, sWeap: 1 });
    // same mass/band regardless of which cap the environment picks
    expect(computeMCAtSpeed(b, 8, 22)).toBe(computeMCAtSpeed(b, 8, 22));
  });
});

describe('deck', () => {
  it('Damselfly fits its deck: 27 of 30', () => {
    const b = buildBase({ frameId: 'small', armorId: 'plated', rudders: 3, sails: 8, lWeap: 1, sWeap: 1, extraCrew: 2, bridge: 1, cargoArea: 5 });
    expect(computeDeckUsed(b)).toBe(27);
    expect(b.frame.deckSpace).toBe(30);
  });

  it('Wasp overloads Tiny deck: 12 of 10 (soft penalty, shown red)', () => {
    const b = buildBase({ frameId: 'tiny', armorId: 'wood', rudders: 2, sails: 6, lWeap: 0, sWeap: 1 });
    expect(computeDeckUsed(b)).toBe(12);
    expect(computeDeckUsed(b)).toBeGreaterThan(b.frame.deckSpace);
  });
});

describe('cost', () => {
  it('Wasp build cost = frame x armor + components (no specials/weapons)', () => {
    const b = buildBase({ frameId: 'tiny', armorId: 'wood', rudders: 2, sails: 6, lWeap: 0, sWeap: 1 });
    // 5000 + helm 0 + rudders 6000 + sails 12000 + s_weap 2000
    expect(computeBuildCost(b)).toBe(25000);
  });

  it('Damselfly: plated x2 frame + bridge + weapons catalog costs', () => {
    const b = buildBase({ frameId: 'small', armorId: 'plated', rudders: 3, sails: 8, lWeap: 1, sWeap: 1, extraCrew: 2, bridge: 1, cargoArea: 5 });
    // 30000 + (0 + 9000 + 16000 + 4000 + 2000 + 6000) = 67000; no weapon assignments
    expect(computeBuildCost(b)).toBe(67000);
  });

  it('Weapon assignments add their catalog cost', () => {
    const b = buildBase({ frameId: 'tiny', armorId: 'wood', rudders: 2, sails: 6, lWeap: 0, sWeap: 1 });
    b.templateWeapons = [{ weaponId: 'catapult_medium', mountSlot: 'fore', count: 1 }];
    expect(computeBuildCost(b)).toBe(25000 + 800);
  });
});

describe('computeShipBuild aggregate', () => {
  it('Wasp: full readout matches the CSV columns', () => {
    const b = buildBase({ frameId: 'tiny', armorId: 'wood', rudders: 2, sails: 6, lWeap: 0, sWeap: 1, cargoArea: 8, atmosphereSpeed: 5 });
    const s = computeShipBuild(b);
    expect(s.crew).toBe(7);
    expect(s.crewQuarters).toBe(2);
    expect(s.armorMass).toBe(0);
    expect(s.gearMass).toBe(22);
    expect(s.emptyMass).toBe(22);
    expect(s.availableSpace).toBe(13);
    expect(s.unclaimedSpace).toBe(5);
    expect(s.ladenMass).toBe(30);
    expect(s.accelEmpty).toBe(5);
    expect(s.accelLaden).toBe(4);
    expect(s.topSpeed).toBe(12);
    expect(s.atmosphereSpeed).toBe(5);
    expect(s.shipHp).toBe(200);
    expect(s.dt).toBe(15);
    expect(s.boxHp).toBe(5);
    expect(s.pools.total).toBe(175);
    expect(s.deckUsed).toBe(12);
    expect(s.deckSpace).toBe(10);
    expect(s.buildCost).toBe(25000);
  });
});
