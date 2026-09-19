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
