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
  AiPlanContext,
} from '@/packages/ai';
import { Unit, Hex, AllianceGroup, Formation } from '@/types/gameProtocol';
import { edgeRef } from '@/packages/movement';

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
    const attacks = stepsOf(result, 'm1').filter(s => s.kind === 'attack');
    expect(attacks.length).toBe(2);
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

  it('plans a mounted staging move when no charge is available', () => {
    const mount = mk({ id: 'c1', team: 'blue', hex: hex(0, 0), mountId: 'horse', mountName: 'Horse', canCharge: true, movementPoints: 6 });
    const foe = mk({ id: 'f1', team: 'black', hex: hex(0, -6) });
    const result = planAiMoves(ctxOf([mount, foe]));
    const steps = stepsOf(result, 'c1');
    expect(steps.some(s => s.kind === 'move')).toBe(true);
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
    const moves = stepsOf(result, 'fly1').filter(s => s.kind === 'move');
    expect(moves.some(m => !['0,0', '0,-1'].includes(`${m.to.q},${m.to.r}`))).toBe(true);
  });
});

describe('Basic AI mounted charge hardening', () => {
  const chargeUnits = (over: Partial<Unit> = {}) => {
    const mount = mk({ id: 'c1', team: 'blue', hex: hex(0, 0), facing: 0, mountId: 'horse', mountName: 'Horse', canCharge: true, movementPoints: 6, actionsAvailable: 2, ...over });
    const target = mk({ id: 'f1', team: 'black', hex: hex(0, -3), facing: 0 });
    const friend = mk({ id: 'f2', team: 'blue', hex: hex(1, -3) });
    return [mount, target, friend];
  };

  it('charges an engaged target from the rear on its first action', () => {
    const result = planAiMoves(ctxOf(chargeUnits()));
    const steps = stepsOf(result, 'c1');
    expect(steps.some(s => s.kind === 'charge')).toBe(true);
    expect(steps.some(s => s.kind === 'swoop')).toBe(false);
    expect(steps.some(s => s.kind === 'attack' && s.charge)).toBe(true);
    expect(steps.some(s => s.kind === 'chargeEnd')).toBe(true);
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

  it('does not swoop without fly points', () => {
    const result = planAiMoves(ctxOf(flyerUnits({ flySpeedAvailable: 0 })));
    const steps = stepsOf(result, 'fly1');
    expect(steps.some(s => s.kind === 'charge')).toBe(false);
    expect(steps.some(s => s.kind === 'swoop')).toBe(false);
  });

  it('does not swoop when the Charge and Swoop toggle is off', () => {
    const result = planAiMoves({ ...ctxOf(flyerUnits()), chargeEnabled: false });
    const steps = stepsOf(result, 'fly1');
    expect(steps.some(s => s.kind === 'charge')).toBe(false);
    expect(steps.some(s => s.kind === 'swoop')).toBe(false);
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

describe('Basic AI hard climbing lock', () => {
  const towerStructures = {
    '0,0': { templateId: 'tower' },
    '1,0': { templateId: 'tower' },
  } as unknown as AiPlanContext['structures'];
  const towerTemplates = {
    tower: { id: 'tower', name: 'Tower', anchor: 'hex', elevation: 10, mpClimbUp: 6, mpMountedUp: 6 },
  } as unknown as AiPlanContext['structureTemplates'];
  const farFoe = () => mk({ id: 'f1', team: 'black', hex: hex(0, 6) });

  it('climbs to the chosen free top and does nothing else', () => {
    const climber = mk({ id: 'c', team: 'blue', hex: hex(0, 1), elevation: 5, climbTo: '0,0', actionsAvailable: 2, movementPoints: 3 });
    const result = planAiMoves({ ...ctxOf([climber, farFoe()]), structures: towerStructures, structureTemplates: towerTemplates });
    const steps = stepsOf(result, 'c');
    expect(steps).toHaveLength(1);
    expect(steps[0].kind).toBe('climb');
  });

  it('climb-attacks an obstacle at the chosen exit instead of choosing another target', () => {
    const climber = mk({ id: 'c', team: 'blue', hex: hex(0, 1), elevation: 5, climbTo: '0,0', actionsAvailable: 2, movementPoints: 3 });
    const blocker = mk({ id: 't', team: 'black', hex: hex(0, 0), elevation: 10 });
    const result = planAiMoves({ ...ctxOf([climber, blocker, farFoe()]), structures: towerStructures, structureTemplates: towerTemplates });
    const steps = stepsOf(result, 'c');
    expect(steps).toHaveLength(1);
    const first = steps[0];
    expect(first.kind).toBe('climbAttack');
    if (first.kind === 'climbAttack') expect(first.targetId).toBe('t');
  });

  it('drops a routed hanging unit down instead of climbing up', () => {
    const climber = mk({ id: 'c', team: 'blue', hex: hex(0, 1), elevation: 5, climbTo: '0,0', currentFormation: 'Routed', organizationLevel: 0, actionsAvailable: 2, movementPoints: 3 });
    const result = planAiMoves({ ...ctxOf([climber, farFoe()]), structures: towerStructures, structureTemplates: towerTemplates });
    const steps = stepsOf(result, 'c');
    expect(steps).toHaveLength(1);
    expect(steps[0].kind).toBe('drop');
  });

  it('lands on a free top once already at top elevation', () => {
    const climber = mk({ id: 'c', team: 'blue', hex: hex(0, 1), elevation: 10, actionsAvailable: 2, movementPoints: 3 });
    const result = planAiMoves({ ...ctxOf([climber, farFoe()]), structures: towerStructures, structureTemplates: towerTemplates });
    const steps = stepsOf(result, 'c');
    expect(steps).toHaveLength(1);
    expect(steps[0].kind).toBe('land');
  });

  it('switches to the nearest free top when the chosen exit is friendly-occupied', () => {
    const climber = mk({ id: 'c', team: 'blue', hex: hex(0, 1), elevation: 5, climbTo: '0,0', actionsAvailable: 2, movementPoints: 3 });
    const friendly = mk({ id: 'f', team: 'blue', hex: hex(0, 0), elevation: 10 });
    const result = planAiMoves({ ...ctxOf([climber, friendly, farFoe()]), structures: towerStructures, structureTemplates: towerTemplates });
    const steps = stepsOf(result, 'c');
    expect(steps).toHaveLength(1);
    const first = steps[0];
    expect(first.kind).toBe('climb');
    if (first.kind === 'climb') {
      expect(first.to.q).toBe(1);
      expect(first.to.r).toBe(0);
    }
  });

  it('shoots from a structure top instead of moving off it', () => {
    const archer = mk({ id: 'a', team: 'blue', hex: hex(0, 0), elevation: 10, weaponString: SHORTBOW, actionsAvailable: 2, movementPoints: 3 });
    const foe = mk({ id: 't', team: 'black', hex: hex(0, -3) });
    const result = planAiMoves({ ...ctxOf([archer, foe]), structures: towerStructures, structureTemplates: towerTemplates });
    const steps = stepsOf(result, 'a');
    expect(steps.some(s => s.kind === 'attack')).toBe(true);
    expect(steps.some(s => s.kind === 'move')).toBe(false);
  });
});
