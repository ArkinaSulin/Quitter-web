// src/packages/ships/tests/shipStats.test.ts
// Oracle: the 2026 Spelljammer overhaul rules + the five reference templates
// (Racer, Shuttle, Wasp, Damselfly, Star Moth).
//
//   hullMass  = totalMass × (10% + totalMass / 500)
//   armorMass = totalMass × armor.massPct
//   HP        = (totalMass × 3 + 40) × armor.hpMult
//   accel     = (sails + rudders) / totalMass × 15
//   MC        = x = rudders × 10 / totalMass; x < 1 → 1/x + 2, else 4 − x
//   effectiveMC = MC + (−1 / 0 / +1) at speeds 0–2 / 3–7 / 8–12, floored at 0
//
// Tonnage groups round to the nearest whole ton; crew requirements round up
// per component; crew quarters are authored (1 ton = 5 capacity).

import { describe, expect, it } from 'vitest';
import {
  ShipAccessory,
  ShipArmor,
  ShipComponent,
  ShipTemplateAccessory,
  ShipTemplateWeapon,
  ShipWeapon,
} from '@/types/ship';
import {
  computeAccel,
  computeArmorMass,
  computeBoxGroups,
  computeBuildCost,
  computeCommandBonus,
  computeComponentCrew,
  computeCrewCapacity,
  computeEffectiveMC,
  computeFittingMass,
  computeHullMass,
  computeMCBands,
  computeMCRaw,
  computeMinCrew,
  computeRemainingMass,
  computeShipBuild,
  computeShipHp,
  computeTonnage,
  computeUsedMass,
  computeWeaponCapacity,
  computeWeaponMass,
  canPlaceWeapon,
  ShipBuild,
} from '@/packages/ships/lib/shipStats';

const ARMORS: ShipArmor[] = [
  { id: 'wood', massPct: 0.0, ac: 15, hpMult: 1 },
  { id: 'ceramic', massPct: 0.05, ac: 13, hpMult: 2 },
  { id: 'plated', massPct: 0.10, ac: 17, hpMult: 1 },
  { id: 'metal', massPct: 0.20, ac: 19, hpMult: 1 },
  { id: 'stone', massPct: 0.30, ac: 17, hpMult: 2 },
];

const COMPONENTS: ShipComponent[] = [
  { id: 'helm', mass: 1, crew: 1, cost: 0, hittable: true },
  { id: 'command_bridge', mass: 3, crew: 5, cost: 0, hittable: true },
  { id: 'sail', mass: 1, crew: 0.5, cost: 0, hittable: true },
  { id: 'rudder', mass: 1.5, crew: 0.5, cost: 0, hittable: true },
  { id: 'reinforcement', mass: 1, crew: 0, cost: 0, hittable: true },
  { id: 'cargo', mass: 1, crew: 0, cost: 0, hittable: true },
  { id: 'crew_quarters', mass: 1, crew: 5, cost: 0, hittable: true },
  { id: 'weapon_large', mass: 2, crew: 2, cost: 0, hittable: true },
  { id: 'weapon_small', mass: 1, crew: 2, cost: 0, hittable: true },
];

const ACCESSORIES: ShipAccessory[] = [
  { id: 'ram', mass: 5, crew: 0, cost: 5000, hittable: true, effect: '16d10 ram' },
  { id: 'low_visibility', mass: 0, crew: 0, cost: 2000, hittable: false, effect: 'surprise' },
];

const WEAPONS: ShipWeapon[] = [
  { id: 'ballista_light', mount: 'small', damage: '2d10', rangeStd: 3, rangeDis: 10, fireCycleRd: 2, crew: 2, cost: 500, ammoCost: 1, special: null },
  { id: 'catapult_medium', mount: 'large', damage: '5d10', rangeStd: 4, rangeDis: 16, fireCycleRd: 5, crew: 4, cost: 800, ammoCost: null, special: null },
  { id: 'scorpion_claws_wpn', mount: 'special', damage: '3d10', rangeStd: 1, rangeDis: 1, fireCycleRd: 1, crew: 1, cost: 0, ammoCost: null, special: 'special mount' },
];

const ARMOR = (id: string) => ARMORS.find(a => a.id === id)!;
const acc = (id: string, count = 1): ShipTemplateAccessory => ({ accessoryId: id, count });
const wpn = (weaponId: string, count = 1, mountSlot = 'Fore'): ShipTemplateWeapon => ({ weaponId, mountSlot, count });

function buildBase(opts: {
  armorId: string;
  totalMass: number;
  helm?: number;
  commandBridge?: number;
  sails?: number;
  rudders?: number;
  reinforcement?: number;
  crewCount?: number;
  crewQuarters?: number;
  passengers?: number;
  weaponCapacity?: number;
  atmosphericSpeed?: number;
  damageThreshold?: number;
  cargoArea?: number;
  accessories?: ShipTemplateAccessory[];
  weapons?: ShipTemplateWeapon[];
}): ShipBuild {
  return {
    armor: ARMOR(opts.armorId),
    components: COMPONENTS,
    accessoriesCatalog: ACCESSORIES,
    weaponsCatalog: WEAPONS,
    totalMass: opts.totalMass,
    helm: opts.helm ?? 1,
    commandBridge: opts.commandBridge ?? 0,
    sails: opts.sails ?? 0,
    rudders: opts.rudders ?? 0,
    reinforcement: opts.reinforcement ?? 0,
    crewCount: opts.crewCount ?? 0,
    crewQuarters: opts.crewQuarters ?? 0,
    passengers: opts.passengers ?? 0,
    weaponCapacity: opts.weaponCapacity,
    atmosphericSpeed: opts.atmosphericSpeed,
    damageThreshold: opts.damageThreshold,
    cargoArea: opts.cargoArea ?? 0,
    templateAccessories: opts.accessories ?? [],
    templateWeapons: opts.weapons ?? [],
  };
}

// --- Reference templates ----------------------------------------------------

const racer = () => buildBase({
  armorId: 'wood', totalMass: 10, helm: 1, sails: 2, rudders: 4,
  crewCount: 4, crewQuarters: 0, cargoArea: 0,
});

const shuttle = () => buildBase({
  armorId: 'wood', totalMass: 10, helm: 1, sails: 1, rudders: 1,
  crewCount: 3, crewQuarters: 4, cargoArea: 1,
});

const wasp = () => buildBase({
  armorId: 'wood', totalMass: 20, helm: 1, sails: 1, rudders: 6,
  crewCount: 7, crewQuarters: 2, weaponCapacity: 1, cargoArea: 3,
  weapons: [wpn('ballista_light', 1)],
});

const damselfly = () => buildBase({
  armorId: 'metal', totalMass: 30, helm: 1, sails: 7, rudders: 3,
  crewCount: 13, crewQuarters: 2, weaponCapacity: 3, cargoArea: 1,
  weapons: [wpn('catapult_medium', 1, 'Fore'), wpn('ballista_light', 1, 'Left')],
});

const starMoth = () => buildBase({
  armorId: 'ceramic', totalMass: 60, helm: 1, commandBridge: 1, sails: 2, rudders: 18,
  crewCount: 24, crewQuarters: 5, weaponCapacity: 4, cargoArea: 2,
  weapons: [wpn('ballista_light', 4)],
});

describe('hull + armor mass', () => {
  it('hull mass uses totalMass × (10% + totalMass / 500)', () => {
    expect(computeHullMass(10)).toBeCloseTo(1.2, 6);
    expect(computeHullMass(20)).toBeCloseTo(2.8, 6);
    expect(computeHullMass(30)).toBeCloseTo(4.8, 6);
    expect(computeHullMass(60)).toBeCloseTo(13.2, 6);
  });

  it('rounds hull tonnage to the nearest whole ton', () => {
    expect(computeTonnage(racer()).hull).toBe(1);
    expect(computeTonnage(wasp()).hull).toBe(3);
    expect(computeTonnage(damselfly()).hull).toBe(5);
    expect(computeTonnage(starMoth()).hull).toBe(13);
  });

  it('armor mass is a percentage of total mass and rounds to tons', () => {
    expect(computeArmorMass(buildBase({ armorId: 'wood', totalMass: 100 }))).toBe(0);
    expect(computeArmorMass(buildBase({ armorId: 'ceramic', totalMass: 20 }))).toBe(1);
    expect(computeArmorMass(buildBase({ armorId: 'stone', totalMass: 100 }))).toBe(30);
    expect(computeTonnage(damselfly()).armor).toBe(6);   // Metal 20% of 30
    expect(computeTonnage(starMoth()).armor).toBe(3);    // Ceramic 5% of 60
  });
});

describe('reference template tonnage', () => {
  it('Racer: 1 hull + 1 helm + 2 sails + 6 rudders = 10', () => {
    const t = computeTonnage(racer());
    expect(t).toMatchObject({
      hull: 1, armor: 0, helm: 1, commandBridge: 0, sails: 2, rudders: 6,
      weapons: 0, reinforcement: 0, accessories: 0, cargo: 0, crewQuarters: 0,
      used: 10, remaining: 0,
    });
  });

  it('Shuttle: 1 hull + 1 helm + 1 sail + 2 rudders + 1 cargo + 4 quarters = 10', () => {
    const t = computeTonnage(shuttle());
    expect(t).toMatchObject({
      hull: 1, armor: 0, helm: 1, sails: 1, rudders: 2,
      cargo: 1, crewQuarters: 4, used: 10, remaining: 0,
    });
  });

  it('Wasp: 3 hull + 1 helm + 1 sail + 9 rudders + 1 weapon + 3 cargo + 2 quarters = 20', () => {
    const t = computeTonnage(wasp());
    expect(t).toMatchObject({
      hull: 3, armor: 0, helm: 1, sails: 1, rudders: 9,
      weapons: 1, cargo: 3, crewQuarters: 2, used: 20, remaining: 0,
    });
  });

  it('Damselfly: 5 hull + 6 armor + 1 helm + 7 sails + 5 rudders + 3 weapons + 1 cargo + 2 quarters = 30', () => {
    const t = computeTonnage(damselfly());
    expect(t).toMatchObject({
      hull: 5, armor: 6, helm: 1, sails: 7, rudders: 5,
      weapons: 3, cargo: 1, crewQuarters: 2, used: 30, remaining: 0,
    });
  });

  it('Star Moth: 13 hull + 3 armor + 1 helm + 3 bridge + 2 sails + 27 rudders + 4 weapons + 2 cargo + 5 quarters = 60', () => {
    const t = computeTonnage(starMoth());
    expect(t).toMatchObject({
      hull: 13, armor: 3, helm: 1, commandBridge: 3, sails: 2, rudders: 27,
      weapons: 4, cargo: 2, crewQuarters: 5, used: 60, remaining: 0,
    });
  });
});

describe('reference template performance', () => {
  const cases = [
    { name: 'Racer', build: racer, accel: 9, mc: 0, hp: 70, ac: 15, minCrew: 4, capacity: 0, bands: [0, 0, 1] },
    { name: 'Shuttle', build: shuttle, accel: 3, mc: 3, hp: 70, ac: 15, minCrew: 3, capacity: 20, bands: [2, 3, 4] },
    { name: 'Wasp', build: wasp, accel: 5.3, mc: 1, hp: 100, ac: 15, minCrew: 7, capacity: 10, bands: [0, 1, 2] },
    { name: 'Damselfly', build: damselfly, accel: 5, mc: 3, hp: 130, ac: 19, minCrew: 13, capacity: 10, bands: [2, 3, 4] },
    { name: 'Star Moth', build: starMoth, accel: 5, mc: 1, hp: 440, ac: 13, minCrew: 24, capacity: 25, bands: [0, 1, 2] },
  ];

  for (const c of cases) {
    it(`${c.name}: accel ${c.accel}, MC ${c.mc}, HP ${c.hp}, AC ${c.ac}`, () => {
      const build = c.build();
      const stats = computeShipBuild(build);
      expect(computeAccel(build)).toBe(c.accel);
      expect(computeMCRaw(build)).toBe(c.mc);
      expect(stats.shipHp).toBe(c.hp);
      expect(stats.ac).toBe(c.ac);
      expect(stats.minCrew).toBe(c.minCrew);
      expect(stats.crewCapacity).toBe(c.capacity);
      expect(stats.mcBands.map(b => b.mc)).toEqual(c.bands);
    });
  }

  it('Star Moth doubles 220 base HP to 440 with Ceramic armor', () => {
    expect(computeShipHp(starMoth())).toBe(440);
  });
});

describe('crew', () => {
  it('rounds each component crew separately before summing', () => {
    // Shuttle: 1 helm + ceil(0.5) sail + ceil(0.5) rudder = 3
    expect(computeComponentCrew(shuttle())).toBe(3);
    expect(computeMinCrew(shuttle())).toBe(3);

    // Damselfly: 1 + ceil(3.5) + ceil(1.5) + 4 + 2 = 13
    expect(computeComponentCrew(damselfly())).toBe(13);
    expect(computeMinCrew(damselfly())).toBe(13);

    // Star Moth: 1 + 5 + ceil(1) + ceil(9) + 4×2 = 24
    expect(computeComponentCrew(starMoth())).toBe(24);
    expect(computeMinCrew(starMoth())).toBe(24);
  });

  it('crew quarters are authored tons with 5 capacity per ton', () => {
    expect(computeCrewCapacity(0)).toBe(0);
    expect(computeCrewCapacity(1)).toBe(5);
    expect(computeCrewCapacity(4)).toBe(20);
    expect(computeCrewCapacity(5)).toBe(25);
    expect(computeShipBuild(shuttle()).crewQuarters).toBe(4);
    expect(computeShipBuild(shuttle()).crewCapacity).toBe(20);
  });
});

describe('weapons', () => {
  it('large weapons take 2 tons and small weapons 1 ton', () => {
    expect(computeWeaponMass(damselfly())).toBe(3);
    expect(computeWeaponMass(starMoth())).toBe(4);
    expect(computeTonnage(damselfly()).weapons).toBe(3);
  });

  it('counts the allocated capacity even when fewer weapons are placed', () => {
    const b = buildBase({
      armorId: 'wood', totalMass: 20, weaponCapacity: 4,
      weapons: [wpn('ballista_light', 1)],
    });
    expect(computeWeaponMass(b)).toBe(1);
    expect(computeWeaponCapacity(b)).toBe(4);
    expect(computeTonnage(b).weapons).toBe(4);
    expect(computeShipBuild(b).weaponPlacedTons).toBe(1);
    expect(computeShipBuild(b).weaponCapacity).toBe(4);
  });

  it('falls back to placed tons when no capacity is authored', () => {
    const b = buildBase({ armorId: 'wood', totalMass: 20, weapons: [wpn('ballista_light', 2)] });
    expect(computeWeaponCapacity(b)).toBe(2);
  });

  it('detects when a weapon does not fit the capacity', () => {
    expect(canPlaceWeapon(3, 4, 1)).toBe(true);
    expect(canPlaceWeapon(3, 4, 2)).toBe(false);
  });
});

describe('HP', () => {
  it('is totalMass × 3 + 40', () => {
    expect(computeShipHp(buildBase({ armorId: 'wood', totalMass: 20 }))).toBe(100);
    expect(computeShipHp(buildBase({ armorId: 'wood', totalMass: 100 }))).toBe(340);
  });

  it('armor doubles HP for ceramic and stone', () => {
    expect(computeShipHp(buildBase({ armorId: 'ceramic', totalMass: 20 }))).toBe(200);
    expect(computeShipHp(buildBase({ armorId: 'stone', totalMass: 100 }))).toBe(680);
    expect(computeShipHp(buildBase({ armorId: 'metal', totalMass: 100 }))).toBe(340);
  });
});

describe('acceleration', () => {
  it('is (sails + rudders) / totalMass × 15, one decimal', () => {
    expect(computeAccel(buildBase({ armorId: 'wood', totalMass: 20, sails: 1, rudders: 6 }))).toBe(5.3);
    expect(computeAccel(racer())).toBe(9);
    expect(computeAccel(shuttle())).toBe(3);
    expect(computeAccel(buildBase({ armorId: 'wood', totalMass: 20 }))).toBe(0);
  });
});

describe('MC', () => {
  it('uses x = rudders × 10 / totalMass and clamps at 0', () => {
    expect(computeMCRaw(shuttle())).toBe(3);        // x = 1 → 4 − 1
    expect(computeMCRaw(wasp())).toBe(1);          // x = 3 → 4 − 3
    expect(computeMCRaw(damselfly())).toBe(3);     // x = 1 → 4 − 1
    expect(computeMCRaw(starMoth())).toBe(1);      // x = 3 → 4 − 3
    expect(computeMCRaw(racer())).toBe(0);         // x = 4 → 4 − 4
    expect(computeMCRaw(buildBase({ armorId: 'wood', totalMass: 100, rudders: 3 }))).toBe(5.3); // x = 0.3
  });

  it('clamps negative raw MC at 0', () => {
    const heavyRudder = buildBase({ armorId: 'wood', totalMass: 10, rudders: 5 }); // x = 5 → −1
    expect(computeMCRaw(heavyRudder)).toBe(0);
  });

  it('cannot turn without a rudder', () => {
    expect(computeMCRaw(buildBase({ armorId: 'wood', totalMass: 20, rudders: 0 }))).toBe(Number.POSITIVE_INFINITY);
    expect(computeEffectiveMC(buildBase({ armorId: 'wood', totalMass: 20, rudders: 0 }), 0)).toBe(Number.POSITIVE_INFINITY);
  });

  it('effective MC adds the speed band modifier and floors at 0', () => {
    const b = racer(); // raw 0
    expect(computeEffectiveMC(b, 0)).toBe(0);
    expect(computeEffectiveMC(b, 2)).toBe(0);
    expect(computeEffectiveMC(b, 3)).toBe(0);
    expect(computeEffectiveMC(b, 7)).toBe(0);
    expect(computeEffectiveMC(b, 8)).toBe(1);
    expect(computeEffectiveMC(b, 12)).toBe(1);
  });

  it('reports the three speed bands', () => {
    expect(computeMCBands(racer()).map(b => b.mc)).toEqual([0, 0, 1]);
    expect(computeMCBands(shuttle()).map(b => b.mc)).toEqual([2, 3, 4]);
    expect(computeMCBands(wasp()).map(b => b.mc)).toEqual([0, 1, 2]);
  });
});

describe('hit boxes', () => {
  it('matches the Wasp tonnage row', () => {
    const byId = Object.fromEntries(computeBoxGroups(wasp()).map(g => [g.id, g]));
    expect(byId.hull.boxes).toBe(3);
    expect(byId.hull.safe).toBe(true);
    expect(byId.helm.boxes).toBe(1);
    expect(byId.sails.boxes).toBe(1);
    expect(byId.rudders.boxes).toBe(9);
    expect(byId.weapons.boxes).toBe(1);
    expect(byId.cargo.boxes).toBe(3);
    expect(byId.crew_quarters.boxes).toBe(2);
    expect(byId.reserve).toBeUndefined();
  });

  it('armor takes safe boxes for heavier armors', () => {
    const byId = Object.fromEntries(computeBoxGroups(damselfly()).map(g => [g.id, g]));
    expect(byId.armor.boxes).toBe(6);
    expect(byId.armor.safe).toBe(true);
    expect(byId.hull.boxes).toBe(5);
  });

  it('shows unfurnished mass as reserve', () => {
    const b = buildBase({
      armorId: 'wood', totalMass: 20, sails: 4, rudders: 2,
      crewCount: 3, crewQuarters: 1, cargoArea: 2,
    });
    const byId = Object.fromEntries(computeBoxGroups(b).map(g => [g.id, g]));
    expect(byId.reserve.boxes).toBe(6); // 20 − (3+1+4+3+1+2)
  });
});

describe('tonnage helpers + overload', () => {
  it('reports used/remaining/fitting in whole tons', () => {
    const b = buildBase({
      armorId: 'wood', totalMass: 20, sails: 4, rudders: 2,
      crewCount: 3, crewQuarters: 1, cargoArea: 2,
    });
    expect(computeUsedMass(b)).toBe(14);       // 3 hull + 1 helm + 4 sails + 3 rudders + 1 quarters + 2 cargo
    expect(computeRemainingMass(b)).toBe(6);
    expect(computeFittingMass(b)).toBe(11);
  });

  it('surfaces overload as negative remaining mass', () => {
    const b = buildBase({ armorId: 'stone', totalMass: 20, sails: 10, rudders: 4, cargoArea: 10 });
    expect(computeRemainingMass(b)).toBeLessThan(0);
    expect(computeShipBuild(b).overload).toBe(true);
  });
});

describe('command bridge', () => {
  it('adds +5 command per bridge', () => {
    expect(computeCommandBonus(starMoth())).toBe(5);
    expect(computeCommandBonus(buildBase({ armorId: 'wood', totalMass: 20, commandBridge: 2 }))).toBe(10);
  });
});

describe('build cost', () => {
  it('sums weapon + accessory costs (component gold is not yet defined)', () => {
    const b = buildBase({
      armorId: 'wood', totalMass: 40,
      weapons: [wpn('ballista_light', 2), wpn('catapult_medium', 1)],
      accessories: [acc('ram')],
    });
    expect(computeBuildCost(b)).toBe(6800); // 2×500 + 800 + 5000
  });
});

describe('computeShipBuild aggregate', () => {
  it('returns the full mass-first stat block', () => {
    const b = buildBase({
      armorId: 'wood', totalMass: 20, sails: 4, rudders: 2,
      crewCount: 3, crewQuarters: 1, cargoArea: 2,
    });
    const s = computeShipBuild(b);
    expect(s.totalMass).toBe(20);
    expect(s.hullMass).toBe(3);
    expect(s.hullMassExact).toBeCloseTo(2.8, 6);
    expect(s.armorMass).toBe(0);
    expect(s.fittingMass).toBe(11);
    expect(s.usedMass).toBe(14);
    expect(s.remainingMass).toBe(6);
    expect(s.overload).toBe(false);
    expect(s.crew).toBe(3);
    expect(s.minCrew).toBe(4);
    expect(s.crewQuarters).toBe(1);
    expect(s.crewCapacity).toBe(5);
    expect(s.passengers).toBe(0);
    expect(s.ac).toBe(15);
    expect(s.shipHp).toBe(100);
    expect(s.accel).toBe(4.5);
    expect(s.atmosphericSpeed).toBe(0);
    expect(s.damageThreshold).toBe(15);
    expect(s.mcRaw).toBe(3);
    expect(s.mcBands.map(b => b.mc)).toEqual([2, 3, 4]);
    expect(s.commandBonus).toBe(0);
    expect(s.tonnage.used).toBe(14);
    expect(s.boxGroups.length).toBeGreaterThan(0);
  });

  it('passes authored atmospheric speed and damage threshold through', () => {
    const s = computeShipBuild(buildBase({
      armorId: 'wood', totalMass: 20, atmosphericSpeed: 6, damageThreshold: 20,
    }));
    expect(s.atmosphericSpeed).toBe(6);
    expect(s.damageThreshold).toBe(20);
  });
});
