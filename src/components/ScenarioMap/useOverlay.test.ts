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
const MOVE_WHITE = 'rgba(255, 255, 255, 0.60)'; // droppable, 1st action
const WITHDRAW = 'rgba(255, 255, 255, 0.32)';   // withdraw (2-action) rear hexes
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
  }).fills;
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
  }).fills;
}

describe('computeOverlayMap — withdraw rear hexes', () => {
  it('paints the two rear hexes with the dim withdraw shade for a formed unit', () => {
    const map = overlayFor([mk({ id: 'u', hex: h(0, 0), facing: 0 })]);
    // Facing 0 → rear dirs 1 (0,1) and 2 (-1,1). Withdraw is the 2-action action
    // → dimmer than a one-action step.
    expect(map['0,1']).toBe(WITHDRAW);
    expect(map['-1,1']).toBe(WITHDRAW);
  });

  it('does not offer withdraw to a loose (Scattered) unit', () => {
    const map = overlayFor([mk({ id: 'u', hex: h(0, 0), facing: 0, currentFormation: 'Scattered' })]);
    // Scattered moves omnidirectionally, so rear hexes are reachable as a normal
    // (bright) step, not the dim withdraw shade.
    expect(map['0,1']).toBe(MOVE_WHITE);
  });

  it('a rear hex occupied by another unit is never a withdraw destination', () => {
    const map = overlayFor([mk({ id: 'u', hex: h(0, 0), facing: 0 }), mk({ id: 'b', hex: h(0, 1), team: 'blue' })]);
    expect(map['0,1']).not.toBe(WITHDRAW);
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
// target preview (range rings, melee/swoop colour) never rendered — for ANY
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
    }).fills;
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
    expect(map['0,1']).toBe(WITHDRAW);
    expect(map['-1,1']).toBe(WITHDRAW);
  });

  it('does NOT paint them (no highlight) when the unit cannot afford it', () => {
    const map = overlayFor([mk({ id: 'u', hex: h(0, 0), facing: 0, actionsAvailable: 0, movementPointsAvailable: 0 })]);
    expect(map['0,1']).not.toBe(WITHDRAW);
    expect(map['-1,1']).not.toBe(WITHDRAW);
  });
});

function labelsFor(units: Unit[], opts: { formationsMap?: Record<string, Formation>; showAll?: boolean; mode?: 'one' | 'all' } = {}) {
  return computeOverlayMap({
    reactionMode: null,
    draggingUnitId: 'u',
    hoveredUnit: null,
    units,
    alliances: ALLIANCES,
    formationsMap: opts.formationsMap ?? FORMATIONS,
    freeMove: false,
    backgroundConfig: { imageUrl: '', offsetX: 0, offsetY: 0, scale: 1, gridRadius: 12 },
    rangeViolationHex: null,
    terrainCosts: {},
    walls: {},
    showAllMoveMp: opts.showAll ?? false,
    movePreviewMode: opts.mode ?? 'one',
  }).labels;
}

describe('computeOverlayMap — leftover-MP boundary labels', () => {
  it('labels a boundary hex (bordering an occupied hex) with the MP left', () => {
    const labels = labelsFor([
      mk({ id: 'u', hex: h(0, 0), facing: 0, movementPoints: 3, movementPointsAvailable: 0, actionsAvailable: 1 }),
      mk({ id: 'blocker', hex: h(0, -2), team: 'blue' }),
    ]);
    // (0,-1) is reachable (1 MP) and borders the occupied (0,-2) → 3 - 1 = 2 left.
    expect(labels['0,-1']).toBe('2');
  });

  it('does not label an interior hex (all neighbours reachable, origin aside)', () => {
    const labels = labelsFor([mk({ id: 'u', hex: h(0, 0), facing: 0, movementPoints: 3 })]);
    expect(labels['0,-1']).toBeUndefined();
  });

  it('labels a turn-required (grey) hex only when showAllMoveMp is on', () => {
    const units = [mk({ id: 'u', hex: h(0, 0), facing: 0, movementPoints: 4 })];
    expect(labelsFor(units)['1,0']).toBeUndefined();              // grey, off → unlabelled
    expect(labelsFor(units, { showAll: true })['1,0']).toBeDefined(); // grey, on → labelled
  });

  it('labels the charge corridor (0 on its far border)', () => {
    const units = [mk({ id: 'u', hex: h(0, 0), facing: 0, isCharging: true, movementPoints: 3 })];
    const labels = labelsFor(units);
    expect(labels['0,-2']).toBe('1'); // 3 MP pool, 2 hexes in → 1 left
    expect(labels['0,-3']).toBe('0'); // far border → 0 left
  });
});

function movesFor(units: Unit[], mode: 'one' | 'all') {
  return computeOverlayMap({
    reactionMode: null,
    draggingUnitId: 'u',
    hoveredUnit: null,
    units,
    alliances: ALLIANCES,
    formationsMap: FORMATIONS,
    freeMove: false,
    backgroundConfig: { imageUrl: '', offsetX: 0, offsetY: 0, scale: 1, gridRadius: 12 },
    rangeViolationHex: null,
    terrainCosts: {},
    walls: {},
    movePreviewMode: mode,
  }).fills;
}

describe('computeOverlayMap — move preview mode', () => {
  const GREY = 'rgba(190, 190, 190, 0.54)';
  // 2 MP per action, 2 actions, 0 MP: one pool = 2 MP → (2,0) (turn + 2 steps = 3)
  // needs a 2nd action.
  const unit = () => mk({ id: 'u', hex: h(0, 0), facing: 0, movementPoints: 2, movementPointsAvailable: 0, actionsAvailable: 2 });

  it("'one' (default) excludes hexes that need a 2nd action", () => {
    const map = movesFor([unit()], 'one');
    expect(map['0,-1']).toBe(MOVE_WHITE);   // straight, 1 MP, droppable
    expect(map['1,0']).toBe(GREY);          // turn + step = 2 MP (within one action)
    expect(map['2,0']).toBeUndefined();     // turn + 2 steps = 3 MP → needs a 2nd action
  });

  it("'all' includes them, banded brighter for fewer actions", () => {
    const map = movesFor([unit()], 'all');
    expect(map['2,0']).toBeDefined();       // 2nd-action hex now reachable
    const alpha = (c: string) => Number(c.match(/([\d.]+)\)$/)?.[1] ?? '0');
    expect(alpha(map['2,0'])).toBeLessThan(alpha(map['1,0'])); // more actions → dimmer
  });

  it('does not highlight an over-budget hex (execution soft gate handles it)', () => {
    // (4,0) costs 5 MP (turn + 4 steps) > all 4 MP → excluded from the highlight.
    expect(movesFor([unit()], 'all')['4,0']).toBeUndefined();
  });
});

describe('computeOverlayMap — label format', () => {
  it("one-action mode: plain MP number", () => {
    const units = [mk({ id: 'u', hex: h(0, 0), facing: 0, movementPoints: 2, movementPointsAvailable: 0, actionsAvailable: 2 })];
    const labels = labelsFor(units, { showAll: true, mode: 'one' });
    expect(labels['1,0']).toBe('0'); // turn + step = 2 MP of the one action
  });

  it('all-actions mode: `{actions left}-{MP left}`, no prefix in the one-action reach', () => {
    const units = [mk({ id: 'u', hex: h(0, 0), facing: 0, movementPoints: 2, movementPointsAvailable: 0, actionsAvailable: 2 })];
    const labels = labelsFor(units, { showAll: true, mode: 'all' });
    expect(labels['1,0']).toBe('0'); // one-action reach → plain MP
    expect(labels['2,0']).toBe('0-1'); // 2 actions spent → 0 left, 1 MP left
  });

  it('withdraw hexes: `{actions left}-{MP left}`', () => {
    const units = [mk({ id: 'u', hex: h(0, 0), facing: 0, movementPoints: 4, movementPointsAvailable: 2, actionsAvailable: 2 })];
    const labels = labelsFor(units, { showAll: true, mode: 'one' });
    expect(labels['0,1']).toBe('0-2'); // 2 actions spent, MP untouched
  });
});
