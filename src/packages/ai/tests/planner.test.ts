import { describe, it, expect } from 'vitest';
import {
  planAiMoves,
  isAiControllable,
  enemyGroupsOf,
  legalTargets,
  allianceOf,
  assignMarks,
  targetPathCost,
  isFlankedAt,
  reverseDistanceMap,
  nextLegalTarget,
  isInFriendlyKillZone,
  structureComplexFor,
  edgeWalls,
  movementContextFor,
  distanceMap,
  AiPlanContext,
} from '@/packages/ai';
import { Unit, Hex, AllianceGroup, Formation, hexDistance } from '@/types/gameProtocol';
import { edgeRef, structuresToWalls } from '@/packages/movement';
import { HEX_DIRS } from '@/packages/primitives';

type StructureTemplates = NonNullable<AiPlanContext['structureTemplates']>;

const SPEAR = 'Spear,3,1d8,false,1,1,0,true,false,false,false,1,true,Dex,circle';
const SHORTBOW = 'Shortbow,2,1d6,false,2,3,0,false,true,true,false,1,true,Dex,circle';

function hex(q: number, r: number): Hex {
  return { q, r, s: -q - r };
}

const UNIT_DEFAULTS: Unit = {
  id: 'unset',
  scenarioId: 's',
  templateId: null,
  unitName: 'unset',
  raceId: '',
  raceName: '',
  armorName: '',
  mountId: null,
  mountName: '',
  isHero: false,
  attachedToUnitId: null,
  attachedPosition: null,
  currentTroopCount: 10,
  maxTroopCount: 10,
  level: 3,
  troopHp: 10,
  maxUnitHp: 100,
  currentUnitHp: 100,
  isShielded: false,
  baselineAc: 14,
  currentAc: 14,
  weaponString: SPEAR,
  movementPoints: 3,
  movementPointsAvailable: 0,
  aggressiveness: 7,
  baseMorale: 6,
  currentMoraleModifier: 0,
  moraleBoost: 0,
  sizeCategory: 100,
  visualScale: 100,
  currentFormation: 'Open Order',
  formationAvailability: ['Scattered', 'Open Order', 'Close Order'],
  equipCostGp: 0,
  canCharge: false,
  hex: { q: 0, r: 0, s: 0 },
  facing: 0,
  team: 'blue',
  hidden: false,
  isDeleted: false,
  ignoreMoraleChecks: false,
  isCharging: false,
  chargeDistance: 0,
  commandSeq: 0,
  organizationLevel: 1,
  actionsAvailable: 2,
  attacksUsed: 0,
  archerReactionUsed: false,
  pursuitUsed: false,
  heroicInspirationActive: false,
  activeWeaponIndex: 0,
  str: 0,
  dex: 0,
  con: 0,
  int: 0,
  wis: 0,
  cha: 0,
};

function mk(over: Partial<Unit> & { id: string; team: string; hex: Hex }): Unit {
  return { ...UNIT_DEFAULTS, ...over, unitName: over.id } as Unit;
}

const ALLIANCES: Record<string, AllianceGroup> = { blue: 'enemy', black: 'friendly' };

function form(name: string, org: number, mult = 1): Formation {
  return {
    id: `form-${name}`,
    name,
    melee_ac_modifier: 0,
    range_ac_modifier: 0,
    movement_multiplier: mult,
    attack_modifier: 0,
    morale_modifier: 0,
    row_capacity_multiplier: 1,
    attack_capacity_multiplier: 1,
    melee_target_arcs: ['front', 'flank', 'rear'],
    ranged_target_arcs: ['front', 'flank', 'rear'],
    threat_arcs: ['front'],
    double_threat_arcs: [],
    retaliate_arcs: { front: 'full', flank: 'rows', rear: 'none' },
    retaliate_vs_ranged: true,
    can_charge: org >= 1,
    stop_enemy_movement_arcs: ['front'],
    charge_through_arcs: [],
    be_attacked_melee_modifier: 1,
    be_attacked_range_modifier: 1,
    organization_level: org,
  };
}

const FORMS: Record<string, Formation> = {
  Scattered: form('Scattered', 0, 1.5),
  'Open Order': form('Open Order', 1, 1),
  'Close Order': form('Close Order', 2, 1),
  Phalanx: form('Phalanx', 3, 0.5),
};

function ctxOf(units: Unit[], teams = ['blue'], activeAlliance: AllianceGroup | null = 'enemy'): AiPlanContext {
  return { units, alliances: ALLIANCES, formations: FORMS, teams, activeAlliance };
}

function stepsOf(plans: ReturnType<typeof planAiMoves>, id: string) {
  return plans.plans.find(p => p.unitId === id)?.steps ?? [];
}

describe('Basic AI gates', () => {
  it('maps only friendly <-> enemy', () => {
    expect(Array.from(enemyGroupsOf('friendly'))).toEqual(['enemy']);
    expect(Array.from(enemyGroupsOf('enemy'))).toEqual(['friendly']);
    expect(enemyGroupsOf('neutral').size).toBe(0);
  });

  it('keeps heroes and invalid units out of AI control', () => {
    const ai = mk({ id: 'u1', team: 'blue', hex: hex(0, 0), actionsAvailable: 1 });
    const hosted = new Set<string>();
    expect(isAiControllable(ai, { alliances: ALLIANCES, teams: ['blue'], activeAlliance: 'enemy' }, hosted)).toBe(true);
    expect(isAiControllable({ ...ai, isHero: true }, { alliances: ALLIANCES, teams: ['blue'], activeAlliance: 'enemy' }, hosted)).toBe(false);
    expect(isAiControllable({ ...ai, attachedToUnitId: 'host' }, { alliances: ALLIANCES, teams: ['blue'], activeAlliance: 'enemy' }, hosted)).toBe(false);
    expect(isAiControllable({ ...ai, hidden: true }, { alliances: ALLIANCES, teams: ['blue'], activeAlliance: 'enemy' }, hosted)).toBe(false);
    expect(isAiControllable(ai, { alliances: ALLIANCES, teams: ['blue'], activeAlliance: null }, hosted)).toBe(false);
    expect(isAiControllable({ ...ai, hex: hex(4, 0) }, { alliances: ALLIANCES, teams: ['blue'], activeAlliance: 'enemy', gridRadius: 3 }, hosted)).toBe(false);
    expect(isAiControllable({ ...ai, hex: hex(3, 0) }, { alliances: ALLIANCES, teams: ['blue'], activeAlliance: 'enemy', gridRadius: 3 }, hosted)).toBe(true);
  });

  it('does not target off-grid enemies', () => {
    const unit = mk({ id: 'u1', team: 'blue', hex: hex(0, 0) });
    const offGrid = mk({ id: 'f1', team: 'black', hex: hex(4, 0) });
    const result = planAiMoves({ ...ctxOf([unit, offGrid]), gridRadius: 3 });
    expect(result.marks).toHaveLength(0);
    expect(result.plans).toHaveLength(0);
  });

  it('allianceOf resolves through the alliance map', () => {
    expect(allianceOf({ team: 'blue' }, ALLIANCES)).toBe('enemy');
  });
});

describe('Basic AI legal targets', () => {
  it('finds adjacent melee targets and ignores friends/hidden', () => {
    const attacker = mk({ id: 'u1', team: 'blue', hex: hex(0, 0), facing: 0 });
    const foe = mk({ id: 'f1', team: 'black', hex: hex(0, -1), facing: 2 });
    const friend = mk({ id: 'f2', team: 'blue', hex: hex(-1, 0) });
    const hidden = mk({ id: 'f3', team: 'black', hex: hex(1, -1), hidden: true });
    const targets = legalTargets(attacker, [attacker, foe, friend, hidden], { alliances: ALLIANCES, formations: FORMS, visibleHexes: null });
    expect(targets.map(t => t.unit.id)).toEqual(['f1']);
  });
});

describe('Basic AI marks', () => {
  const mkMarkCtx = (units: Unit[], enemies: Unit[]) => {
    const reachable = () => true;
    const distance = (u: Unit, t: Unit) => Math.abs(u.hex.q - t.hex.q) + Math.abs(u.hex.r - t.hex.r);
    return assignMarks({ units, enemies, archetypeOf: u => (u.weaponString === SHORTBOW ? 'ranged' : 'melee'), reachable, distance });
  };

  it('counts melee, ranged and flying marks independently', () => {
    const target = mk({ id: 't', team: 'black', hex: hex(0, 0) });
    const melee1 = mk({ id: 'm1', team: 'blue', hex: hex(1, 0) });
    const melee2 = mk({ id: 'm2', team: 'blue', hex: hex(2, 0) });
    const ranged = mk({ id: 'a1', team: 'blue', hex: hex(3, 0), weaponString: SHORTBOW });
    const result = mkMarkCtx([melee1, melee2, ranged], [target]);
    const counts = result.marks.reduce<Record<string, number>>((acc, m) => {
      acc[m.kind] = (acc[m.kind] ?? 0) + 1;
      return acc;
    }, {});
    expect(counts.melee).toBe(2);
    expect(counts.ranged).toBe(1);
  });

  it('caps melee at two and then overflows only when all targets are saturated', () => {
    const t1 = mk({ id: 't1', team: 'black', hex: hex(0, 0) });
    const t2 = mk({ id: 't2', team: 'black', hex: hex(4, 0) });
    const units = [
      mk({ id: 'm1', team: 'blue', hex: hex(1, 0) }),
      mk({ id: 'm2', team: 'blue', hex: hex(2, 0) }),
      mk({ id: 'm3', team: 'blue', hex: hex(3, 0) }),
      mk({ id: 'm4', team: 'blue', hex: hex(5, 0) }),
    ];
    const result = mkMarkCtx(units, [t1, t2]);
    expect(result.marks.filter(m => m.targetId === 't1' && m.kind === 'melee').length).toBe(2);
  });
});

describe('Basic AI melee', () => {
  it('never attacks before it is fully upgraded', () => {
    const unit = mk({ id: 'm1', team: 'blue', hex: hex(0, 0), currentFormation: 'Scattered', organizationLevel: 0 });
    const foe = mk({ id: 'f1', team: 'black', hex: hex(0, -1) });
    const result = planAiMoves(ctxOf([unit, foe]));
    const steps = stepsOf(result, 'm1');
    expect(steps.some(s => s.kind === 'attack')).toBe(false);
    expect(steps.some(s => s.kind === 'formation')).toBe(true);
  });

  it('attacks the adjacent target once fully upgraded', () => {
    const unit = mk({ id: 'm1', team: 'blue', hex: hex(0, 0), currentFormation: 'Close Order', organizationLevel: 2 });
    const foe = mk({ id: 'f1', team: 'black', hex: hex(0, -1) });
    const result = planAiMoves(ctxOf([unit, foe]));
    const steps = stepsOf(result, 'm1');
    const attacks = steps.filter(s => s.kind === 'attack');
    expect(attacks.length).toBe(2);
    expect(steps.some(s => s.kind === 'move')).toBe(false);
  });
});

describe('Basic AI ranged', () => {  it('closes up to shoot when no hostile is within 6', () => {
    const archer = mk({ id: 'a1', team: 'blue', hex: hex(0, 0), weaponString: SHORTBOW });
    const foe = mk({ id: 'f1', team: 'black', hex: hex(0, -3) });
    const result = planAiMoves(ctxOf([archer, foe]));
    const steps = stepsOf(result, 'a1');
    expect(steps.some(s => s.kind === 'formation' && s.formation === 'Close Order')).toBe(true);
    expect(steps.some(s => s.kind === 'attack')).toBe(true);
  });

  it('stays scattered when another hostile is within 6', () => {
    const archer = mk({ id: 'a1', team: 'blue', hex: hex(0, 0), weaponString: SHORTBOW });
    const foe = mk({ id: 'f1', team: 'black', hex: hex(0, -3) });
    const near = mk({ id: 'f2', team: 'black', hex: hex(5, 0) });
    const result = planAiMoves(ctxOf([archer, foe, near]));
    const steps = stepsOf(result, 'a1');
    expect(steps.some(s => s.kind === 'formation' && s.formation === 'Close Order')).toBe(false);
    expect(steps.some(s => s.kind === 'attack')).toBe(true);
  });
});

describe('Basic AI approach and special archetypes', () => {
  it('stages at range while a melee unit upgrades', () => {
    const unit = mk({ id: 'm1', team: 'blue', hex: hex(0, 0), currentFormation: 'Open Order', organizationLevel: 1 });
    const foe = mk({ id: 'f1', team: 'black', hex: hex(0, -6) });
    const result = planAiMoves(ctxOf([unit, foe]));
    const steps = stepsOf(result, 'm1');
    expect(steps.some(s => s.kind === 'move')).toBe(true);
  });

  it('plans a flying move or swoop for a flyer', () => {
    const flyer = mk({ id: 'fly1', team: 'blue', hex: hex(0, 0), flySpeed: 6, elevation: 20, currentFormation: 'Open Order', organizationLevel: 1 });
    const foe = mk({ id: 'f1', team: 'black', hex: hex(0, -5), facing: 2 });
    const result = planAiMoves(ctxOf([flyer, foe]));
    const steps = stepsOf(result, 'fly1');
    expect(steps.length).toBeGreaterThan(0);
    expect(steps.some(s => s.kind === 'move' || s.kind === 'swoop')).toBe(true);
  });

  it('holds at a valid charge start when no charge is available', () => {
    const mount = mk({ id: 'c1', team: 'blue', hex: hex(0, 0), mountId: 'horse', mountName: 'Horse', canCharge: true, movementPoints: 6 });
    const foe = mk({ id: 'f1', team: 'black', hex: hex(0, -6) });
    const result = planAiMoves(ctxOf([mount, foe]));
    const steps = stepsOf(result, 'c1');
    expect(steps.some(s => s.kind === 'move')).toBe(false);
    expect(steps.some(s => s.kind === 'charge')).toBe(false);
  });
});

describe('Basic AI structure complex confinement', () => {
  const structs = (keys: string[]) => Object.fromEntries(keys.map(k => [k, { templateId: 't' }])) as unknown as AiPlanContext['structures'];

  it('keeps a footprint unit on its connected hex structures', () => {
    const unit = mk({ id: 'm1', team: 'blue', hex: hex(0, 0), currentFormation: 'Close Order', organizationLevel: 2 });
    const foe = mk({ id: 'f1', team: 'black', hex: hex(0, -4) });
    const result = planAiMoves({ ...ctxOf([unit, foe]), structures: structs(['0,0', '0,-1']), structureTemplates: {} });
    const moves = stepsOf(result, 'm1').filter(s => s.kind === 'move');
    for (const m of moves) expect(['0,0', '0,-1']).toContain(`${m.to.q},${m.to.r}`);
  });

  it('keeps a courtyard unit inside its edge-wall enclosure', () => {
    const unit = mk({ id: 'm1', team: 'blue', hex: hex(0, 0), currentFormation: 'Close Order', organizationLevel: 2 });
    const foe = mk({ id: 'f1', team: 'black', hex: hex(0, -4) });
    const keys: string[] = [];
    for (let d = 0; d < 6; d++) keys.push(edgeRef(0, 0, d).key);
    const result = planAiMoves({ ...ctxOf([unit, foe]), structures: structs(keys), structureTemplates: {} });
    expect(stepsOf(result, 'm1').filter(s => s.kind === 'move')).toHaveLength(0);
  });

  it('lets a flyer leave the footprint', () => {
    const flyer = mk({ id: 'fly1', team: 'blue', hex: hex(0, 0), flySpeed: 6, elevation: 20 });
    const foe = mk({ id: 'f1', team: 'black', hex: hex(0, -4) });
    const result = planAiMoves({ ...ctxOf([flyer, foe]), structures: structs(['0,0', '0,-1']), structureTemplates: {} });
    const steps = stepsOf(result, 'fly1');
    const outside = ['0,0', '0,-1'];
    const left = steps.some(s =>
      (s.kind === 'move' && !outside.includes(`${s.to.q},${s.to.r}`)) ||
      (s.kind === 'swoop' && !outside.includes(`${s.target.q},${s.target.r}`)),
    );
    expect(left).toBe(true);
  });

  it('treats a ring of hex structures as an enclosure perimeter', () => {
    const ring = HEX_DIRS.map(d => `${d.q},${d.r}`);
    const ctx = { ...ctxOf([]), structures: structs(ring), structureTemplates: {} };
    expect(structureComplexFor({ hex: hex(0, 0) }, ctx)).toMatchObject({ kind: 'enclosure' });
    const ringKeys = new Set(structureComplexFor({ hex: hex(0, 0) }, ctx)?.hexes);
    expect(ringKeys.has('0,0')).toBe(true);
    expect(ringKeys.has('1,0')).toBe(false);
    // The open outside is not an enclosure.
    expect(structureComplexFor({ hex: hex(0, -4) }, ctx)).toBeNull();
  });
});

describe('Basic AI vacant structure tops', () => {
  const tower20 = {
    id: 'tower20', name: 'Tower', anchor: 'hex', elevation: 20,
    mpClimbUp: 4, mpClimbDown: 4, mpMountedUp: 4, mpMountedDown: 4,
  } as unknown as StructureTemplates[string];
  const tower10 = {
    id: 'tower10', name: 'Tower', anchor: 'hex', elevation: 10,
    mpClimbUp: 4, mpClimbDown: 4, mpMountedUp: 4, mpMountedDown: 4,
  } as unknown as StructureTemplates[string];
  const blockedTower = {
    id: 'blocked', name: 'Blocked tower', anchor: 'hex', elevation: 20,
    mpClimbUp: -1, mpClimbDown: 4, mpMountedUp: -1, mpMountedDown: 4,
  } as unknown as StructureTemplates[string];

  const climber = (over: Partial<Unit> = {}) => mk({
    id: 'm', team: 'blue', hex: hex(0, 1), currentFormation: 'Close Order',
    organizationLevel: 2, formationAvailability: ['Close Order'],
    movementPoints: 4, movementPointsAvailable: 0, actionsAvailable: 2,
    ...over,
  });

  it('assigns a vacant top before marking the defender', () => {
    const target = mk({ id: 't', team: 'black', hex: hex(1, 0), elevation: 10 });
    const structures = {
      '0,0': { templateId: 'tower20' },
      '1,0': { templateId: 'tower10' },
    } as unknown as AiPlanContext['structures'];
    const result = planAiMoves({
      ...ctxOf([climber({ actionsAvailable: 1 }), target]),
      structures,
      structureTemplates: { tower20, tower10 },
    });
    expect(result.objectives).toMatchObject([{ unitId: 'm', hex: hex(0, 0) }]);
    expect(stepsOf(result, 'm').some(s => s.kind === 'climb' && s.to.q === 0 && s.to.r === 0)).toBe(true);
  });

  it('spends the whole activation moving to the base and climbing', () => {
    const target = mk({ id: 't', team: 'black', hex: hex(1, 0), elevation: 10 });
    const structures = {
      '0,0': { templateId: 'tower20' },
      '1,0': { templateId: 'tower10' },
    } as unknown as AiPlanContext['structures'];
    const result = planAiMoves({
      ...ctxOf([climber({ hex: hex(0, 3), actionsAvailable: 2 }), target]),
      structures,
      structureTemplates: { tower20, tower10 },
    });
    const steps = stepsOf(result, 'm');
    expect(steps.some(s => s.kind === 'move')).toBe(true);
    expect(steps.some(s => s.kind === 'climb' && s.to.q === 0 && s.to.r === 0)).toBe(true);
  });

  it('holds instead of pacing when the only top cannot be climbed', () => {
    const target = mk({ id: 't', team: 'black', hex: hex(0, 0), elevation: 20 });
    const result = planAiMoves({
      ...ctxOf([climber({ hex: hex(0, 2) }), target]),
      structures: { '0,0': { templateId: 'blocked' } } as unknown as AiPlanContext['structures'],
      structureTemplates: { blocked: blockedTower },
    });
    expect(result.objectives).toEqual([]);
    expect(stepsOf(result, 'm').some(s => s.kind === 'move')).toBe(false);
  });

  it('keeps a locked top with no route and holds instead of pacing', () => {
    const target = mk({ id: 't', team: 'black', hex: hex(0, 0), elevation: 20 });
    const result = planAiMoves({
      ...ctxOf([climber({ hex: hex(0, 2) }), target]),
      structures: { '0,0': { templateId: 'blocked' } } as unknown as AiPlanContext['structures'],
      structureTemplates: { blocked: blockedTower },
      lockedObjectives: [{ unitId: 'm', hex: hex(0, 0) }],
    });
    expect(result.objectives).toEqual([{ unitId: 'm', hex: hex(0, 0) }]);
    expect(stepsOf(result, 'm').some(s => s.kind === 'move')).toBe(false);
  });
});

describe('Basic AI redundant wall pathing', () => {
  it('crosses a blocked wall that shares a hex-structure edge', () => {
    const tower = { id: 'tower', name: 'Tower', anchor: 'hex', elevation: 20, mpClimbUp: 4, mpMountedUp: 4 };
    const wall = { id: 'wall', name: 'Wall', anchor: 'edge', elevation: 20, mpClimbUp: 4, mpMountedUp: 4 };
    const shared = edgeRef(0, 0, 0).key; // (0,0) <-> (1,0), structure on (0,0)
    const structures = {
      '0,0': { templateId: 'tower' },
      [shared]: { templateId: 'wall' },
    } as unknown as AiPlanContext['structures'];
    const walls = {
      [shared]: { a: { block: true }, b: { block: true }, source: 'map' },
    } as unknown as AiPlanContext['walls'];
    const unit = mk({ id: 'm', team: 'blue', hex: hex(1, 0) });
    const ctx = {
      ...ctxOf([unit]),
      structures,
      structureTemplates: { tower, wall } as unknown as NonNullable<AiPlanContext['structureTemplates']>,
      walls,
    };
    const movement = movementContextFor(unit, [unit], ctx, 'ground');
    const map = distanceMap(unit, ctx, 'ground', movement);
    expect(map.has('0,0')).toBe(true);
  });
});

describe('Basic AI mounted charge hardening', () => {
  const chargeUnits = (over: Partial<Unit> = {}) => {
    const mount = mk({ id: 'c1', team: 'blue', hex: hex(0, 0), facing: 0, mountId: 'horse', mountName: 'Horse', canCharge: true, movementPoints: 6, actionsAvailable: 2, ...over });
    const target = mk({ id: 'f1', team: 'black', hex: hex(0, -3), facing: 0 });
    const friend = mk({ id: 'f2', team: 'blue', hex: hex(1, -3) });
    return [mount, target, friend];
  };

  it('uses the friendly kill zone for the 3-hex safety radius', () => {
    const friend = mk({ id: 'k', team: 'blue', hex: hex(1, 2), facing: 0 });
    const locked = mk({ id: 'c', team: 'black', hex: hex(2, 1) });
    const ctx = ctxOf([friend, locked]);
    expect(isInFriendlyKillZone(locked, friend, [friend, locked], ctx)).toBe(true);
    const turned = { ...friend, facing: 3 };
    expect(isInFriendlyKillZone(locked, turned, [turned, locked], ctx)).toBe(false);
  });

  it('moves out of a locked hostile kill-zone radius instead of holding', () => {
    const mount = mk({ id: 'c1', team: 'blue', hex: hex(2, 3), facing: 0, mountId: 'horse', mountName: 'Horse', canCharge: true, movementPoints: 6 });
    const locked = mk({ id: 'c', team: 'black', hex: hex(2, 1) });
    const target = mk({ id: 'b', team: 'black', hex: hex(-1, 1), facing: 3 });
    const friend = mk({ id: 'k', team: 'blue', hex: hex(1, 2), facing: 0 });
    const engaged = mk({ id: 'j', team: 'blue', hex: hex(-2, 1) });
    const result = planAiMoves({ ...ctxOf([mount, locked, target, friend, engaged]), chargeEnabled: false });
    const moves = stepsOf(result, 'c1').filter(s => s.kind === 'move');
    expect(moves.length).toBeGreaterThan(0);
    for (const m of moves) {
      expect(hexDistance(m.to, locked.hex)).toBeGreaterThanOrEqual(3);
    }
  });

  it('routes around a target that is too close and turns to face the lane', () => {
    const mount = mk({ id: 'c1', team: 'blue', hex: hex(0, 0), facing: 0, mountId: 'horse', mountName: 'Horse', canCharge: true, movementPoints: 6 });
    const foe = mk({ id: 'f1', team: 'black', hex: hex(0, -1), facing: 0 });
    const result = planAiMoves(ctxOf([mount, foe]));
    const steps = stepsOf(result, 'c1');
    const moveIdx = steps.findIndex(s => s.kind === 'move');
    expect(moveIdx).toBeGreaterThanOrEqual(0);
    expect(steps.slice(moveIdx + 1).some(s => s.kind === 'turn')).toBe(true);
    expect(steps.some(s => s.kind === 'charge' || s.kind === 'chargeEnd')).toBe(false);
  });

  it('charges from a side start with a straight lane to a rear landing', () => {
    const mount = mk({ id: 'c1', team: 'blue', hex: hex(1, 4), facing: 0, mountId: 'horse', mountName: 'Horse', canCharge: true, movementPoints: 6, actionsAvailable: 2 });
    const target = mk({ id: 'b', team: 'black', hex: hex(-1, 1), facing: 3 });
    const engaged = mk({ id: 'j', team: 'blue', hex: hex(-2, 1) });
    const result = planAiMoves(ctxOf([mount, target, engaged]));
    const steps = stepsOf(result, 'c1');
    expect(steps.some(s => s.kind === 'charge')).toBe(true);
    expect(steps.some(s => s.kind === 'attack' && s.charge)).toBe(true);
  });

  it('charges an engaged target from the rear on its first action', () => {
    const result = planAiMoves(ctxOf(chargeUnits()));
    const steps = stepsOf(result, 'c1');
    expect(steps.some(s => s.kind === 'charge')).toBe(true);
    expect(steps.some(s => s.kind === 'swoop')).toBe(false);
    expect(steps.some(s => s.kind === 'attack' && s.charge)).toBe(true);
    expect(steps.some(s => s.kind === 'chargeEnd')).toBe(true);
  });

  it('charges with a single action by converting it to MP', () => {
    const result = planAiMoves(ctxOf(chargeUnits({ actionsAvailable: 1, movementPointsAvailable: 0 })));
    const steps = stepsOf(result, 'c1');
    expect(steps.some(s => s.kind === 'charge')).toBe(true);
    expect(steps.some(s => s.kind === 'attack' && s.charge)).toBe(true);
  });

  it('may turn first, then charge if the remaining pool still pays for it', () => {
    const result = planAiMoves(ctxOf(chargeUnits({ facing: 3 })));
    const steps = stepsOf(result, 'c1');
    expect(steps.some(s => s.kind === 'turn')).toBe(true);
    expect(steps.some(s => s.kind === 'charge')).toBe(true);
  });

  it('converts the charge action into MP even with a small pool', () => {
    const result = planAiMoves(ctxOf(chargeUnits({ facing: 3, movementPoints: 2 })));
    const steps = stepsOf(result, 'c1');
    expect(steps.some(s => s.kind === 'charge')).toBe(true);
  });

  it('does not charge into a flank when the rear approaches are blocked', () => {
    // The target faces north; both rear neighbours are occupied, so only flank
    // landings remain. Mounted charges are rear-only.
    const mount = mk({
      id: 'c1', team: 'blue', hex: hex(2, 0), facing: 3,
      mountId: 'horse', mountName: 'Horse', canCharge: true, movementPoints: 6, actionsAvailable: 2,
    });
    const target = mk({ id: 'f1', team: 'black', hex: hex(0, 0), facing: 0 });
    const engaged = mk({ id: 'f2', team: 'blue', hex: hex(1, 0) });
    const rearA = mk({ id: 'f3', team: 'blue', hex: hex(0, 1) });
    const rearB = mk({ id: 'f4', team: 'blue', hex: hex(-1, 1) });
    const result = planAiMoves(ctxOf([mount, target, engaged, rearA, rearB]));
    const steps = stepsOf(result, 'c1');
    expect(steps.some(s => s.kind === 'charge')).toBe(false);
    expect(steps.some(s => s.kind === 'chargeEnd')).toBe(false);
  });

  it('does not charge when the Charge and Swoop toggle is off', () => {
    const result = planAiMoves({ ...ctxOf(chargeUnits()), chargeEnabled: false });
    expect(stepsOf(result, 'c1').some(s => s.kind === 'charge')).toBe(false);
  });

  it('does not charge when the unit cannot charge', () => {
    const result = planAiMoves(ctxOf(chargeUnits({ canCharge: false })));
    expect(stepsOf(result, 'c1').some(s => s.kind === 'charge')).toBe(false);
  });
});

describe('Basic AI flying swoop hardening', () => {
  const flyerUnits = (over: Partial<Unit> = {}) => {
    const flyer = mk({ id: 'fly1', team: 'blue', hex: hex(0, -1), facing: 0, flySpeed: 6, flySpeedAvailable: 6, elevation: 20, actionsAvailable: 2, ...over });
    const target = mk({ id: 'f1', team: 'black', hex: hex(0, -3), facing: 0 });
    return [flyer, target];
  };

  it('swoops a grounded target when airborne with fly points', () => {
    const result = planAiMoves(ctxOf(flyerUnits()));
    const steps = stepsOf(result, 'fly1');
    expect(steps.some(s => s.kind === 'charge')).toBe(true);
    expect(steps.some(s => s.kind === 'swoop')).toBe(true);
  });

  it('swoops a grounded target with no materialized fly points', () => {
    const result = planAiMoves(ctxOf(flyerUnits({ flySpeedAvailable: 0 })));
    const steps = stepsOf(result, 'fly1');
    expect(steps.some(s => s.kind === 'charge')).toBe(true);
    expect(steps.some(s => s.kind === 'swoop')).toBe(true);
  });

  it('swoops with a single action by converting it to fly MP', () => {
    const result = planAiMoves(ctxOf(flyerUnits({ actionsAvailable: 1, flySpeedAvailable: 0, facing: 5 })));
    const steps = stepsOf(result, 'fly1');
    expect(steps.some(s => s.kind === 'charge')).toBe(true);
    expect(steps.some(s => s.kind === 'swoop')).toBe(true);
  });

  it('may turn first, then swoop if the remaining pool still pays for it', () => {
    const result = planAiMoves(ctxOf(flyerUnits({ flySpeedAvailable: 0, facing: 3 })));
    const steps = stepsOf(result, 'fly1');
    expect(steps.some(s => s.kind === 'turn')).toBe(true);
    expect(steps.some(s => s.kind === 'swoop')).toBe(true);
  });

  it('converts the swoop action into fly MP even with a small pool', () => {
    const result = planAiMoves(ctxOf(flyerUnits({ flySpeed: 2, flySpeedAvailable: 0, facing: 3 })));
    const steps = stepsOf(result, 'fly1');
    expect(steps.some(s => s.kind === 'swoop')).toBe(true);
  });

  it('does not swoop when the Charge and Swoop toggle is off', () => {
    const result = planAiMoves({ ...ctxOf(flyerUnits()), chargeEnabled: false });
    const steps = stepsOf(result, 'fly1');
    expect(steps.some(s => s.kind === 'charge')).toBe(false);
    expect(steps.some(s => s.kind === 'swoop')).toBe(false);
  });

  it('prioritizes an airborne target and attacks it in melee', () => {
    const flyer = mk({ id: 'fly1', team: 'blue', hex: hex(0, 0), facing: 0, flySpeed: 6, flySpeedAvailable: 0, elevation: 20, actionsAvailable: 2 });
    const air = mk({ id: 'a1', team: 'black', hex: hex(0, -1), facing: 0, flySpeed: 6, elevation: 20 });
    const ground = mk({ id: 'g1', team: 'black', hex: hex(1, 0), facing: 0 });
    const result = planAiMoves(ctxOf([flyer, air, ground]));
    const steps = stepsOf(result, 'fly1');
    expect(result.marks.find(m => m.kind === 'flying' && m.byUnitId === 'fly1')?.targetId).toBe('a1');
    expect(steps.some(s => s.kind === 'attack' && s.targetId === 'a1')).toBe(true);
    expect(steps.some(s => s.kind === 'charge' || s.kind === 'swoop')).toBe(false);
  });

  it('flies adjacent to an airborne target and attacks it', () => {
    const flyer = mk({ id: 'fly1', team: 'blue', hex: hex(0, 0), facing: 0, flySpeed: 6, flySpeedAvailable: 0, elevation: 20, actionsAvailable: 2 });
    const air = mk({ id: 'a1', team: 'black', hex: hex(0, -2), facing: 0, flySpeed: 6, elevation: 20 });
    const result = planAiMoves(ctxOf([flyer, air]));
    const steps = stepsOf(result, 'fly1');
    expect(steps.some(s => s.kind === 'move')).toBe(true);
    expect(steps.some(s => s.kind === 'attack' && s.targetId === 'a1')).toBe(true);
    expect(steps.some(s => s.kind === 'swoop')).toBe(false);
  });

  it('fires at an airborne target when a ranged weapon is available', () => {
    const flyer = mk({ id: 'fly1', team: 'blue', hex: hex(0, 0), facing: 0, flySpeed: 6, flySpeedAvailable: 0, elevation: 20, actionsAvailable: 2, weaponString: SHORTBOW });
    const air = mk({ id: 'a1', team: 'black', hex: hex(0, -2), facing: 0, flySpeed: 6, elevation: 20 });
    const result = planAiMoves(ctxOf([flyer, air]));
    const steps = stepsOf(result, 'fly1');
    expect(steps.some(s => s.kind === 'attack' && s.targetId === 'a1')).toBe(true);
    expect(steps.some(s => s.kind === 'swoop')).toBe(false);
  });

  it('keeps pursuing an airborne target it cannot reach this activation', () => {
    const flyer = mk({ id: 'fly1', team: 'blue', hex: hex(0, 0), facing: 0, flySpeed: 6, flySpeedAvailable: 0, elevation: 20, actionsAvailable: 2 });
    const air = mk({ id: 'a1', team: 'black', hex: hex(0, -9), facing: 0, flySpeed: 6, elevation: 20 });
    const ground = mk({ id: 'g1', team: 'black', hex: hex(0, -1), facing: 0 });
    const result = planAiMoves(ctxOf([flyer, air, ground]));
    const steps = stepsOf(result, 'fly1');
    expect(steps.some(s => s.kind === 'move')).toBe(true);
    expect(steps.some(s => s.kind === 'swoop' || s.kind === 'charge')).toBe(false);
  });
});

describe('Basic AI engagement retargeting and pass-through', () => {
  const openOnly = { currentFormation: 'Open Order', organizationLevel: 1, formationAvailability: ['Open Order'] };

  it('does not treat pass-through friendlies as stopping points', () => {
    const map = new Map<string, number>([['0,-1', 1], ['0,-2', 2], ['1,-3', 3]]);
    expect(targetPathCost(map, hex(0, -3), new Set(['0,-1', '0,-2']))).toBe(3);
    expect(targetPathCost(map, hex(0, -3), new Set(['0,-1', '0,-2', '1,-3']))).toBe(Infinity);
  });

  it('lets a fully upgraded melee unit step into a hostile ZoC to attack', () => {
    const unit = mk({ id: 'm1', team: 'blue', hex: hex(0, 0), facing: 0, currentFormation: 'Close Order', organizationLevel: 2 });
    const foe = mk({ id: 'f1', team: 'black', hex: hex(0, -2), facing: 3, currentFormation: 'Close Order', organizationLevel: 2 });
    const result = planAiMoves(ctxOf([unit, foe]));
    const steps = stepsOf(result, 'm1');
    expect(steps.some(s => s.kind === 'move' && s.to.q === 0 && s.to.r === -1)).toBe(true);
    expect(steps.some(s => s.kind === 'attack')).toBe(true);
  });

  it('paths through Open Order friendlies to reach a free adjacent hex', () => {
    const rear = mk({ id: 'm1', team: 'blue', hex: hex(0, 0), facing: 0, movementPoints: 6, ...openOnly });
    const b1 = mk({ id: 'b1', team: 'blue', hex: hex(0, -1), isHero: true, ...openOnly });
    const b2 = mk({ id: 'b2', team: 'blue', hex: hex(0, -2), isHero: true, ...openOnly });
    const foe = mk({ id: 'f1', team: 'black', hex: hex(0, -3), facing: 0 });
    const result = planAiMoves(ctxOf([rear, b1, b2, foe]));
    const moves = stepsOf(result, 'm1').filter(s => s.kind === 'move');
    expect(moves.some(m => m.path.some(h => (h.q === 0 && h.r === -1) || (h.q === 0 && h.r === -2)))).toBe(true);
  });

  it('does not path through Close Order friendlies', () => {
    const rear = mk({ id: 'm1', team: 'blue', hex: hex(0, 0), facing: 0, movementPoints: 6, ...openOnly });
    const b1 = mk({ id: 'b1', team: 'blue', hex: hex(0, -1), currentFormation: 'Close Order', organizationLevel: 2, formationAvailability: ['Close Order'] });
    const b2 = mk({ id: 'b2', team: 'blue', hex: hex(0, -2), currentFormation: 'Close Order', organizationLevel: 2, formationAvailability: ['Close Order'] });
    const foe = mk({ id: 'f1', team: 'black', hex: hex(0, -3), facing: 0 });
    const result = planAiMoves({ ...ctxOf([rear, b1, b2, foe]), excludeUnitIds: ['b1', 'b2'] });
    const moves = stepsOf(result, 'm1').filter(s => s.kind === 'move');
    for (const m of moves) {
      expect(m.path.some(h => (h.q === 0 && h.r === -1) || (h.q === 0 && h.r === -2))).toBe(false);
    }
  });
});

describe('Basic AI facing, flank safety and escape', () => {
  it('only adjacent hostiles count as flanking', () => {
    const farFoe = mk({ id: 'far', team: 'black', hex: hex(0, 2) });
    const nearFoe = mk({ id: 'near', team: 'black', hex: hex(0, 1) });
    // Facing 0 (north): a unit to the south is rear.
    expect(isFlankedAt(hex(0, 0), 0, [farFoe], null)).toBe(false);
    expect(isFlankedAt(hex(0, 0), 0, [nearFoe], null)).toBe(true);
  });

  it('turns a full 180 degrees to engage a target behind it', () => {
    const unit = mk({ id: 'm1', team: 'blue', hex: hex(0, 0), facing: 0, currentFormation: 'Close Order', organizationLevel: 2, movementPoints: 3 });
    const foe = mk({ id: 'f1', team: 'black', hex: hex(0, 2), facing: 0 });
    const result = planAiMoves(ctxOf([unit, foe]));
    const steps = stepsOf(result, 'm1');
    expect(steps.some(s => s.kind === 'move' && s.to.r > 0)).toBe(true);
    expect(steps.some(s => s.kind === 'attack')).toBe(true);
  });

  it('still moves when a formed turn would spend the last action', () => {
    const unit = mk({
      id: 'm1', team: 'blue', hex: hex(0, 0), facing: 0,
      currentFormation: 'Open Order', organizationLevel: 1,
      formationAvailability: ['Open Order'],
      movementPoints: 3, movementPointsAvailable: 0, actionsAvailable: 1,
    });
    const foe = mk({ id: 'f1', team: 'black', hex: hex(0, 2), facing: 0 });
    const result = planAiMoves(ctxOf([unit, foe]));
    const steps = stepsOf(result, 'm1');
    expect(steps.some(s => s.kind === 'move' && s.to.r > 0)).toBe(true);
  });
});

describe('Basic AI dynamic melee mark cap', () => {
  it('honours a dynamic cap instead of overflowing', () => {
    const target = mk({ id: 't', team: 'black', hex: hex(0, 0) });
    const units = Array.from({ length: 8 }, (_, i) => mk({ id: `m${i}`, team: 'blue', hex: hex(2 + i, 0) }));
    const result = assignMarks({
      units,
      enemies: [target],
      archetypeOf: () => 'melee',
      reachable: () => true,
      distance: (u, t) => Math.abs(u.hex.q - t.hex.q) + Math.abs(u.hex.r - t.hex.r),
      meleeCap: () => 6,
    });
    expect(result.marks.filter(m => m.targetId === 't').length).toBe(6);
  });

  it('lets six melee units mark a target with six open surrounding hexes', () => {
    const target = mk({ id: 't', team: 'black', hex: hex(0, 0) });
    const positions: Hex[] = [hex(2, 0), hex(0, 2), hex(-2, 0), hex(0, -2), hex(2, -2), hex(-2, 2)];
    const units = positions.map((h, i) => mk({ id: `m${i}`, team: 'blue', hex: h, movementPoints: 3 }));
    const result = planAiMoves(ctxOf([...units, target]));
    const marks = result.marks.filter(m => m.targetId === 't' && m.kind === 'melee');
    expect(marks.length).toBe(6);
  });
});

describe('Basic AI reverse path distance', () => {
  it('measures the remaining path cost back to the target', () => {
    const unit = mk({ id: 'm1', team: 'blue', hex: hex(0, 0) });
    const target = mk({ id: 't', team: 'black', hex: hex(0, 2), currentFormation: 'Scattered', organizationLevel: 0 });
    const map = reverseDistanceMap(target.hex, unit, ctxOf([unit, target]), 'ground');
    expect(map.get('0,1')).toBe(1);
    expect(map.get('0,0')).toBe(2);
  });
});

describe('Basic AI adjacency, formation-up facing and climbing', () => {
  const SHIELD: Formation = { ...form('Shield Wall', 3), melee_target_arcs: ['front'] };

  it('turns and attacks an adjacent enemy in its flank/rear (D vs T)', () => {
    const d = mk({
      id: 'd', team: 'blue', hex: hex(1, 2), facing: 3,
      currentFormation: 'Shield Wall', organizationLevel: 3, formationAvailability: ['Shield Wall'],
    });
    const t = mk({ id: 't', team: 'black', hex: hex(0, 2) });
    const result = planAiMoves({ ...ctxOf([d, t]), formations: { ...FORMS, 'Shield Wall': SHIELD } });
    const steps = stepsOf(result, 'd');
    expect(steps.some(s => s.kind === 'attack')).toBe(true);
    expect(steps.some(s => s.kind === 'formation')).toBe(false);
  });

  it('uses leftover MP to face an adjacent hostile after forming up', () => {
    const unit = mk({
      id: 'm1', team: 'blue', hex: hex(0, 0), facing: 0,
      currentFormation: 'Scattered', organizationLevel: 0,
      formationAvailability: ['Scattered', 'Open Order', 'Close Order'],
      movementPoints: 3, movementPointsAvailable: 0, actionsAvailable: 1,
    });
    const foe = mk({ id: 'f1', team: 'black', hex: hex(1, 0) });
    const result = planAiMoves(ctxOf([unit, foe]));
    const steps = stepsOf(result, 'm1');
    expect(steps.some(s => s.kind === 'formation')).toBe(true);
    expect(steps.some(s => s.kind === 'turn')).toBe(true);
    expect(steps.some(s => s.kind === 'attack')).toBe(false);
  });

  it('climbs a 20-ft wall one 10-ft step per activation (no move+climb)', () => {
    const structures = { '0,0': { templateId: 'tower' } } as unknown as AiPlanContext['structures'];
    const templates = {
      tower: { id: 'tower', name: 'Tower', anchor: 'hex', elevation: 20, mpClimbUp: 6, mpMountedUp: 6 },
    } as unknown as AiPlanContext['structureTemplates'];
    const target = mk({ id: 't', team: 'black', hex: hex(0, 0), elevation: 20, currentFormation: 'Close Order', organizationLevel: 2 });
    const climber = mk({
      id: 'c', team: 'blue', hex: hex(1, 0), facing: 3,
      currentFormation: 'Close Order', organizationLevel: 2, formationAvailability: ['Close Order'],
      movementPoints: 3, movementPointsAvailable: 0, actionsAvailable: 2,
    });
    const result = planAiMoves({ ...ctxOf([climber, target]), structures, structureTemplates: templates });
    const steps = stepsOf(result, 'c');
    expect(steps.some(s => s.kind === 'climbAttack')).toBe(true);
    expect(steps.some(s => s.kind === 'move')).toBe(false);
  });

  it('locks a hanging climber onto its climb target', () => {
    const structures = { '0,0': { templateId: 'tower' } } as unknown as AiPlanContext['structures'];
    const templates = {
      tower: { id: 'tower', name: 'Tower', anchor: 'hex', elevation: 20, mpClimbUp: 6, mpMountedUp: 6 },
    } as unknown as AiPlanContext['structureTemplates'];
    const target = mk({ id: 't', team: 'black', hex: hex(0, 0), elevation: 20, currentFormation: 'Close Order', organizationLevel: 2 });
    const climber = mk({
      id: 'c', team: 'blue', hex: hex(1, 0), facing: 3, elevation: 10, climbTo: '0,0',
      currentFormation: 'Close Order', organizationLevel: 2, formationAvailability: ['Close Order'],
      movementPoints: 3, movementPointsAvailable: 0, actionsAvailable: 2,
    });
    const result = planAiMoves({ ...ctxOf([climber, target]), structures, structureTemplates: templates });
    const steps = stepsOf(result, 'c');
    expect(steps.some(s => s.kind === 'climbAttack')).toBe(true);
    expect(steps.some(s => s.kind === 'move' || s.kind === 'formation')).toBe(false);
  });
});

describe('Basic AI routed-target fallback', () => {
  const routed = (o: Partial<Unit> & { id: string; team: string; hex: Hex }) =>
    mk({ ...o, currentFormation: 'Routed', organizationLevel: 0 });

  it('ignores an adjacent routed enemy while any non-routed enemy exists', () => {
    const unit = mk({ id: 'm1', team: 'blue', hex: hex(0, 0), currentFormation: 'Close Order', organizationLevel: 2, formationAvailability: ['Close Order'] });
    const routedFoe = routed({ id: 'r1', team: 'black', hex: hex(1, 0) });
    const liveFoe = mk({ id: 'f1', team: 'black', hex: hex(2, 4) });
    const result = planAiMoves(ctxOf([unit, routedFoe, liveFoe]));
    const steps = stepsOf(result, 'm1');
    expect(steps.some(s => s.kind === 'attack')).toBe(false);
    expect(result.marks.every(m => m.targetId === 'f1')).toBe(true);
  });

  it('attacks routed enemies only when every enemy is routed', () => {
    const unit = mk({ id: 'm1', team: 'blue', hex: hex(0, 0), currentFormation: 'Close Order', organizationLevel: 2, formationAvailability: ['Close Order'] });
    const routedFoe = routed({ id: 'r1', team: 'black', hex: hex(1, 0) });
    const result = planAiMoves(ctxOf([unit, routedFoe]));
    const steps = stepsOf(result, 'm1');
    expect(steps.some(s => s.kind === 'attack' && s.targetId === 'r1')).toBe(true);
    expect(result.marks.some(m => m.targetId === 'r1')).toBe(true);
  });

  it('nextLegalTarget skips routed while a non-routed enemy exists', () => {
    const attacker = mk({ id: 'a', team: 'blue', hex: hex(0, 0), currentFormation: 'Close Order', organizationLevel: 2 });
    const routedFoe = routed({ id: 'r1', team: 'black', hex: hex(1, 0) });
    const farFoe = mk({ id: 'f1', team: 'black', hex: hex(2, 4) });
    const ctx = { alliances: ALLIANCES, formations: FORMS, visibleHexes: null };
    expect(nextLegalTarget(attacker, [attacker, routedFoe, farFoe], ctx)).toBeNull();
    expect(nextLegalTarget(attacker, [attacker, routedFoe], ctx)?.unit.id).toBe('r1');
  });

  it('nextLegalTarget orders by closest, then lowest morale', () => {
    const attacker = mk({ id: 'a', team: 'blue', hex: hex(0, 0), currentFormation: 'Close Order', organizationLevel: 2 });
    const high = mk({ id: 'high', team: 'black', hex: hex(1, 0), baseMorale: 9 });
    const low = mk({ id: 'low', team: 'black', hex: hex(0, 1), baseMorale: 3 });
    const pick = nextLegalTarget(attacker, [attacker, high, low], { alliances: ALLIANCES, formations: FORMS, visibleHexes: null });
    expect(pick?.unit.id).toBe('low');
  });
});

describe('Basic AI structure-top access', () => {
  const towerStructures = {
    '0,0': { templateId: 'tower' },
    '1,0': { templateId: 'tower' },
    '2,0': { templateId: 'tower' },
  } as unknown as AiPlanContext['structures'];
  const towerTemplates = {
    tower: { id: 'tower', name: 'Tower', anchor: 'hex', elevation: 10, mpClimbUp: 6, mpMountedUp: 6 },
  } as unknown as AiPlanContext['structureTemplates'];

  it('climbs into a free top gap to reach an interior top target', () => {
    const target = mk({ id: 't', team: 'black', hex: hex(2, 0), elevation: 10, currentFormation: 'Close Order', organizationLevel: 2 });
    const climber = mk({
      id: 'c', team: 'blue', hex: hex(0, 1), facing: 0,
      currentFormation: 'Close Order', organizationLevel: 2, formationAvailability: ['Close Order'],
      movementPoints: 3, movementPointsAvailable: 0, actionsAvailable: 2,
    });
    const result = planAiMoves({ ...ctxOf([climber, target]), structures: towerStructures, structureTemplates: towerTemplates });
    const steps = stepsOf(result, 'c');
    expect(steps.some(s => s.kind === 'climb' && (s.to.q === 0 || s.to.q === 1) && s.to.r === 0)).toBe(true);
  });

  it('does not climb when every top hex is occupied', () => {
    const target = mk({ id: 't', team: 'black', hex: hex(2, 0), elevation: 10, currentFormation: 'Close Order', organizationLevel: 2 });
    const blocker = mk({ id: 'b', team: 'blue', hex: hex(0, 0), elevation: 10, currentFormation: 'Close Order', organizationLevel: 2 });
    const blocker2 = mk({ id: 'b2', team: 'blue', hex: hex(1, 0), elevation: 10, currentFormation: 'Close Order', organizationLevel: 2 });
    const climber = mk({
      id: 'c', team: 'blue', hex: hex(0, 1), facing: 0,
      currentFormation: 'Close Order', organizationLevel: 2, formationAvailability: ['Close Order'],
      movementPoints: 3, movementPointsAvailable: 0, actionsAvailable: 2,
    });
    const result = planAiMoves({ ...ctxOf([climber, target, blocker, blocker2]), structures: towerStructures, structureTemplates: towerTemplates });
    expect(stepsOf(result, 'c').some(s => s.kind === 'climb')).toBe(false);
  });

  it('continues a free-gap climb from an existing climbTo', () => {
    const target = mk({ id: 't', team: 'black', hex: hex(1, 0), elevation: 20, currentFormation: 'Close Order', organizationLevel: 2 });
    const climber = mk({
      id: 'c', team: 'blue', hex: hex(0, 1), facing: 0, elevation: 10, climbTo: '0,0',
      currentFormation: 'Close Order', organizationLevel: 2, formationAvailability: ['Close Order'],
      movementPoints: 3, movementPointsAvailable: 0, actionsAvailable: 2,
    });
    const structures = { '0,0': { templateId: 'high' }, '1,0': { templateId: 'high' } } as unknown as AiPlanContext['structures'];
    const templates = { high: { id: 'high', name: 'High Tower', anchor: 'hex', elevation: 20, mpClimbUp: 6, mpMountedUp: 6 } } as unknown as AiPlanContext['structureTemplates'];
    const result = planAiMoves({ ...ctxOf([climber, target]), structures, structureTemplates: templates });
    expect(stepsOf(result, 'c').some(s => s.kind === 'climb' && s.to.q === 0 && s.to.r === 0)).toBe(true);
  });
});

describe('Basic AI hanging lock and structure hold', () => {
  const tower = { '0,0': { templateId: 'tower' } } as unknown as AiPlanContext['structures'];
  const towerTemplates = {
    tower: { id: 'tower', name: 'Tower', anchor: 'hex', elevation: 20, mpClimbUp: 6, mpMountedUp: 6 },
  } as unknown as AiPlanContext['structureTemplates'];

  it('climbs to a free top and does nothing else', () => {
    const climber = mk({
      id: 'c', team: 'blue', hex: hex(0, 1), elevation: 10, climbTo: '0,0',
      currentFormation: 'Scattered', organizationLevel: 0,
      movementPoints: 3, movementPointsAvailable: 0, actionsAvailable: 2,
    });
    const foe = mk({ id: 'f', team: 'black', hex: hex(3, 3) });
    const result = planAiMoves({ ...ctxOf([climber, foe]), structures: tower, structureTemplates: towerTemplates });
    const steps = stepsOf(result, 'c');
    expect(steps.some(s => s.kind === 'climb' && s.to.q === 0 && s.to.r === 0)).toBe(true);
    expect(steps.some(s => s.kind === 'attack' || s.kind === 'move' || s.kind === 'formation' || s.kind === 'drop')).toBe(false);
  });

  it('climb-attacks the weakest obstacle at the chosen top exit', () => {
    const climber = mk({
      id: 'c', team: 'blue', hex: hex(0, 0), elevation: 10,
      currentFormation: 'Scattered', organizationLevel: 0,
      movementPoints: 3, movementPointsAvailable: 0, actionsAvailable: 2,
    });
    const weak = mk({ id: 'weak', team: 'black', hex: hex(1, 0), elevation: 20, level: 1, currentTroopCount: 1 });
    const strong = mk({ id: 'strong', team: 'black', hex: hex(-1, 0), elevation: 20, level: 8, currentTroopCount: 10 });
    const structures = {
      '1,0': { templateId: 'tower' },
      '-1,0': { templateId: 'tower' },
    } as unknown as AiPlanContext['structures'];
    const result = planAiMoves({ ...ctxOf([climber, weak, strong]), structures, structureTemplates: towerTemplates });
    const steps = stepsOf(result, 'c');
    expect(steps.some(s => s.kind === 'climbAttack' && s.targetId === 'weak')).toBe(true);
  });

  it('routed hanging units never drop on their own', () => {
    const climber = mk({
      id: 'c', team: 'blue', hex: hex(0, 1), elevation: 10, climbTo: '0,0',
      currentFormation: 'Routed', organizationLevel: 0,
      movementPoints: 3, movementPointsAvailable: 0, actionsAvailable: 2,
    });
    const foe = mk({ id: 'f', team: 'black', hex: hex(3, 3) });
    const result = planAiMoves({ ...ctxOf([climber, foe]), structures: tower, structureTemplates: towerTemplates });
    const steps = stepsOf(result, 'c');
    expect(steps.some(s => s.kind === 'drop')).toBe(false);
  });

  it('ranged unit on top fires and does not leave the structure', () => {
    const archer = mk({
      id: 'a', team: 'blue', hex: hex(0, 0), elevation: 10, weaponString: SHORTBOW,
      currentFormation: 'Open Order', organizationLevel: 1, formationAvailability: ['Open Order', 'Close Order'],
    });
    const foe = mk({ id: 'f', team: 'black', hex: hex(0, -3) });
    const structures = { '0,0': { templateId: 'low' } } as unknown as AiPlanContext['structures'];
    const templates = { low: { id: 'low', name: 'Low', anchor: 'hex', elevation: 10 } } as unknown as AiPlanContext['structureTemplates'];
    const result = planAiMoves({ ...ctxOf([archer, foe]), structures, structureTemplates: templates });
    const steps = stepsOf(result, 'a');
    expect(steps.some(s => s.kind === 'attack')).toBe(true);
    expect(steps.some(s => s.kind === 'move')).toBe(false);
  });

  it('melee unit on top holds against a ground horde', () => {
    const unit = mk({
      id: 'm', team: 'blue', hex: hex(0, 0), elevation: 10,
      currentFormation: 'Close Order', organizationLevel: 2, formationAvailability: ['Close Order'],
    });
    const foe = mk({ id: 'f', team: 'black', hex: hex(0, -2) });
    const structures = { '0,0': { templateId: 'low' } } as unknown as AiPlanContext['structures'];
    const templates = { low: { id: 'low', name: 'Low', anchor: 'hex', elevation: 10 } } as unknown as AiPlanContext['structureTemplates'];
    const result = planAiMoves({ ...ctxOf([unit, foe]), structures, structureTemplates: templates });
    expect(stepsOf(result, 'm').some(s => s.kind === 'move')).toBe(false);
  });
});

describe('Basic AI climb affordability', () => {
  it('does not climb without an action and MP to pay', () => {
    const tower = { '0,0': { templateId: 'tower' } } as unknown as AiPlanContext['structures'];
    const templates = { tower: { id: 'tower', name: 'Tower', anchor: 'hex', elevation: 20, mpClimbUp: 6, mpMountedUp: 6 } } as unknown as AiPlanContext['structureTemplates'];
    const climber = mk({
      id: 'c', team: 'blue', hex: hex(0, 1), elevation: 10, climbTo: '0,0',
      currentFormation: 'Scattered', organizationLevel: 0,
      movementPoints: 3, movementPointsAvailable: 0, actionsAvailable: 1,
    });
    const foe = mk({ id: 'f', team: 'black', hex: hex(3, 3) });
    const result = planAiMoves({ ...ctxOf([climber, foe]), structures: tower, structureTemplates: templates });
    expect(stepsOf(result, 'c')).toHaveLength(0);
  });
});

describe('Basic AI structure takeover priority', () => {
  const tower = {
    '0,0': { templateId: 'tower' },
    '1,0': { templateId: 'tower' },
  } as unknown as AiPlanContext['structures'];
  const templates = {
    tower: { id: 'tower', name: 'Tower', anchor: 'hex', elevation: 10, mpClimbUp: 6, mpMountedUp: 6 },
  } as unknown as AiPlanContext['structureTemplates'];

  it('prefers a vacant top over marking the structure defender', () => {
    const defender = mk({ id: 'd', team: 'black', hex: hex(0, 0), elevation: 10, currentFormation: 'Close Order', organizationLevel: 2 });
    const climber = mk({
      id: 'c', team: 'blue', hex: hex(1, 1), facing: 0,
      currentFormation: 'Close Order', organizationLevel: 2, formationAvailability: ['Close Order'],
      movementPoints: 3, movementPointsAvailable: 0, actionsAvailable: 2,
    });
    const result = planAiMoves({ ...ctxOf([climber, defender]), structures: tower, structureTemplates: templates });
    const steps = stepsOf(result, 'c');
    expect(steps.some(s => s.kind === 'climb' && s.to.q === 1 && s.to.r === 0)).toBe(true);
    expect(result.marks.some(m => m.byUnitId === 'c')).toBe(false);
  });

  it('uses defender marks when no vacant top remains', () => {
    const defender = mk({ id: 'd', team: 'black', hex: hex(0, 0), elevation: 10, currentFormation: 'Close Order', organizationLevel: 2 });
    const blocker = mk({ id: 'b', team: 'black', hex: hex(1, 0), elevation: 10, currentFormation: 'Close Order', organizationLevel: 2 });
    const climber = mk({
      id: 'c', team: 'blue', hex: hex(1, 1), facing: 0,
      currentFormation: 'Close Order', organizationLevel: 2, formationAvailability: ['Close Order'],
      movementPoints: 3, movementPointsAvailable: 0, actionsAvailable: 2,
    });
    const result = planAiMoves({ ...ctxOf([climber, defender, blocker]), structures: tower, structureTemplates: templates });
    expect(result.marks.some(m => m.byUnitId === 'c')).toBe(true);
  });
});

describe('Basic AI routed-unit escape', () => {
  const routedFlyer = (over: Partial<Unit> = {}) => mk({
    id: 'rfly', team: 'blue', hex: hex(0, 0), elevation: 20,
    currentFormation: 'Routed', organizationLevel: 0,
    movementPoints: 1, movementPointsAvailable: 0,
    flySpeed: 6, flySpeedAvailable: 6, actionsAvailable: 2,
    ...over,
  });
  const foe = (over: Partial<Unit> = {}) => mk({ id: 'f1', team: 'black', hex: hex(0, -5), ...over });

  it('counts materialized fly points as an AI move resource', () => {
    const ctx = { alliances: ALLIANCES, teams: ['blue'], activeAlliance: 'enemy' as const };
    const base = mk({
      id: 'f', team: 'blue', hex: hex(0, 0),
      actionsAvailable: 0, movementPointsAvailable: 0, flySpeedAvailable: 5,
    });
    expect(isAiControllable(base, ctx, new Set())).toBe(true);
    expect(isAiControllable({ ...base, flySpeedAvailable: 0 }, ctx, new Set())).toBe(false);
  });

  it('lets a routed airborne flyer flee with only fly points', () => {
    const flyer = routedFlyer({ actionsAvailable: 0, movementPointsAvailable: 0 });
    const target = foe();
    const steps = stepsOf(planAiMoves(ctxOf([flyer, target])), 'rfly');
    const move = steps.find(step => step.kind === 'move');
    expect(move?.kind).toBe('move');
    if (move?.kind === 'move') {
      expect(hexDistance(move.to, target.hex)).toBeGreaterThan(hexDistance(flyer.hex, target.hex) + 1);
    }
    expect(steps.some(step => step.kind === 'attack' || step.kind === 'charge' || step.kind === 'swoop')).toBe(false);
  });

  it('uses the fly pool instead of a 1-point ground pool when fleeing', () => {
    const flyer = routedFlyer();
    const target = foe();
    const steps = stepsOf(planAiMoves(ctxOf([flyer, target])), 'rfly');
    const move = steps.find(step => step.kind === 'move');
    expect(move?.kind).toBe('move');
    if (move?.kind === 'move') {
      expect(hexDistance(move.to, target.hex)).toBeGreaterThan(hexDistance(flyer.hex, target.hex) + 1);
    }
  });

  it('lets a routed flying mount use the fly pool', () => {
    const flyer = routedFlyer({ mountId: 'pegasus', mountName: 'Pegasus' });
    const target = foe();
    const steps = stepsOf(planAiMoves(ctxOf([flyer, target])), 'rfly');
    const move = steps.find(step => step.kind === 'move');
    expect(move?.kind).toBe('move');
    if (move?.kind === 'move') {
      expect(hexDistance(move.to, target.hex)).toBeGreaterThan(hexDistance(flyer.hex, target.hex) + 1);
    }
  });

  it('keeps a routed ground mount on ground movement and lets it flee', () => {
    const rider = mk({
      id: 'rmount', team: 'blue', hex: hex(0, 0), elevation: 0,
      currentFormation: 'Routed', organizationLevel: 0,
      mountId: 'horse', mountName: 'Horse',
      movementPoints: 6, movementPointsAvailable: 0, actionsAvailable: 2,
    });
    const target = foe();
    const steps = stepsOf(planAiMoves(ctxOf([rider, target])), 'rmount');
    const move = steps.find(step => step.kind === 'move');
    expect(move?.kind).toBe('move');
    if (move?.kind === 'move') {
      expect(hexDistance(move.to, target.hex)).toBeGreaterThan(hexDistance(rider.hex, target.hex));
    }
    expect(steps.some(step => step.kind === 'attack' || step.kind === 'charge' || step.kind === 'swoop')).toBe(false);
  });

  it('lets a routed flyer ignore difficult ground terrain', () => {
    const flyer = routedFlyer();
    const target = foe();
    const terrainCosts = Object.fromEntries([
      hex(0, -1), hex(1, -1), hex(1, 0), hex(0, 1), hex(-1, 1), hex(-1, 0),
    ].map(h => [`${h.q},${h.r}`, 9]));
    const steps = stepsOf(planAiMoves({ ...ctxOf([flyer, target]), terrainCosts }), 'rfly');
    const move = steps.find(step => step.kind === 'move');
    expect(move?.kind).toBe('move');
    if (move?.kind === 'move') {
      expect(hexDistance(move.to, target.hex)).toBeGreaterThan(hexDistance(flyer.hex, target.hex) + 1);
    }
  });

  it('does not flee through ground that costs more than 2 MP per step', () => {
    const runner = mk({
      id: 'r', team: 'blue', hex: hex(0, 0), currentFormation: 'Routed', organizationLevel: 0,
      movementPoints: 4, movementPointsAvailable: 0, actionsAvailable: 2,
    });
    const terrainCosts = Object.fromEntries(HEX_DIRS.map(d => [`${d.q},${d.r}`, 3]));
    const result = planAiMoves({ ...ctxOf([runner, foe()]), terrainCosts });
    expect(stepsOf(result, 'r').some(s => s.kind === 'move')).toBe(false);
  });
});

describe('Basic AI edge-wall climb-over', () => {
  const wallTemplates = {
    wall: { id: 'wall', name: 'Wall', anchor: 'edge', elevation: 10, mpClimbUp: 4, mpClimbDown: 4 },
  } as unknown as AiPlanContext['structureTemplates'];
  const highWallTemplates = {
    wall: { id: 'wall', name: 'Wall', anchor: 'edge', elevation: 20, mpClimbUp: 4, mpClimbDown: 4 },
  } as unknown as AiPlanContext['structureTemplates'];

  function walledBox(inside: Hex[]): AiPlanContext['structures'] {
    const insideKeys = new Set(inside.map(h => `${h.q},${h.r}`));
    const structures: Record<string, { templateId: string; open?: boolean }> = {};
    for (const h of inside) {
      for (let dir = 0; dir < 6; dir++) {
        const d = HEX_DIRS[dir];
        const next = { q: h.q + d.q, r: h.r + d.r, s: -h.q - d.q - h.r - d.r };
        if (insideKeys.has(`${next.q},${next.r}`)) continue;
        structures[edgeRef(h.q, h.r, dir).key] = { templateId: 'wall' };
      }
    }
    return structures as unknown as AiPlanContext['structures'];
  }

  const inside = [hex(0, 0), ...HEX_DIRS.map(d => hex(d.q, d.r))];
  const target = () => mk({ id: 't', team: 'black', hex: hex(0, 0) });
  const climber = (over: Partial<Unit> = {}) => mk({
    id: 'm', team: 'blue', hex: hex(0, 2), currentFormation: 'Close Order',
    organizationLevel: 2, formationAvailability: ['Close Order'],
    movementPoints: 4, movementPointsAvailable: 0, actionsAvailable: 2,
    ...over,
  });

  it('plans a climb-over when an enemy is walled in and the unit is at the wall', () => {
    const result = planAiMoves({
      ...ctxOf([climber(), target()]),
      structures: walledBox(inside),
      structureTemplates: wallTemplates,
    });
    const steps = stepsOf(result, 'm');
    expect(steps.some(s => s.kind === 'climbOver' && s.to.q === 0 && s.to.r === 1)).toBe(true);
    expect(steps.some(s => s.kind === 'drop')).toBe(false);
  });

  it('moves to the wall base first when it is not adjacent', () => {
    const result = planAiMoves({
      ...ctxOf([climber({ hex: hex(0, 3) }), target()]),
      structures: walledBox(inside),
      structureTemplates: wallTemplates,
    });
    const steps = stepsOf(result, 'm');
    expect(steps.some(s => s.kind === 'move' && s.to.q === 0 && s.to.r === 2)).toBe(true);
    expect(steps.some(s => s.kind === 'climbOver')).toBe(false);
  });

  it('does not climb without enough action/MP for a climb step', () => {
    const result = planAiMoves({
      ...ctxOf([climber({ actionsAvailable: 1, movementPoints: 2 }), target()]),
      structures: walledBox(inside),
      structureTemplates: wallTemplates,
    });
    expect(stepsOf(result, 'm').some(s => s.kind === 'climbOver')).toBe(false);
  });

  it('never climbs with a mounted unit', () => {
    const result = planAiMoves({
      ...ctxOf([climber({ mountId: 'horse', mountName: 'Horse' }), target()]),
      structures: walledBox(inside),
      structureTemplates: wallTemplates,
    });
    expect(stepsOf(result, 'm').some(s => s.kind === 'climbOver')).toBe(false);
  });

  it('does not climb out of its own enclosure to chase an outside target', () => {
    const result = planAiMoves({
      ...ctxOf([climber({ hex: hex(0, 1) }), mk({ id: 't', team: 'black', hex: hex(0, 3) })]),
      structures: walledBox(inside),
      structureTemplates: wallTemplates,
    });
    expect(stepsOf(result, 'm').some(s => s.kind === 'climbOver')).toBe(false);
  });

  it('continues a hanging wall climb next activation', () => {
    const result = planAiMoves({
      ...ctxOf([climber({ elevation: 10, climbTo: '0,1' }), target()]),
      structures: walledBox(inside),
      structureTemplates: wallTemplates,
    });
    expect(stepsOf(result, 'm').some(s => s.kind === 'climbOver' && s.to.q === 0 && s.to.r === 1)).toBe(true);
  });

  it('continues a 20-ft climb from the top with enough capacity', () => {
    const result = planAiMoves({
      ...ctxOf([climber({ elevation: 20, climbTo: '0,1' }), target()]),
      structures: walledBox(inside),
      structureTemplates: highWallTemplates,
    });
    expect(stepsOf(result, 'm').some(s => s.kind === 'climbOver' && s.to.q === 0 && s.to.r === 1)).toBe(true);
  });

  it('uses an open gate instead of climbing', () => {
    const structures = walledBox(inside) as unknown as Record<string, { templateId: string; open?: boolean }>;
    structures[edgeRef(0, 1, 1).key] = { templateId: 'wall', open: true };
    const result = planAiMoves({
      ...ctxOf([climber(), target()]),
      structures: structures as unknown as AiPlanContext['structures'],
      structureTemplates: wallTemplates,
    });
    expect(stepsOf(result, 'm').some(s => s.kind === 'climbOver')).toBe(false);
  });

  it('ignores a wall on a hex-structure edge only for wall-crossing candidates', () => {
    const shared = edgeRef(0, 0, 0).key; // between (0,0) and (1,0)
    const openEdge = edgeRef(2, 0, 0).key;
    const structures = {
      '0,0': { templateId: 'tower' },
      [shared]: { templateId: 'wall' },
      [openEdge]: { templateId: 'wall' },
    } as unknown as AiPlanContext['structures'];
    const walls = edgeWalls({
      structures,
      structureTemplates: {
        ...wallTemplates,
        tower: { id: 'tower', name: 'Tower', anchor: 'hex', elevation: 20 },
      } as unknown as AiPlanContext['structureTemplates'],
    });
    expect(walls.map(w => `${w.a.q},${w.a.r}`)).toEqual(['2,0']);
  });

  it('crosses a non-redundant wall to reach a vacant top inside', () => {    const insideBig: Hex[] = [];
    for (let q = -2; q <= 2; q++) {
      for (let r = -2; r <= 2; r++) {
        if (Math.max(Math.abs(q), Math.abs(r), Math.abs(q + r)) <= 2) insideBig.push(hex(q, r));
      }
    }
    const structures = walledBox(insideBig) as unknown as Record<string, { templateId: string }>;
    structures['0,0'] = { templateId: 'tower20' };
    structures['1,0'] = { templateId: 'tower10' };
    const walls = structuresToWalls(structures as unknown as NonNullable<AiPlanContext['structures']>, highWallTemplates as StructureTemplates);
    for (const wall of Object.values(walls)) {
      wall.a.block = true;
      wall.b.block = true;
    }
    const defender = mk({ id: 't', team: 'black', hex: hex(1, 0), elevation: 10 });
    const result = planAiMoves({
      ...ctxOf([climber({ hex: hex(0, 3) }), defender]),
      structures: structures as unknown as AiPlanContext['structures'],
      structureTemplates: {
        ...highWallTemplates,
        tower20: { id: 'tower20', name: 'Tower', anchor: 'hex', elevation: 20, mpClimbUp: 4, mpMountedUp: 4 },
        tower10: { id: 'tower10', name: 'Tower', anchor: 'hex', elevation: 10, mpClimbUp: 4, mpMountedUp: 4 },
      } as unknown as AiPlanContext['structureTemplates'],
      walls,
    });
    expect(result.objectives).toMatchObject([{ unitId: 'm', hex: hex(0, 0) }]);
    const steps = stepsOf(result, 'm');
    expect(steps.some(s => s.kind === 'climbOver' && s.to.q === 0 && s.to.r === 2)).toBe(true);
  });
});
