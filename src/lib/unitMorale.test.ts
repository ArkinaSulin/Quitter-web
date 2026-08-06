import { describe, it, expect } from 'vitest';
import {
  areHexesAdjacent,
  calcEnemyThreats,
  calcIsolation,
  computeEffectiveMoraleModifier,
  computeThreatRating,
} from './unitMorale';
import { Unit, AllianceGroup } from '@/types/gameProtocol';

function makeUnit(overrides: Partial<Unit> = {}): Unit {
  return {
    id: 'u1',
    scenarioId: 's1',
    templateId: null,
    unitName: 'Test Unit',
    raceId: '',
    raceName: '',
    armorName: '',
    mountId: null,
    mountName: '',
    isHero: false,
    attachedToUnitId: null,
    attachedPosition: null,
    currentTroopCount: 20,
    maxTroopCount: 20,
    level: 5,
    troopHp: 10,
    maxUnitHp: 200,
    currentUnitHp: 200,
    isShielded: false,
    baselineAc: 14,
    currentAc: 14,
    weaponString: '',
    movementPoints: 3,
    movementPointsAvailable: 3,
    aggressiveness: 7,
    baseMorale: 7,
    currentMoraleModifier: 0,
    sizeCategory: 100,
    visualScale: 100,
    currentFormation: 'Open Order',
    formationAvailability: [],
    equipCostGp: 0,
    raceIconUrl: '',
    unitTypeIconUrl: '',
    customImageUrl: '',
    canCharge: false,
    ignoreMoraleChecks: false,
    hex: { q: 0, r: 0, s: 0 },
    facing: 0,
    team: 'blue',
    isRouting: false,
    hidden: false,
    isDeleted: false,
    isCharging: false,
    chargeDistance: 0,
    organizationLevel: 1,
    actionsAvailable: 1,
    activeWeaponIndex: 0,
    ...overrides,
  };
}

// computeThreatRating: levelComp + (sizeCategory/100)^2 + countComp
const threat1 = { level: 1, sizeCategory: 100, currentTroopCount: 1 }; // 0 + 1 + 0
const threat3 = { level: 3, sizeCategory: 100, currentTroopCount: 1 }; // 2 + 1 + 0
const threat4 = { level: 3, sizeCategory: 100, currentTroopCount: 5 }; // 2 + 1 + 1
const threat9 = { level: 13, sizeCategory: 100, currentTroopCount: 20 }; // 5 + 1 + 3

// HEX_DIRS index -> hex offset from unit.hex
const DIR_HEXES = [
  { q: 1, r: 0, s: -1 },
  { q: 0, r: 1, s: -1 },
  { q: -1, r: 1, s: 0 },
  { q: -1, r: 0, s: 1 },
  { q: 0, r: -1, s: 1 },
  { q: 1, r: -1, s: 0 },
];

const alliances: Record<string, AllianceGroup> = { blue: 'friendly', red: 'enemy' };

function enemyAt(hex: { q: number; r: number; s: number }, overrides: Partial<Unit> = {}): Unit {
  return makeUnit({
    id: `e-${hex.q}-${hex.r}-${hex.s}`,
    team: 'red',
    hex,
    ...overrides,
  });
}

describe('computeThreatRating', () => {
  it('computes from level, size, and troop count', () => {
    expect(computeThreatRating(makeUnit({ ...threat1 }))).toBe(1);
    expect(computeThreatRating(makeUnit({ ...threat3 }))).toBe(3);
    expect(computeThreatRating(makeUnit({ ...threat9 }))).toBe(9);
  });

  it('doubles a charging unit\'s threat', () => {
    expect(computeThreatRating(makeUnit({ ...threat3, isCharging: true }))).toBe(6);
    expect(computeThreatRating(makeUnit({ ...threat9, isCharging: true }))).toBe(18);
  });
});

describe('calcEnemyThreats', () => {
  it('returns zero when no enemies are adjacent', () => {
    const me = makeUnit({ ...threat1 });
    const far = enemyAt({ q: 2, r: 0, s: -2 }, { ...threat1 });
    expect(calcEnemyThreats(me, [far], alliances)).toMatchObject({ frontSide: 0, rear: 0 });
  });

  it('ignores friendly and deleted units', () => {
    const me = makeUnit({ ...threat1 });
    const friendly = makeUnit({ id: 'f1', team: 'blue', hex: DIR_HEXES[0], ...threat1 });
    const deleted = enemyAt(DIR_HEXES[1], { ...threat1, isDeleted: true });
    expect(calcEnemyThreats(me, [friendly, deleted], alliances)).toMatchObject({ frontSide: 0, rear: 0 });
  });

  it('ignores routing enemies — a routing unit exerts no threat', () => {
    const me = makeUnit({ ...threat1 });
    const routed = enemyAt(DIR_HEXES[5], { ...threat9, isRouting: true });
    expect(calcEnemyThreats(me, [routed], alliances)).toMatchObject({ frontSide: 0, rear: 0 });
  });

  it('stops counting threat from an enemy once it routs', () => {
    const me = makeUnit({ ...threat1 });
    const flanker = enemyAt(DIR_HEXES[5], { ...threat1 });
    const routedRear = enemyAt(DIR_HEXES[1], { ...threat1, isRouting: true });
    expect(calcEnemyThreats(me, [flanker, routedRear], alliances)).toMatchObject({ frontSide: 1, rear: 0 });
  });

  it('counts an equal-strength enemy in the front/side arc', () => {
    const me = makeUnit({ ...threat1 });
    const enemy = enemyAt(DIR_HEXES[5], { ...threat1 });
    expect(calcEnemyThreats(me, [enemy], alliances)).toMatchObject({ frontSide: 1, rear: 0 });
  });

  it('doubles the threat level of an enemy in the rear arc', () => {
    const me = makeUnit({ ...threat1 });
    const enemy = enemyAt(DIR_HEXES[1], { ...threat1 });
    expect(calcEnemyThreats(me, [enemy], alliances)).toMatchObject({ frontSide: 0, rear: 2 });
  });

  it('rear scaling compounds with enemy strength', () => {
    const me = makeUnit({ ...threat3 });
    const enemy = enemyAt(DIR_HEXES[1], { ...threat9 });
    expect(calcEnemyThreats(me, [enemy], alliances)).toMatchObject({ frontSide: 0, rear: 6 });
  });

  it('counts a swarm of weak enemies that individually rounded to zero before', () => {
    const me = makeUnit({ ...threat3 });
    const swarm = [0, 3, 4, 5].map(i => enemyAt(DIR_HEXES[i], { ...threat1 }));
    const rear = [1, 2].map(i => enemyAt(DIR_HEXES[i], { ...threat1 }));
    expect(calcEnemyThreats(me, [...swarm, ...rear], alliances)).toMatchObject({ frontSide: 1, rear: 1 });
  });

  it('lets one strong enemy outweigh two weak ones', () => {
    const me = makeUnit({ ...threat5() });
    const twoWeak = [enemyAt(DIR_HEXES[4], { ...threat3 }), enemyAt(DIR_HEXES[5], { ...threat4 })];
    const oneStrong = [enemyAt(DIR_HEXES[4], { ...threat9 })];
    const weakThreat = calcEnemyThreats(me, twoWeak, alliances).frontSide;
    const strongThreat = calcEnemyThreats(me, oneStrong, alliances).frontSide;
    expect(weakThreat).toBe(1);
    expect(strongThreat).toBe(2);
    expect(strongThreat).toBeGreaterThan(weakThreat);
  });

  it('full equal surround: 4 front/side + 2 doubled rear', () => {
    const me = makeUnit({ ...threat1 });
    const ring = DIR_HEXES.map(h => enemyAt(h, { ...threat1 }));
    expect(calcEnemyThreats(me, ring, alliances)).toMatchObject({ frontSide: 4, rear: 4 });
  });

  it('facing moves an enemy between front/side and rear arcs', () => {
    const meFacing0 = makeUnit({ ...threat1, facing: 0 });
    const enemy = enemyAt(DIR_HEXES[0], { ...threat1 });
    expect(calcEnemyThreats(meFacing0, [enemy], alliances)).toMatchObject({ frontSide: 1, rear: 0 });

    const meFacing5 = makeUnit({ ...threat1, facing: 5 });
    expect(calcEnemyThreats(meFacing5, [enemy], alliances)).toMatchObject({ frontSide: 0, rear: 2 });
  });
});

describe('areHexesAdjacent', () => {
  it('is true for each adjacent hex', () => {
    for (const d of DIR_HEXES) {
      expect(areHexesAdjacent({ q: 0, r: 0, s: 0 }, d)).toBe(true);
    }
  });

  it('is false for the same hex, distance 2, and diagonals', () => {
    expect(areHexesAdjacent({ q: 0, r: 0, s: 0 }, { q: 0, r: 0, s: 0 })).toBe(false);
    expect(areHexesAdjacent({ q: 0, r: 0, s: 0 }, { q: 2, r: 0, s: -2 })).toBe(false);
    expect(areHexesAdjacent({ q: 0, r: 0, s: 0 }, { q: 2, r: -1, s: -1 })).toBe(false);
  });
});

describe('calcIsolation', () => {
  it('isolated when no friendly unit is adjacent', () => {
    const me = makeUnit({ ...threat1 });
    expect(calcIsolation(me, [enemyAt(DIR_HEXES[0], { ...threat1 })], alliances)).toBe(true);
  });

  it('not isolated when a friendly unit is adjacent', () => {
    const me = makeUnit({ ...threat1 });
    const buddy = makeUnit({ id: 'b1', team: 'blue', hex: DIR_HEXES[0], ...threat1 });
    expect(calcIsolation(me, [buddy], alliances)).toBe(false);
  });
});

describe('computeEffectiveMoraleModifier', () => {
  it('sums wounds, isolation, and threat penalties', () => {
    const me = makeUnit({ ...threat1, currentUnitHp: 100, maxUnitHp: 200 }); // wounds -5
    const ring = DIR_HEXES.map(h => enemyAt(h, { ...threat1 }));
    expect(computeEffectiveMoraleModifier(me, ring, alliances)).toBe(-5 - 1 - 8);
  });

  it('applies the formation morale modifier', () => {
    const me = makeUnit({ ...threat1, currentUnitHp: 100, maxUnitHp: 200 });
    expect(computeEffectiveMoraleModifier(me, [], alliances, 3)).toBe(-5 - 1 + 3);
  });
});

function threat5(): Partial<Unit> {
  return { level: 5, sizeCategory: 100, currentTroopCount: 5 }; // 3 + 1 + 1
}
