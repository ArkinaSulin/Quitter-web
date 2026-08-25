import { describe, it, expect } from 'vitest';
import {
  areHexesAdjacent,
  calcEnemyThreats,
  calcIsolation,
  computeEffectiveMoraleModifier,
  computeThreatRating,
  isInKillZone,
  shouldRout,
} from './unitMorale';
import { Unit, AllianceGroup, Formation } from '@/types/gameProtocol';

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
    commandSeq: 0,
    organizationLevel: 1,
    actionsAvailable: 1,
    attacksUsed: 0,
    activeWeaponIndex: 0,
    str: 0,
    dex: 0,
    con: 0,
    int: 0,
    wis: 0,
    cha: 0,
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

  it('charging no longer multiplies threat (×2 removed)', () => {
    expect(computeThreatRating(makeUnit({ ...threat3, isCharging: true }))).toBe(3);
    expect(computeThreatRating(makeUnit({ ...threat9, isCharging: true }))).toBe(9);
  });
});

describe('isInKillZone', () => {
  it('covers the two front hexes of the unit\'s facing', () => {
    const me = makeUnit({ hex: { q: 0, r: 0, s: 0 }, facing: 0 });
    // Facing 0 front dirs = HEX_DIRS[4] and HEX_DIRS[5].
    expect(isInKillZone(me, DIR_HEXES[4])).toBe(true);
    expect(isInKillZone(me, DIR_HEXES[5])).toBe(true);
    expect(isInKillZone(me, DIR_HEXES[0])).toBe(false);
    expect(isInKillZone(me, DIR_HEXES[1])).toBe(false);
  });

  it('tracks facing: a different facing covers different hexes', () => {
    const me = makeUnit({ hex: { q: 0, r: 0, s: 0 }, facing: 3 });
    expect(isInKillZone(me, DIR_HEXES[1])).toBe(true);
    expect(isInKillZone(me, DIR_HEXES[2])).toBe(true);
    expect(isInKillZone(me, DIR_HEXES[4])).toBe(false);
  });

  it('Scattered and Routed formations have no kill zone', () => {
    const scattered = makeUnit({ hex: { q: 0, r: 0, s: 0 }, facing: 0, currentFormation: 'Scattered' });
    const routed = makeUnit({ hex: { q: 0, r: 0, s: 0 }, facing: 0, currentFormation: 'Routed', isRouting: true });
    expect(isInKillZone(scattered, DIR_HEXES[4])).toBe(false);
    expect(isInKillZone(routed, DIR_HEXES[4])).toBe(false);
  });

  it('false for non-adjacent hexes', () => {
    const me = makeUnit({ hex: { q: 0, r: 0, s: 0 }, facing: 0 });
    expect(isInKillZone(me, { q: 2, r: 0, s: -2 })).toBe(false);
  });
});

describe('calcEnemyThreats', () => {
  it('returns zero when no enemies are adjacent', () => {
    const me = makeUnit({ ...threat1 });
    const far = enemyAt({ q: 2, r: 0, s: -2 }, { ...threat1 });
    expect(calcEnemyThreats(me, [far], alliances)).toMatchObject({ total: 0, totalSum: 0, myThreat: 1 });
  });

  it('ignores friendly and deleted units', () => {
    const me = makeUnit({ ...threat1 });
    const friendly = makeUnit({ id: 'f1', team: 'blue', hex: DIR_HEXES[1], ...threat1 });
    const deleted = enemyAt(DIR_HEXES[2], { ...threat1, isDeleted: true });
    expect(calcEnemyThreats(me, [friendly, deleted], alliances)).toMatchObject({ total: 0 });
  });

  it('ignores routing enemies — a routing unit exerts no threat', () => {
    const me = makeUnit({ ...threat1 });
    const routed = enemyAt(DIR_HEXES[2], { ...threat9, isRouting: true });
    expect(calcEnemyThreats(me, [routed], alliances)).toMatchObject({ total: 0 });
  });

  it('an enemy threatens only while I stand in its kill zone (front two hexes)', () => {
    const me = makeUnit({ ...threat1 });
    // Enemy at facing 0 covers me only when I am at its DIR_HEXES[1] or [2].
    const covering = enemyAt(DIR_HEXES[1], { ...threat1 });
    const notCovering = enemyAt(DIR_HEXES[0], { ...threat1 });
    expect(calcEnemyThreats(me, [covering], alliances)).toMatchObject({ total: 1, totalSum: 1 });
    expect(calcEnemyThreats(me, [notCovering], alliances)).toMatchObject({ total: 0 });
  });

  it('an enemy\'s facing decides whether it covers me', () => {
    const me = makeUnit({ ...threat1 });
    // Enemy east of me (DIR_HEXES[0]) covers me when facing 5, not when facing 0.
    const facingAway = enemyAt(DIR_HEXES[0], { ...threat1, facing: 0 });
    const facingAtMe = enemyAt(DIR_HEXES[0], { ...threat1, facing: 5 });
    expect(calcEnemyThreats(me, [facingAway], alliances)).toMatchObject({ total: 0 });
    expect(calcEnemyThreats(me, [facingAtMe], alliances)).toMatchObject({ total: 1 });
  });

  it('Scattered / Routed enemies never impose threat', () => {
    const me = makeUnit({ ...threat1 });
    const scattered = enemyAt(DIR_HEXES[1], { ...threat1, currentFormation: 'Scattered' });
    const routed = enemyAt(DIR_HEXES[2], { ...threat1, currentFormation: 'Routed', isRouting: true });
    expect(calcEnemyThreats(me, [scattered, routed], alliances)).toMatchObject({ total: 0 });
  });

  it('sums multiple covering enemies and divides by my threat', () => {
    const me = makeUnit({ ...threat3 });
    const twoWeak = [enemyAt(DIR_HEXES[1], { ...threat3 }), enemyAt(DIR_HEXES[2], { ...threat4 })];
    const oneStrong = [enemyAt(DIR_HEXES[1], { ...threat9 })];
    expect(calcEnemyThreats(me, twoWeak, alliances)).toMatchObject({ total: 2, totalSum: 7 });
    expect(calcEnemyThreats(me, oneStrong, alliances)).toMatchObject({ total: 3 });
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
  it('sums wounds, isolation, and kill-zone threat penalties', () => {
    const me = makeUnit({ ...threat1, currentUnitHp: 100, maxUnitHp: 200 }); // wounds -5
    // Only the two enemies whose kill zone covers me (DIR_HEXES[1], [2]) impose
    // threat (each rating 1 → total 2); the other four don't.
    const ring = DIR_HEXES.map(h => enemyAt(h, { ...threat1 }));
    expect(computeEffectiveMoraleModifier(me, ring, alliances)).toBe(-5 - 1 - 2);
  });

  it('applies the formation morale modifier', () => {
    const me = makeUnit({ ...threat1, currentUnitHp: 100, maxUnitHp: 200 });
    expect(computeEffectiveMoraleModifier(me, [], alliances, { morale_modifier: 3 } as Formation)).toBe(-5 - 1 + 3);
  });

  it('Scattered / Routed enemies impose no threat (receiver threat arcs removed)', () => {
    const me = makeUnit({ ...threat1, currentUnitHp: 100, maxUnitHp: 200 });
    const scattered = enemyAt(DIR_HEXES[1], { ...threat1, currentFormation: 'Scattered' });
    const routed = enemyAt(DIR_HEXES[2], { ...threat1, currentFormation: 'Routed', isRouting: true });
    expect(computeEffectiveMoraleModifier(me, [scattered, routed], alliances)).toBe(-5 - 1);
  });
});

describe('shouldRout', () => {
  it('breaks morale when effective morale hits zero', () => {
    const me = makeUnit({ ...threat1, baseMorale: 3 });
    const ring = DIR_HEXES.map(h => enemyAt(h, { ...threat1 }));
    expect(shouldRout(me, ring, alliances)).toBe(true);
  });

  it('false when morale stays positive', () => {
    const me = makeUnit({ ...threat1, baseMorale: 10 });
    const few = DIR_HEXES.slice(0, 2).map(h => enemyAt(h, { ...threat1 }));
    expect(shouldRout(me, few, alliances)).toBe(false);
  });

  it('false for fearless or already-routing units', () => {
    const fearless = makeUnit({ ...threat1, baseMorale: 1, ignoreMoraleChecks: true });
    expect(shouldRout(fearless, DIR_HEXES.map(h => enemyAt(h, { ...threat1 })), alliances)).toBe(false);
    const routed = makeUnit({ ...threat1, baseMorale: 1, isRouting: true });
    expect(shouldRout(routed, DIR_HEXES.map(h => enemyAt(h, { ...threat1 })), alliances)).toBe(false);
  });
});
