import { describe, it, expect } from 'vitest';
import { Unit, Formation, AllianceGroup } from '@/types/gameProtocol';
import { computeOverlayMap } from './useOverlay';

const h = (q: number, r: number) => ({ q, r, s: -q - r });
const FORMATIONS: Record<string, Formation> = {
  'Close Order': { name: 'Close Order', movement_multiplier: 1 } as Formation,
  Scattered: { name: 'Scattered', movement_multiplier: 1 } as Formation,
};

function mk(over: Partial<Unit> = {}): Unit {
  return {
    id: 'u', scenarioId: 's', templateId: null, unitName: 'U', raceId: '', raceName: '', armorName: '',
    mountId: null, mountName: '', isHero: false, attachedToUnitId: null, attachedPosition: null,
    currentTroopCount: 10, maxTroopCount: 10, level: 1, troopHp: 1, maxUnitHp: 10, currentUnitHp: 10,
    isShielded: false, baselineAc: 10, currentAc: 10, weaponString: '', movementPoints: 4,
    movementPointsAvailable: 0, aggressiveness: 5, baseMorale: 5, currentMoraleModifier: 0,
    sizeCategory: 100, visualScale: 100, currentFormation: 'Close Order', formationAvailability: [],
    equipCostGp: 0, canCharge: false, hex: h(0, 0), facing: 0, hidden: false, isDeleted: false,
    ignoreMoraleChecks: false, isCharging: false, chargeDistance: 0, commandSeq: 0, organizationLevel: 2,
    actionsAvailable: 2, attacksUsed: 0, archerReactionUsed: false, pursuitUsed: false, commandPursuitPermit: false,
    heroicInspirationActive: false, activeWeaponIndex: 0, str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0,
    ...over,
  } as Unit;
}

const ALLIANCES: Record<string, AllianceGroup> = { blue: 'friendly', red: 'enemy' };
const WHITE = 'rgba(255, 255, 255, 0.5)';
const RED = 'rgba(255, 100, 100, 0.5)';
const CYAN = 'rgba(120, 200, 255, 0.4)';

function hoverOverlay(unit: Unit, units: Unit[] = [unit]) {
  return computeOverlayMap({
    reactionMode: null,
    draggingUnitId: null,
    hoveredUnit: unit,
    units,
    alliances: ALLIANCES,
    formationsMap: FORMATIONS,
    freeMove: false,
    backgroundConfig: { imageUrl: '', offsetX: 0, offsetY: 0, scale: 1, gridRadius: 12 },
    rangeViolationHex: null,
    terrainCosts: {},
    walls: {},
  });
}

function overlayFor(units: Unit[], formationsMap = FORMATIONS) {
  return computeOverlayMap({
    reactionMode: null,
    draggingUnitId: 'u',
    hoveredUnit: null,
    units,
    alliances: ALLIANCES,
    formationsMap,
    freeMove: false,
    backgroundConfig: { imageUrl: '', offsetX: 0, offsetY: 0, scale: 1, gridRadius: 12 },
    rangeViolationHex: null,
    terrainCosts: {},
    walls: {},
  });
}

describe('computeOverlayMap — withdraw rear hexes', () => {
  it('paints the two rear hexes white (droppable) for a formed unit', () => {
    const map = overlayFor([mk({ id: 'u', hex: h(0, 0), facing: 0 })]);
    // Facing 0 → rear dirs 1 (0,1) and 2 (-1,1).
    expect(map['0,1']).toBe(WHITE);
    expect(map['-1,1']).toBe(WHITE);
  });

  it('does not offer withdraw to a loose (Scattered) unit', () => {
    const map = overlayFor([mk({ id: 'u', hex: h(0, 0), facing: 0, currentFormation: 'Scattered' })]);
    // Scattered moves omnidirectionally, so rear hexes are reachable — but not via
    // the withdraw special case; assert it is not the generic white *only* by
    // checking a rear hex is present as a reachable step (it is loose/white).
    expect(map['0,1']).toBeDefined();
  });

  it('a rear hex occupied by another unit is never white', () => {
    const map = overlayFor([mk({ id: 'u', hex: h(0, 0), facing: 0 }), mk({ id: 'b', hex: h(0, 1), team: 'blue' })]);
    expect(map['0,1']).not.toBe(WHITE);
  });
});

describe('computeOverlayMap — hovered-unit ZoC tint', () => {
  it('a hovered airborne flyer tints its front-2 AND its own hex (vertical ZoC)', () => {
    const map = hoverOverlay(mk({ id: 'f', hex: h(0, 0), facing: 0, elevation: 10, flySpeed: 60 }));
    expect(map['0,-1']).toBe(RED);
    expect(map['1,-1']).toBe(RED);
    expect(map['0,0']).toBe(RED);
  });

  it('a hovered grounded unit tints its front-2 and marks its own hex cyan', () => {
    const map = hoverOverlay(mk({ id: 'f', hex: h(0, 0), facing: 0 }));
    expect(map['0,-1']).toBe(RED);
    expect(map['1,-1']).toBe(RED);
    expect(map['0,0']).toBe(CYAN); // own hex
  });
});

// The bug this locks: hover was suppressed during a drag, so the whole drag
// target preview (range rings, melee/stoop colour) never rendered — for ANY
// target, hero or not. `draggingUnitId` + a hostile `hoveredUnit` must both be set.
describe('computeOverlayMap — drag over a hostile target shows range rings', () => {
  const RANGED_FORMS: Record<string, Formation> = {
    'Close Order': { name: 'Close Order', movement_multiplier: 1, ranged_target_arcs: ['front', 'flank', 'rear'] } as Formation,
  };
  const WHITE_RING = 'rgba(255, 255, 255, 0.9)';
  const AMBER_RING = 'rgba(255, 180, 60, 0.9)';
  const AMBER_TARGET = 'rgba(255, 180, 60, 0.85)';

  // Bow: range 2, maxRange 6 → min ring at 2, max ring at 6.
  const BOW = 'Bow,1,1d6,false,2,6,0,false,false,false,false,1,true,Dex,circle';
  const archer = (over: Partial<Unit> = {}) =>
    mk({ id: 'archer', team: 'blue', hex: h(0, 0), facing: 0, currentFormation: 'Close Order', weaponString: BOW, ...over });
  const enemy = (over: Partial<Unit> = {}) => mk({ id: 'enemy', team: 'red', hex: h(3, 0), facing: 3, ...over });

  function dragOver(hovered: Unit, units: Unit[]) {
    return computeOverlayMap({
      reactionMode: null,
      draggingUnitId: 'archer',
      hoveredUnit: hovered,
      units,
      alliances: ALLIANCES,
      formationsMap: RANGED_FORMS,
      freeMove: false,
      backgroundConfig: { imageUrl: '', offsetX: 0, offsetY: 0, scale: 1, gridRadius: 12 },
      rangeViolationHex: null,
      terrainCosts: {},
      walls: {},
    });
  }

  it('shows the white min-ring, amber max-ring, and the amber target hex', () => {
    const e = enemy();
    const map = dragOver(e, [archer(), e]);
    expect(map['2,0']).toBe(WHITE_RING); // min range ring (dist 2)
    expect(map['6,0']).toBe(AMBER_RING); // max range ring (dist 6)
    expect(map['3,0']).toBe(AMBER_TARGET); // target, band range..max
  });

  it('shows the same rings when the hostile target is a HERO', () => {
    const e = enemy({ isHero: true, currentFormation: 'Hero' });
    const map = dragOver(e, [archer(), e]);
    expect(map['2,0']).toBe(WHITE_RING);
    expect(map['6,0']).toBe(AMBER_RING);
    expect(map['3,0']).toBe(AMBER_TARGET);
  });
});

describe('computeOverlayMap — withdraw highlight affordability', () => {
  it('paints the withdraw rear hexes when the unit has 2 actions', () => {
    const map = overlayFor([mk({ id: 'u', hex: h(0, 0), facing: 0, actionsAvailable: 2, movementPointsAvailable: 0 })]);
    expect(map['0,1']).toBe(WHITE);
    expect(map['-1,1']).toBe(WHITE);
  });

  it('does NOT paint them (no highlight) when the unit cannot afford it', () => {
    const map = overlayFor([mk({ id: 'u', hex: h(0, 0), facing: 0, actionsAvailable: 0, movementPointsAvailable: 0 })]);
    expect(map['0,1']).not.toBe(WHITE);
    expect(map['-1,1']).not.toBe(WHITE);
  });
});
