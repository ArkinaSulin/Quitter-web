import { describe, it, expect } from 'vitest';
import {
  planAiMoves,
  isAiControllable,
  enemyGroupsOf,
  legalTargets,
  allianceOf,
  assignMarks,
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
