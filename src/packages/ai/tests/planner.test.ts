import { describe, it, expect, vi } from 'vitest';
import {
  planAiMoves,
  isAiControllable,
  enemyGroupsOf,
  legalTargets,
  allianceOf,
  hexKeyOf,
  expectedRetaliation,
  ownExposureAt,
  pathBypassPenalty,
  lineBearingPenalty,
  assignTargets,
  assignBattleRoles,
  computeBattleLine,
  isFlankOrRearThreat,
  findLineGaps,
  assignReservePlacements,
  reserveThreatKind,
  AiPlanContext,
} from '@/packages/ai';
import { Unit, Hex, AllianceGroup, Formation } from '@/types/gameProtocol';
import { StructureTemplate } from '@/types/structure';
import { arcOfTarget } from '@/packages/primitives';

const SPEAR = 'Spear,3,1d8,false,1,1,0,true,false,false,false,1,true,Dex,circle';
const SHORTBOW = 'Shortbow,2,1d6,false,2,3,0,false,true,true,false,1,true,Dex,circle';
const DAGGER = 'Dagger,0,1d4,false,1,1,0,false,false,false,false,1,true,Dex,circle';
const GREATSWORD = 'Greatsword,5,2d6,false,1,1,0,false,false,false,true,1,true,Dex,circle';

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
  formationAvailability: [],
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

const ALLIANCES: Record<string, AllianceGroup> = {
  blue: 'enemy',
  black: 'friendly',
};
const NO_FORMS: Record<string, Formation> = {};

const BASE_FORM: Formation = {
  id: 'form-open',
  name: 'Open Order',
  melee_ac_modifier: 0,
  range_ac_modifier: 0,
  movement_multiplier: 1,
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
  can_charge: false,
  stop_enemy_movement_arcs: ['front'],
  charge_through_arcs: [],
  be_attacked_melee_modifier: 1,
  be_attacked_range_modifier: 1,
  organization_level: 1,
};

function ctxOf(units: Unit[], teams: string[], activeAlliance: AllianceGroup | null, over: Partial<AiPlanContext> = {}): AiPlanContext {
  return { units, alliances: ALLIANCES, formations: NO_FORMS, teams, activeAlliance, ...over };
}

function ctxWithForms(
  units: Unit[],
  teams: string[],
  activeAlliance: AllianceGroup | null,
  formations: Record<string, Formation>,
  over: Partial<AiPlanContext> = {},
): AiPlanContext {
  return { units, alliances: ALLIANCES, formations, teams, activeAlliance, ...over };
}

describe('enemyAI gates', () => {
  it('enemyGroupsOf only maps friendly<->enemy', () => {
    expect(Array.from(enemyGroupsOf('friendly'))).toEqual(['enemy']);
    expect(Array.from(enemyGroupsOf('enemy'))).toEqual(['friendly']);
    expect(enemyGroupsOf('neutral').size).toBe(0);
  });

  it('isAiControllable gates deleted/killed/hidden/attached/hosted/wrong-turn/free-play/out-of-team/no-actions', () => {
    const ai = mk({ id: 'u1', team: 'blue', hex: hex(0, 0), actionsAvailable: 1 });
    const hosted = new Set<string>();
    const good = isAiControllable(ai, { alliances: ALLIANCES, teams: ['blue'], activeAlliance: 'enemy' }, hosted);
    expect(good).toBe(true);

    const cases: Array<[string, Partial<Unit>]> = [
      ['deleted', { isDeleted: true }],
      ['killed', { currentUnitHp: 0 }],
      ['hidden', { hidden: true }],
      ['attached', { attachedToUnitId: 'host' }],
      ['hero', { isHero: true }],
      ['no actions', { actionsAvailable: 0 }],
    ];
    for (const [label, patch] of cases) {
      expect(isAiControllable(mk({ ...ai, ...patch }), { alliances: ALLIANCES, teams: ['blue'], activeAlliance: 'enemy' }, hosted), label).toBe(false);
    }
    // hosted by an attached hero (people play hosts too)
    expect(isAiControllable(ai, { alliances: ALLIANCES, teams: ['blue'], activeAlliance: 'enemy' }, new Set(['u1']))).toBe(false);
    // wrong alliance for the active turn
    expect(isAiControllable(ai, { alliances: ALLIANCES, teams: ['blue'], activeAlliance: 'friendly' }, hosted)).toBe(false);
    // team not handed to AI
    expect(isAiControllable(ai, { alliances: ALLIANCES, teams: ['black'], activeAlliance: 'enemy' }, hosted)).toBe(false);
    // free play
    expect(isAiControllable(ai, { alliances: ALLIANCES, teams: ['blue'], activeAlliance: null }, hosted)).toBe(false);
  });
});

describe('enemyAI legalTargets', () => {
  it('finds adjacency melee enemies, never friendlies/hidden/dead; respects range', () => {
    const attacker = mk({ id: 'u1', team: 'blue', hex: hex(0, 0), facing: 0, actionsAvailable: 2 });
    const meleeFoe = mk({ id: 'f1', team: 'black', hex: hex(0, -1), facing: 2 });
    const friend = mk({ id: 'f2', team: 'blue', hex: hex(-1, 0), facing: 0 });
    const farFoe = mk({ id: 'f3', team: 'black', hex: hex(0, 3), facing: 2 });
    const hiddenFoe = mk({ id: 'f4', team: 'black', hex: hex(1, -1), facing: 2, hidden: true });
    const units = [attacker, meleeFoe, friend, farFoe, hiddenFoe];
    const targets = legalTargets(attacker, units, { alliances: ALLIANCES, formations: NO_FORMS, visibleHexes: null });
    expect(targets.map(t => t.unit.id).sort()).toEqual(['f1']);
    expect(targets[0].isRanged).toBe(false);
  });

  it('ranged units can shoot to maxRange only', () => {
    const archer = mk({ id: 'a1', team: 'blue', hex: hex(0, 0), weaponString: SHORTBOW, actionsAvailable: 2 });
    const inRange = mk({ id: 't1', team: 'black', hex: hex(0, -2), facing: 2 });
    const outRange = mk({ id: 't2', team: 'black', hex: hex(0, 4), facing: 2 });
    const targets = legalTargets(archer, [archer, inRange, outRange], { alliances: ALLIANCES, formations: NO_FORMS, visibleHexes: null });
    expect(targets.map(t => t.unit.id)).toEqual(['t1']);
    expect(targets[0].isRanged).toBe(true);
  });

  it('fog hides unseen targets', () => {
    const attacker = mk({ id: 'u1', team: 'blue', hex: hex(0, 0), facing: 0 });
    const foe = mk({ id: 'f1', team: 'black', hex: hex(0, -1), facing: 2 });
    const visible = new Set<string>([hexKeyOf(attacker.hex)]);
    const targets = legalTargets(attacker, [attacker, foe], { alliances: ALLIANCES, formations: NO_FORMS, visibleHexes: visible });
    expect(targets).toHaveLength(0);
  });
});

describe('enemyAI planAiMoves', () => {
  it('plots an attack for an adjacent enemy and respects teams/alliance/budget', () => {
    const ai = mk({ id: 'u1', team: 'blue', hex: hex(0, 0), facing: 0, actionsAvailable: 2, attacksUsed: 0 });
    const foe = mk({ id: 'foe1', team: 'black', hex: hex(0, -1), facing: 2, currentAc: 13 });
    const plans = planAiMoves(ctxOf([ai, foe], ['blue'], 'enemy'));
    expect(plans.length).toBe(1);
    expect(plans[0].unitId).toBe('u1');
    const kinds = plans[0].steps.map(s => s.kind);
    expect(kinds[0]).toBe('attack');
    const attack = plans[0].steps[0];
    if (attack.kind === 'attack') expect(attack.targetId).toBe('foe1');
  });

  it('no plot for friendly-turn / free-play / empty teams', () => {
    const ai = mk({ id: 'u1', team: 'blue', hex: hex(0, 0), facing: 0 });
    const foe = mk({ id: 'foe1', team: 'black', hex: hex(0, -1), facing: 2 });
    expect(planAiMoves(ctxOf([ai, foe], ['blue'], 'friendly'))).toHaveLength(0);
    expect(planAiMoves(ctxOf([ai, foe], ['blue'], null))).toHaveLength(0);
    expect(planAiMoves(ctxOf([ai, foe], [], 'enemy'))).toHaveLength(0);
  });

  it('excluded units (deleted/killed/hidden) never appear in plans', () => {
    const ai = mk({ id: 'u1', team: 'blue', hex: hex(0, 0), facing: 0, actionsAvailable: 2 });
    const foe = mk({ id: 'foe1', team: 'black', hex: hex(0, -1), facing: 2 });
    const dead = mk({ id: 'u2', team: 'blue', hex: hex(0, 1), facing: 0, actionsAvailable: 2, isDeleted: true });
    const down = mk({ id: 'u3', team: 'blue', hex: hex(1, 0), facing: 0, actionsAvailable: 2, currentUnitHp: 0 });
    const hidden = mk({ id: 'u4', team: 'blue', hex: hex(1, -1), facing: 0, actionsAvailable: 2, hidden: true });
    const plans = planAiMoves(ctxOf([ai, foe, dead, down, hidden], ['blue'], 'enemy'));
    const plannedIds = plans.map(p => p.unitId);
    expect(plannedIds).toEqual(['u1']);
  });

  it('excluded units are never plotted while teammates still are', () => {
    const aiA = mk({ id: 'u1', team: 'blue', hex: hex(0, 0), facing: 0, actionsAvailable: 2 });
    const aiB = mk({ id: 'u2', team: 'blue', hex: hex(1, 0), facing: 0, actionsAvailable: 2 });
    const foe = mk({ id: 'foe1', team: 'black', hex: hex(0, -1), facing: 2 });
    const all = planAiMoves(ctxOf([aiA, aiB, foe], ['blue'], 'enemy', { excludeUnitIds: ['u2'] }));
    const ids = all.map(p => p.unitId);
    expect(ids).toContain('u1');
    expect(ids).not.toContain('u2');
  });

  it('routed AI units flee as far from hostiles as possible (never attack)', () => {
    const routed = mk({ id: 'r1', team: 'blue', hex: hex(0, 0), facing: 0, actionsAvailable: 1, movementPoints: 3, currentFormation: 'Routed' });
    const foe = mk({ id: 'foe1', team: 'black', hex: hex(0, 2), facing: 2 });
    const startDist = Math.max(Math.abs(0), Math.abs(2), Math.abs(-2));
    const plans = planAiMoves(ctxOf([routed, foe], ['blue'], 'enemy'));
    expect(plans.length).toBe(1);
    const steps = plans[0].steps;
    expect(steps.length).toBeGreaterThan(0);
    expect(steps.every(s => s.kind === 'move')).toBe(true);
    const last = steps[steps.length - 1];
    if (last.kind === 'move') {
      const endDist = Math.max(Math.abs(last.to.q), Math.abs(last.to.r), Math.abs(-last.to.q - last.to.r));
      expect(endDist).toBeGreaterThan(startDist);
    }
  });

  it('routed units stop at the map rim and never run beyond it', () => {
    const routed = mk({ id: 'r1', team: 'blue', hex: hex(0, 0), facing: 0, actionsAvailable: 2, movementPoints: 8, currentFormation: 'Routed' });
    const foe = mk({ id: 'foe1', team: 'black', hex: hex(0, 8), facing: 2 });
    const plans = planAiMoves(ctxOf([routed, foe], ['blue'], 'enemy', { gridRadius: 3 }));
    expect(plans.length).toBe(1);
    const steps = plans[0].steps;
    expect(steps.every(s => s.kind === 'move')).toBe(true);
    const last = steps[steps.length - 1];
    if (last.kind === 'move') {
      const ring = Math.max(Math.abs(last.to.q), Math.abs(last.to.r), Math.abs(last.to.q + last.to.r));
      expect(ring).toBe(3); // rim, not beyond
    }
  });

  it('routed units already at/outside the rim stay put', () => {
    const atRim = mk({ id: 'r1', team: 'blue', hex: hex(0, 3), facing: 0, actionsAvailable: 2, movementPoints: 8, currentFormation: 'Routed' });
    const foe = mk({ id: 'foe1', team: 'black', hex: hex(0, 8), facing: 2 });
    expect(planAiMoves(ctxOf([atRim, foe], ['blue'], 'enemy', { gridRadius: 3 }))).toHaveLength(0);
    const outside = mk({ id: 'r2', team: 'blue', hex: hex(0, 4), facing: 0, actionsAvailable: 2, movementPoints: 8, currentFormation: 'Routed' });
    expect(planAiMoves(ctxOf([outside, foe], ['blue'], 'enemy', { gridRadius: 3 }))).toHaveLength(0);
  });

  it('moves never leave the unit\'s own team or target allies, and respect the action cap', () => {
    const ai = mk({ id: 'u1', team: 'blue', hex: hex(0, 0), facing: 0, actionsAvailable: 1, movementPoints: 2 });
    const foe = mk({ id: 'foe1', team: 'black', hex: hex(0, -4), facing: 2 });
    const plans = planAiMoves(ctxOf([ai, foe], ['blue'], 'enemy'));
    expect(plans.length).toBe(1);
    const move = plans[0].steps.find(s => s.kind === 'move');
    expect(move).toBeDefined();
    const attack = plans[0].steps.find(s => s.kind === 'attack');
    expect(attack).toBeUndefined(); // out of range -> no attack, and actions spent on the move
  });

  it('is deterministic for identical inputs', () => {
    const ai = mk({ id: 'u1', team: 'blue', hex: hex(0, 0), facing: 0, actionsAvailable: 2 });
    const foe = mk({ id: 'foe1', team: 'black', hex: hex(0, -1), facing: 2 });
    const a = planAiMoves(ctxOf([ai, foe], ['blue'], 'enemy'));
    const b = planAiMoves(ctxOf([ai, foe], ['blue'], 'enemy'));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
  it('never plots heroes or hosts with an attached hero', () => {
    const foe = mk({ id: 'foe', team: 'black', hex: hex(0, 1), facing: 2 });
    const hero = mk({ id: 'hero1', team: 'blue', hex: hex(0, 0), isHero: true, currentFormation: 'Hero', actionsAvailable: 5 });
    expect(planAiMoves(ctxOf([hero, foe], ['blue'], 'enemy'))).toHaveLength(0); // lone hero excluded

    const host = mk({ id: 'host1', team: 'blue', hex: hex(0, 0), facing: 0, actionsAvailable: 2, weaponString: SPEAR });
    const her = mk({ id: 'her1', team: 'blue', hex: hex(0, 0), isHero: true, currentFormation: 'Hero', attachedToUnitId: 'host1', attachedPosition: 'front', actionsAvailable: 5 });
    expect(planAiMoves(ctxOf([host, her, foe], ['blue'], 'enemy'))).toHaveLength(0); // hero-host excluded
  });
});

describe('enemyAI smarter tactics', () => {
  const LONGBOW = 'Longbow,3,1d8,false,3,6,0,false,true,false,false,1,true,Dex,circle';
  const SHORTBOW2 = 'Shortbow,2,1d6,false,2,3,0,false,true,false,false,1,true,Dex,circle';

  function dist(a: Hex, b: Hex): number {
    return Math.max(Math.abs(a.q - b.q), Math.abs(a.r - b.r), Math.abs(a.s - b.s));
  }

  it('expectedRetaliation reads the defender melee weapon at adjacency and ignores routed units', () => {
    const attacker = mk({ id: 'a1', team: 'blue', hex: hex(0, 0), weaponString: DAGGER });
    const defender = mk({ id: 'd1', team: 'black', hex: hex(0, -1), facing: 3, weaponString: SPEAR });
    const units = [attacker, defender];
    expect(expectedRetaliation(defender, attacker, 1, { alliances: ALLIANCES, formations: NO_FORMS, units })).toBeGreaterThan(0);
    expect(expectedRetaliation({ ...defender, currentFormation: 'Routed' }, attacker, 1, { alliances: ALLIANCES, formations: NO_FORMS, units })).toBe(0);
    expect(expectedRetaliation(defender, attacker, 3, { alliances: ALLIANCES, formations: NO_FORMS, units })).toBe(0);
  });

  it('Advanced avoids a losing melee trade that Basic takes', () => {
    const ai = mk({
      id: 'a1', team: 'blue', hex: hex(0, 0), facing: 0, weaponString: DAGGER,
      currentTroopCount: 1, maxTroopCount: 1, currentUnitHp: 10, maxUnitHp: 10, actionsAvailable: 2,
    });
    const foe = mk({
      id: 'd1', team: 'black', hex: hex(0, -1), facing: 3, weaponString: GREATSWORD,
      currentTroopCount: 10, maxTroopCount: 10, troopHp: 10, currentUnitHp: 100, maxUnitHp: 100,
    });
    // Rear retaliation is enabled too, so fleeing to the back arc is not a free
    // way to dodge the losing trade.
    const forms: Record<string, Formation> = {
      'Open Order': { ...BASE_FORM, retaliate_arcs: { front: 'full', flank: 'full', rear: 'full' } },
    };
    const basic = planAiMoves(ctxWithForms([ai, foe], ['blue'], 'enemy', forms));
    expect(basic[0]?.steps.some(s => s.kind === 'attack')).toBe(true);

    const advanced = planAiMoves(ctxWithForms([ai, foe], ['blue'], 'enemy', forms, { advanced: true }));
    expect(advanced[0]?.steps.some(s => s.kind === 'attack') ?? false).toBe(false);
  });

  it('Advanced reserves damage so a second unit does not overkill the same target', () => {
    const a1 = mk({ id: 'a1', team: 'blue', hex: hex(0, 0), facing: 0, weaponString: SPEAR, actionsAvailable: 2 });
    const a2 = mk({ id: 'a2', team: 'blue', hex: hex(0, 1), facing: 0, weaponString: SPEAR, actionsAvailable: 2 });
    const foe = mk({
      id: 'd1', team: 'black', hex: hex(1, 0), facing: 0,
      currentTroopCount: 1, maxTroopCount: 1, troopHp: 10, currentUnitHp: 1, maxUnitHp: 10,
    });
    const advanced = planAiMoves(ctxOf([a1, a2, foe], ['blue'], 'enemy', { advanced: true }));
    const advancedAttacks = advanced.flatMap(p => p.steps).filter(s => s.kind === 'attack');
    expect(advancedAttacks.length).toBe(1);

    const basic = planAiMoves(ctxOf([a1, a2, foe], ['blue'], 'enemy'));
    const basicAttacks = basic.flatMap(p => p.steps).filter(s => s.kind === 'attack');
    expect(basicAttacks.length).toBeGreaterThan(1);
  });

  it('formation retaliation respects retaliate_arcs (none / rows / full)', () => {
    const defender = mk({ id: 'd1', team: 'black', hex: hex(0, 0), facing: 0, weaponString: SPEAR });
    const frontAttacker = mk({ id: 'a1', team: 'blue', hex: hex(0, -1), weaponString: SPEAR });
    const flankAttacker = mk({ id: 'a2', team: 'blue', hex: hex(1, 0), weaponString: SPEAR });
    const forms: Record<string, Formation> = {
      'Open Order': { ...BASE_FORM, retaliate_arcs: { front: 'full', flank: 'rows', rear: 'none' } },
    };
    const ctx = { formations: forms, units: [defender, frontAttacker, flankAttacker], alliances: ALLIANCES };
    const front = expectedRetaliation(defender, frontAttacker, 1, ctx);
    const flank = expectedRetaliation(defender, flankAttacker, 1, ctx);
    expect(front).toBeGreaterThan(0);
    expect(flank).toBeGreaterThan(0);
    expect(flank).toBeLessThan(front); // rows-based count

    const none: Record<string, Formation> = {
      'Open Order': { ...BASE_FORM, retaliate_arcs: { front: 'none', flank: 'none', rear: 'none' } },
    };
    expect(expectedRetaliation(defender, frontAttacker, 1, { ...ctx, formations: none })).toBe(0);

    const noRangedRetaliation: Record<string, Formation> = {
      'Open Order': { ...BASE_FORM, retaliate_vs_ranged: false },
    };
    expect(expectedRetaliation(defender, frontAttacker, 2, { ...ctx, formations: noRangedRetaliation })).toBe(0);
  });

  it('ownExposureAt penalizes flank/rear threats but not routed or out-of-reach units', () => {
    const dest = hex(0, 0);
    const facing = 0;
    const rear = mk({ id: 'rear', team: 'black', hex: hex(0, 1), weaponString: SPEAR });
    const flank = mk({ id: 'flank', team: 'black', hex: hex(1, 0), weaponString: SPEAR });
    const front = mk({ id: 'front', team: 'black', hex: hex(0, -1), weaponString: SPEAR });
    const rearPenalty = ownExposureAt(dest, facing, [rear]);
    const flankPenalty = ownExposureAt(dest, facing, [flank]);
    expect(rearPenalty).toBeGreaterThan(flankPenalty);
    expect(flankPenalty).toBeGreaterThan(0);
    expect(ownExposureAt(dest, facing, [front])).toBe(0);
    expect(ownExposureAt(dest, facing, [{ ...rear, currentFormation: 'Routed' }])).toBe(0);

    const farMelee = mk({ id: 'far', team: 'black', hex: hex(0, 2), weaponString: SPEAR });
    expect(ownExposureAt(dest, facing, [farMelee])).toBe(0);
    const farRanged = mk({ id: 'far-r', team: 'black', hex: hex(0, 2), weaponString: SHORTBOW });
    expect(ownExposureAt(dest, facing, [farRanged])).toBeGreaterThan(0);
  });

  it('pathBypassPenalty charges walking past a non-target enemy', () => {
    const dest = hex(0, -4);
    const path = [hex(0, 0), hex(0, -1), hex(0, -2), hex(0, -3), dest];
    const bypassed = mk({ id: 'bypassed', team: 'black', hex: hex(1, -1), weaponString: SPEAR });
    const atDest = mk({ id: 'at-dest', team: 'black', hex: hex(-1, -4), weaponString: SPEAR });
    expect(pathBypassPenalty(path, [bypassed], dest)).toBeGreaterThan(0);
    expect(pathBypassPenalty(path, [atDest], dest)).toBe(0);
    expect(pathBypassPenalty(path, [{ ...bypassed, currentFormation: 'Routed' }], dest)).toBe(0);
    expect(pathBypassPenalty([hex(0, 0), hex(0, -1)], [bypassed], hex(0, -1))).toBe(0);
  });

  it('Advanced changes formation for a better melee trade; Basic does not', () => {
    const forms: Record<string, Formation> = {
      'Open Order': { ...BASE_FORM, attack_capacity_multiplier: 1 },
      'Close Order': { ...BASE_FORM, id: 'form-close', name: 'Close Order', organization_level: 2, attack_capacity_multiplier: 2 },
    };
    const ai = mk({
      id: 'a1', team: 'blue', hex: hex(0, 0), facing: 0, weaponString: SPEAR,
      currentTroopCount: 20, maxTroopCount: 20, troopHp: 10, currentUnitHp: 200, maxUnitHp: 200,
      actionsAvailable: 2, movementPoints: 3, movementPointsAvailable: 0,
      currentFormation: 'Open Order', formationAvailability: ['Open Order', 'Close Order'],
    });
    const foe = mk({
      id: 'd1', team: 'black', hex: hex(0, -1), facing: 3, weaponString: SPEAR,
      currentTroopCount: 10, maxTroopCount: 10, troopHp: 10, currentUnitHp: 100, maxUnitHp: 100,
    });
    const advanced = planAiMoves(ctxWithForms([ai, foe], ['blue'], 'enemy', forms, { advanced: true }));
    const formation = advanced[0]?.steps.find(s => s.kind === 'formation');
    expect(formation && formation.kind === 'formation' ? formation.formation : null).toBe('Close Order');

    const basic = planAiMoves(ctxWithForms([ai, foe], ['blue'], 'enemy', forms));
    expect(basic[0]?.steps.some(s => s.kind === 'formation') ?? false).toBe(false);
  });

  it('ranged picks the biggest threat: within-2 beats Phalanx beats Close Order', () => {
    const archer = mk({ id: 'a1', team: 'blue', hex: hex(0, 0), facing: 0, weaponString: LONGBOW, actionsAvailable: 2 });
    const nearOpen = mk({ id: 'open', team: 'black', hex: hex(0, 2), facing: 2, currentFormation: 'Open Order' });
    const phalanx = mk({ id: 'pik', team: 'black', hex: hex(0, 4), facing: 2, currentFormation: 'Phalanx' });
    // (0,2) is within 2 hexes -> tier 3 beats the Phalanx (tier 2).
    const plan = planAiMoves(ctxOf([archer, nearOpen, phalanx], ['blue'], 'enemy'));
    const attack = plan[0].steps.find(s => s.kind === 'attack');
    expect(attack).toBeDefined();
    if (attack && attack.kind === 'attack') expect(attack.targetId).toBe('open');

    // No within-2 target: Phalanx (tier 2) beats the open order unit (tier 0).
    const openFar = mk({ id: 'open2', team: 'black', hex: hex(0, 3), facing: 2, currentFormation: 'Open Order' });
    const phalanxFar = mk({ id: 'pik2', team: 'black', hex: hex(0, 4), facing: 2, currentFormation: 'Phalanx' });
    const plan2 = planAiMoves(ctxOf([archer, openFar, phalanxFar], ['blue'], 'enemy'));
    const attack2 = plan2[0].steps.find(s => s.kind === 'attack');
    if (attack2 && attack2.kind === 'attack') expect(attack2.targetId).toBe('pik2');
  });

  it('melee attacks prefer the target attacked from its rear', () => {
    const attacker = mk({ id: 'a1', team: 'blue', hex: hex(0, 0), facing: 0, actionsAvailable: 2, weaponString: SPEAR });
    const frontEnemy = mk({ id: 'front', team: 'black', hex: hex(0, -1), facing: 2 }); // attacker in its FRONT
    const rearEnemy = mk({ id: 'rear', team: 'black', hex: hex(1, -1), facing: 1 }); // attacker in its REAR
    const plan = planAiMoves(ctxOf([attacker, frontEnemy, rearEnemy], ['blue'], 'enemy'));
    const attack = plan[0].steps.find(s => s.kind === 'attack');
    if (attack && attack.kind === 'attack') expect(attack.targetId).toBe('rear');
  });

  it('ranged-only units adopt Scattered near contact and back off to a gap', () => {
    const archer = mk({
      id: 'a1', team: 'blue', hex: hex(0, 0), facing: 0, weaponString: SHORTBOW2,
      movementPoints: 4, actionsAvailable: 2, formationAvailability: ['Open Order', 'Scattered'],
    });
    const meleeFoe = mk({ id: 'foe1', team: 'black', hex: hex(0, -1), facing: 2 }); // adjacent
    const plan = planAiMoves(ctxOf([archer, meleeFoe], ['blue'], 'enemy'));
    const kinds = plan[0].steps.map(s => s.kind);
    expect(kinds).toContain('formation');
    const formation = plan[0].steps.find(s => s.kind === 'formation');
    if (formation && formation.kind === 'formation') expect(formation.formation).toBe('Scattered');
    const lastMove = [...plan[0].steps].reverse().find(s => s.kind === 'move');
    if (lastMove && lastMove.kind === 'move') expect(dist(lastMove.to, meleeFoe.hex)).toBeGreaterThanOrEqual(2);
  });

  it('formed melee units may turn to close with an enemy out of their arc', () => {
    // Enemy two hexes "behind" facing 0: closing needs a turn first.
    const attacker = mk({ id: 'a1', team: 'blue', hex: hex(0, 0), facing: 0, movementPoints: 4, actionsAvailable: 2, weaponString: SPEAR });
    const foe = mk({ id: 'foe1', team: 'black', hex: hex(0, 2), facing: 0 });
    const plan = planAiMoves(ctxOf([attacker, foe], ['blue'], 'enemy'));
    const steps = plan[0].steps;
    expect(steps.some(s => s.kind === 'turn')).toBe(true);
    const moves = steps.filter(s => s.kind === 'move');
    expect(moves.length).toBeGreaterThan(0);
    const lastMove = moves[moves.length - 1];
    if (lastMove && lastMove.kind === 'move') expect(dist(lastMove.to, foe.hex)).toBe(1);
  });

  it('melee units advance straight at a front-arc enemy without a needless turn', () => {
    const attacker = mk({ id: 'a1', team: 'blue', hex: hex(0, 0), facing: 0, movementPoints: 4, actionsAvailable: 1, weaponString: SPEAR });
    const foe = mk({ id: 'foe1', team: 'black', hex: hex(0, -3), facing: 0 });
    const plan = planAiMoves(ctxOf([attacker, foe], ['blue'], 'enemy'));
    const steps = plan[0].steps;
    expect(steps.some(s => s.kind === 'turn')).toBe(false);
    const moves = steps.filter(s => s.kind === 'move');
    expect(moves.length).toBeGreaterThan(0);
    const lastMove = moves[moves.length - 1];
    if (lastMove && lastMove.kind === 'move') expect(dist(lastMove.to, foe.hex)).toBe(1);
  });

  it('does not finish an approach with a non-target enemy in its flank/rear', () => {
    const attacker = mk({ id: 'a1', team: 'blue', hex: hex(0, 0), facing: 0, movementPoints: 4, actionsAvailable: 2, weaponString: SPEAR });
    const first = mk({ id: 'e1', team: 'black', hex: hex(0, -3), facing: 3 });
    const second = mk({ id: 'e2', team: 'black', hex: hex(0, -4), facing: 3 });
    const plan = planAiMoves(ctxOf([attacker, first, second], ['blue'], 'enemy'));
    const attack = plan[0].steps.find(s => s.kind === 'attack');
    expect(attack).toBeDefined();
    if (!attack || attack.kind !== 'attack') return;
    const finalFacing = plan[0].steps.reduce(
      (f, s) => s.kind === 'turn' ? (s.dir === 'left' ? (f + 5) % 6 : (f + 1) % 6) : f,
      attacker.facing,
    );
    expect(ownExposureAt(attack.from, finalFacing, [first, second], attack.targetId)).toBe(0);
  });

  it('lineBearingPenalty keeps the front toward a distant enemy line', () => {
    const dest = hex(0, 0);
    const facing = 0;
    const farRear = mk({ id: 'rear', team: 'black', hex: hex(0, 3), weaponString: SPEAR });
    const farFront = mk({ id: 'front', team: 'black', hex: hex(0, -3), weaponString: SPEAR });
    expect(lineBearingPenalty(dest, facing, [farRear])).toBeGreaterThan(0);
    expect(lineBearingPenalty(dest, facing, [farFront])).toBe(0);
  });

  it('test 85 board: no flank/rear exposure while advancing in multiple maneuvers', () => {
    const starts: [string, number, number][] = [
      ['N', -3, -4], ['L', -2, -4], ['K', -1, -4], ['J', 0, -4],
      ['I', 1, -4], ['H', 2, -4], ['M', 3, -4], ['O', 4, -4],
    ];
    const blue = starts.map(([id, q, r]) => mk({
      id, team: 'blue', hex: hex(q, r), facing: 3, movementPoints: 3, actionsAvailable: 2, weaponString: SPEAR,
    }));
    const redStarts: [string, number][] = [
      ['G', -5], ['O2', -4], ['A', -3], ['B', -2], ['C', -1], ['E', 0], ['F', 1],
    ];
    const red = redStarts.map(([id, q]) => mk({
      id, team: 'black', hex: hex(q, 2), facing: 0, weaponString: SPEAR,
    }));
    const ctx = ctxOf([...blue, ...red], ['blue'], 'enemy');
    const rng = vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const battle = assignBattleRoles(blue, red, ctx, false);
    const plans = planAiMoves(ctx);
    rng.mockRestore();
    const byId = new Map(plans.map(p => [p.unitId, p]));

    for (const unit of blue) {
      const plan = byId.get(unit.id);
      expect(plan, unit.id).toBeDefined();
      if (!plan) continue;
      const moves = plan.steps.filter(s => s.kind === 'move');
      expect(moves.length, unit.id).toBeGreaterThanOrEqual(1);

      const finalFacing = plan.steps.reduce(
        (f, s) => s.kind === 'turn' ? (s.dir === 'left' ? (f + 5) % 6 : (f + 1) % 6) : f,
        unit.facing,
      );
      const lastMove = moves[moves.length - 1];
      const finalHex = lastMove && lastMove.kind === 'move' ? lastMove.to : unit.hex;
      const attack = plan.steps.find(s => s.kind === 'attack');
      const targetId = attack && attack.kind === 'attack' ? attack.targetId : undefined;
      // Frontage keeps its line clean; a surplus flanker may deliberately take
      // an exposed angle to encircle, and may hold farther back on its ring.
      if (battle.roles.get(unit.id)?.kind === 'frontage') {
        expect(ownExposureAt(finalHex, finalFacing, red, targetId), unit.id).toBe(0);
        expect(finalHex.r, unit.id).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('allows multiple movement maneuvers in one turn', () => {
    const attacker = mk({ id: 'a1', team: 'blue', hex: hex(0, 0), facing: 0, movementPoints: 1, actionsAvailable: 2, weaponString: SPEAR });
    const foe = mk({ id: 'e1', team: 'black', hex: hex(0, -3), facing: 0 });
    const plan = planAiMoves(ctxOf([attacker, foe], ['blue'], 'enemy'));
    const moves = plan[0].steps.filter(s => s.kind === 'move');
    expect(moves.length).toBeGreaterThanOrEqual(2);
  });

  it('uses leftover MP even with 0 actions', () => {
    const ai = mk({
      id: 'u1', team: 'blue', hex: hex(0, 0), facing: 0,
      movementPoints: 3, movementPointsAvailable: 2, actionsAvailable: 0,
    });
    const foe = mk({ id: 'f1', team: 'black', hex: hex(0, -4), facing: 0 });
    const plans = planAiMoves(ctxOf([ai, foe], ['blue'], 'enemy'));
    expect(plans.length).toBe(1);
    expect(plans[0].steps.some(s => s.kind === 'move')).toBe(true);
  });

  it('line assignment pairs black G-L to yellow A-F left-to-right (order-independent)', () => {
    const blackStarts: [string, number][] = [['G', -2], ['H', -1], ['I', 0], ['J', 1], ['K', 2], ['L', 3]];
    const yellowStarts: [string, number][] = [['A', 1], ['B', 2], ['C', 3], ['D', 4], ['E', 5], ['F', 6]];
    const black = blackStarts.map(([id, q]) => mk({
      id, team: 'black', hex: hex(q, 4), facing: 0, movementPoints: 2, actionsAvailable: 2, weaponString: SPEAR,
    }));
    const yellow = yellowStarts.map(([id, q]) => mk({
      id, team: 'blue', hex: hex(q, -2), facing: 3, weaponString: SPEAR,
    }));
    const expected: Record<string, string> = { G: 'A', H: 'B', I: 'C', J: 'D', K: 'E', L: 'F' };
    expect(Object.fromEntries(assignTargets(black, yellow, ALLIANCES))).toEqual(expected);
    expect(Object.fromEntries(assignTargets([...black].reverse(), yellow, ALLIANCES))).toEqual(expected);

    const plans = planAiMoves(ctxOf([...black, ...yellow], ['black'], 'friendly'));
    // Deterministic planning order follows the assigned lanes, not the input array.
    expect(plans.map(p => p.unitId)).toEqual(['G', 'H', 'I', 'J', 'K', 'L']);
    for (const unit of black) {
      const plan = plans.find(p => p.unitId === unit.id)!;
      const moves = plan.steps.filter(s => s.kind === 'move');
      const last = moves[moves.length - 1];
      const final = last && last.kind === 'move' ? last.to : unit.hex;
      expect(final.q, unit.id).toBe(blackStarts.find(([id]) => id === unit.id)![1] + 3);
      expect(final.r, unit.id).toBe(0);
    }
  });

  it('aggressive advance prefers a low-AC target', () => {
    const ai = mk({ id: 'a1', team: 'blue', hex: hex(0, 0), facing: 0, actionsAvailable: 2, weaponString: SPEAR });
    const highAc = mk({ id: 'hi', team: 'black', hex: hex(0, -1), facing: 3, currentAc: 20, baselineAc: 20 });
    const lowAc = mk({ id: 'lo', team: 'black', hex: hex(1, -1), facing: 3, currentAc: 10, baselineAc: 10 });
    const plan = planAiMoves(ctxOf([ai, highAc, lowAc], ['blue'], 'enemy', { advanced: true, stance: 'aggressive' }));
    const attack = plan[0]?.steps.find(s => s.kind === 'attack');
    expect(attack && attack.kind === 'attack' ? attack.targetId : null).toBe('lo');
  });

  it('defensive advance ranged picks Close Order when far and not under fire', () => {
    const forms: Record<string, Formation> = {
      'Open Order': { ...BASE_FORM, attack_capacity_multiplier: 1 },
      'Close Order': { ...BASE_FORM, id: 'form-close', name: 'Close Order', organization_level: 2, attack_capacity_multiplier: 2 },
      Scattered: {
        ...BASE_FORM, id: 'form-scat', name: 'Scattered', organization_level: 0,
        movement_multiplier: 1.5, be_attacked_range_modifier: 0.5, attack_capacity_multiplier: 1,
        melee_target_arcs: ['front', 'flank', 'rear'], ranged_target_arcs: ['front', 'flank', 'rear'],
      },
    };
    const archer = mk({
      id: 'a1', team: 'blue', hex: hex(0, 0), facing: 0, weaponString: LONGBOW,
      movementPoints: 3, actionsAvailable: 2,
      currentFormation: 'Open Order', formationAvailability: ['Open Order', 'Close Order', 'Scattered'],
    });
    const foe = mk({ id: 'f1', team: 'black', hex: hex(0, -5), facing: 3, weaponString: SPEAR });
    const plan = planAiMoves(ctxWithForms([archer, foe], ['blue'], 'enemy', forms, { advanced: true, stance: 'defensive' }));
    const formation = plan[0]?.steps.find(s => s.kind === 'formation');
    expect(formation && formation.kind === 'formation' ? formation.formation : null).toBe('Close Order');
  });

  it('defensive advance cluster moves at the slowest member speed', () => {
    const fast = mk({
      id: 'fast', team: 'blue', hex: hex(0, 0), facing: 0,
      movementPoints: 6, actionsAvailable: 2, weaponString: SPEAR,
    });
    const slow = mk({
      id: 'slow', team: 'blue', hex: hex(1, 0), facing: 0,
      movementPoints: 2, actionsAvailable: 2, weaponString: SPEAR,
    });
    const foe = mk({ id: 'f1', team: 'black', hex: hex(0, -4), facing: 0, weaponString: SPEAR });
    const foe2 = mk({ id: 'f2', team: 'black', hex: hex(1, -4), facing: 0, weaponString: SPEAR });
    const plan = planAiMoves(ctxOf([fast, slow, foe, foe2], ['blue'], 'enemy', { advanced: true, stance: 'defensive' }));
    const fastPlan = plan.find(p => p.unitId === 'fast')!;
    const moves = fastPlan.steps.filter(s => s.kind === 'move');
    expect(moves.length).toBeGreaterThan(0);
    let total = 0;
    for (const m of moves) {
      if (m.kind !== 'move') continue;
      total += m.cost;
      expect(m.cost, 'move cost').toBeLessThanOrEqual(2);
    }
    expect(total).toBeLessThanOrEqual(4);
  });

  function strikeLine(facingOf: (id: string) => number) {
    const starts = [['A', 1], ['B', 2], ['C', 3], ['D', 4], ['E', 5], ['F', 6]] as const;
    const enemyStarts = [['G', -1], ['H', 0], ['I', 1], ['J', 2], ['K', 3], ['L', 4]] as const;
    const attackers = starts.map(([id, q]) => mk({
      id, team: 'blue', hex: hex(q, -2), facing: facingOf(id),
      movementPoints: 3, actionsAvailable: 2, weaponString: SPEAR,
    }));
    const enemies = enemyStarts.map(([id, q]) => mk({
      id, team: 'black', hex: hex(q, 0), facing: 0,
      movementPoints: 3, actionsAvailable: 2, weaponString: SPEAR,
    }));
    return { attackers, enemies, all: [...attackers, ...enemies] };
  }

  function expectNoNeedlessTurns(
    plans: ReturnType<typeof planAiMoves>,
    attackers: Unit[],
    enemies: Unit[],
  ) {
    const byId = new Map([...attackers, ...enemies].map(u => [u.id, u]));
    for (const unit of attackers) {
      const plan = plans.find(p => p.unitId === unit.id);
      expect(plan, unit.id).toBeDefined();
      if (!plan) continue;
      expect(plan.steps.some(s => s.kind === 'turn'), `${unit.id} turned`).toBe(false);
      const moves = plan.steps.filter(s => s.kind === 'move');
      expect(moves.length, `${unit.id} moved`).toBeGreaterThan(0);
      const last = moves[moves.length - 1];
      const finalHex = last && last.kind === 'move' ? last.to : unit.hex;
      expect(
        Math.min(...enemies.map(e => dist(finalHex, e.hex))),
        `${unit.id} ended adjacent`,
      ).toBe(1);
      const attack = plan.steps.find(s => s.kind === 'attack');
      expect(attack, `${unit.id} attacked`).toBeDefined();
      if (attack && attack.kind === 'attack') {
        const target = byId.get(attack.targetId);
        expect(target, `${unit.id} target id`).toBeDefined();
        if (target) expect(dist(attack.from, target.hex), `${unit.id} attack range`).toBe(1);
      }
    }
  }

  it('strict turn rule: no rotation when a 0-turn attack exists (Aggressive)', () => {
    const { attackers, enemies, all } = strikeLine(() => 3);
    const plans = planAiMoves(ctxOf(all, ['blue'], 'enemy', { advanced: true, stance: 'aggressive' }));
    expectNoNeedlessTurns(plans, attackers, enemies);
  });

  it('strict turn rule: no rotation when a 0-turn attack exists (Defensive)', () => {
    const { attackers, enemies } = strikeLine(() => 3);
    // 5 vs 6 keeps every attacker on the front rank (no spare reserve), which
    // is what this turn-rule test is about.
    const front = attackers.slice(0, 5);
    const plans = planAiMoves(ctxOf([...front, ...enemies], ['blue'], 'enemy', { advanced: true, stance: 'defensive' }));
    expectNoNeedlessTurns(plans, front, enemies);
  });

  it('strict turn rule: prefers a straight attack over a diagonal assigned lane', () => {
    // C faces south-east and has a straight-ahead attack, while its assigned
    // target is diagonal. The straight attack must win without a rotation.
    const { attackers, all } = strikeLine(id => (id === 'C' || id === 'E' || id === 'F' ? 2 : 3));
    const plans = planAiMoves(ctxOf(all, ['blue'], 'enemy', { advanced: false, stance: 'aggressive' }));
    const cPlan = plans.find(p => p.unitId === 'C')!;
    expect(cPlan.steps.some(s => s.kind === 'turn')).toBe(false);
    const attack = cPlan.steps.find(s => s.kind === 'attack');
    expect(attack).toBeDefined();
    if (attack && attack.kind === 'attack') {
      const target = all.find(u => u.id === attack.targetId)!;
      expect(dist(attack.from, target.hex)).toBe(1);
    }
  });

  it('strict turn rule: never plans a turn after an attack', () => {
    const ai = mk({
      id: 'ai', team: 'blue', hex: hex(0, 0), facing: 0,
      movementPoints: 3, actionsAvailable: 2, weaponString: SPEAR,
    });
    const front = mk({ id: 'front', team: 'black', hex: hex(0, -1), facing: 3, weaponString: SPEAR });
    const rear = mk({ id: 'rear', team: 'black', hex: hex(0, 1), facing: 0, weaponString: SPEAR });
    const plan = planAiMoves(ctxOf([ai, front, rear], ['blue'], 'enemy', {
      advanced: true,
      stance: 'aggressive',
    }))[0];
    const attackIndex = plan.steps.findIndex(s => s.kind === 'attack');
    expect(attackIndex).toBeGreaterThanOrEqual(0);
    expect(plan.steps.slice(attackIndex + 1).some(s => s.kind === 'turn')).toBe(false);
  });

  function staggeredBoard() {
    const blueStarts = [['K', -3], ['M', -2], ['I', -1], ['H', 0], ['J', 1], ['L', 2]] as const;
    const redStarts = [['G', -5], ['E', -4], ['C', -3], ['B', -2], ['D', -1], ['F', 0]] as const;
    const blue = blueStarts.map(([id, q]) => mk({
      id, team: 'blue', hex: hex(q, -2), facing: 3,
      movementPoints: 3, actionsAvailable: 2, weaponString: SPEAR,
    }));
    const red = redStarts.map(([id, q]) => mk({
      id, team: 'black', hex: hex(q, 3), facing: 0,
      movementPoints: 3, actionsAvailable: 2, weaponString: SPEAR,
    }));
    return { blue, red, blueStarts };
  }

  function expectStaggeredAdvance(stance: 'aggressive' | 'defensive') {
    const { blue, red, blueStarts } = staggeredBoard();
    const plans = planAiMoves(ctxOf([...blue, ...red], ['blue'], 'enemy', {
      advanced: false,
      stance,
    }));
    expect(plans).toHaveLength(blue.length);
    for (const unit of blue) {
      const plan = plans.find(p => p.unitId === unit.id);
      expect(plan, unit.id).toBeDefined();
      if (!plan) continue;
      expect(plan.steps.some(s => s.kind === 'turn'), `${unit.id} turned`).toBe(false);
      const moves = plan.steps.filter(s => s.kind === 'move');
      expect(moves.length, `${unit.id} moved`).toBeGreaterThan(0);
      const last = moves[moves.length - 1];
      const finalHex = last && last.kind === 'move' ? last.to : unit.hex;
      const startQ = blueStarts.find(([id]) => id === unit.id)![1];
      expect(finalHex, `${unit.id} final hex`).toEqual(hex(startQ - 2, 2));
    }
  }

  it('basic defensive advances the full staggered line in one plan', () => {
    expectStaggeredAdvance('defensive');
  });

  it('basic aggressive advances the full staggered line in one plan', () => {
    expectStaggeredAdvance('aggressive');
  });

  function eightVsSix() {
    const blueStarts = [['N', -4], ['M', -3], ['K', -2], ['I', -1], ['H', 0], ['J', 1], ['L', 2], ['O', 4]] as const;
    const redStarts = [['G', -5], ['E', -4], ['C', -3], ['B', -2], ['D', -1], ['F', 0]] as const;
    const blue = blueStarts.map(([id, q]) => mk({
      id, team: 'blue', hex: hex(q, -2), facing: 3,
      movementPoints: 3, actionsAvailable: 2, weaponString: SPEAR,
    }));
    const red = redStarts.map(([id, q]) => mk({
      id, team: 'black', hex: hex(q, 3), facing: 0,
      movementPoints: 3, actionsAvailable: 2, weaponString: SPEAR,
    }));
    return { blue, red };
  }

  it('8 vs 6 advanced aggressive puts the surplus on flank/rear, not the frontage', () => {
    const { blue, red } = eightVsSix();
    const ctx = ctxOf([...blue, ...red], ['blue'], 'enemy', { advanced: true, stance: 'aggressive' });
    const battle = assignBattleRoles(blue, red, ctx, true);
    expect(battle.frontageIds.size).toBe(6);
    const extras = blue.filter(u => !battle.frontageIds.has(u.id));
    expect(extras).toHaveLength(2);
    for (const extra of extras) {
      const role = battle.roles.get(extra.id);
      expect(role?.kind === 'flank' || role?.kind === 'rear', extra.id).toBe(true);
    }
  });

  it('8 vs 6 defensive puts the surplus in the second rank', () => {
    const { blue, red } = eightVsSix();
    const ctx = ctxOf([...blue, ...red], ['blue'], 'enemy', { advanced: true, stance: 'defensive' });
    const battle = assignBattleRoles(blue, red, ctx, true);
    const extras = blue.filter(u => !battle.frontageIds.has(u.id));
    expect(extras).toHaveLength(2);
    for (const extra of extras) expect(battle.roles.get(extra.id)?.kind).toBe('reserve');
  });

  it('prefers fast surplus units for flanking and keeps the pair on one end', () => {
    const blueStarts: [string, number, number][] = [
      ['O', -3, 4], ['P', -2, 4], ['G', 0, 3], ['H', 1, 3],
      ['I', 2, 3], ['J', 3, 3], ['K', 4, 3], ['L', 6, 3],
    ];
    const blue = blueStarts.map(([id, q, mp]) => mk({
      id, team: 'blue', hex: hex(q, -8), facing: 3,
      movementPoints: mp, actionsAvailable: 2, weaponString: SPEAR,
    }));
    const red = [-4, -3, -2, -1, 0, 1].map((q, i) => mk({
      id: `r${i}`, team: 'black', hex: hex(q, 0), facing: 3, weaponString: SPEAR,
    }));
    const ctx = ctxOf([...blue, ...red], ['blue'], 'enemy', { advanced: true, stance: 'aggressive' });
    const rng = vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const battle = assignBattleRoles(blue, red, ctx, true);
    rng.mockRestore();

    expect(Array.from(battle.frontageIds).sort()).toEqual(['G', 'H', 'I', 'J', 'K', 'L']);
    const extras = blue.filter(u => !battle.frontageIds.has(u.id));
    expect(extras.map(u => u.id).sort()).toEqual(['O', 'P']);
    const extraRoles = extras.map(u => battle.roles.get(u.id));
    for (const role of extraRoles) {
      expect(role?.kind === 'flank' || role?.kind === 'rear').toBe(true);
    }
    const sides = extraRoles.map(role => role && 'side' in role ? role.side : null);
    expect(sides[0]).toBe(sides[1]);
  });

  it('second-rank enemies do not consume frontage slots', () => {
    const blue = [
      ['O', -3, 4], ['P', -2, 4], ['G', 0, 3], ['H', 1, 3],
      ['I', 2, 3], ['J', 3, 3], ['K', 4, 3], ['L', 6, 3],
    ].map(([id, q, mp]) => mk({
      id: id as string, team: 'blue', hex: hex(q as number, -8), facing: 3,
      movementPoints: mp as number, actionsAvailable: 2, weaponString: SPEAR,
    }));
    const front = [-4, -3, -2, -1, 0, 1].map((q, i) => mk({
      id: `F${i}`, team: 'black', hex: hex(q, 0), facing: 0, weaponString: SPEAR,
    }));
    const reserve = [-3, -2].map((q, i) => mk({
      id: `Q${i}`, team: 'black', hex: hex(q, 2), facing: 0, weaponString: SPEAR,
    }));
    const ctx = ctxOf([...blue, ...front, ...reserve], ['blue'], 'enemy', { advanced: true, stance: 'aggressive' });
    const rng = vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const battle = assignBattleRoles(blue, [...front, ...reserve], ctx, true);
    rng.mockRestore();

    expect(Array.from(battle.frontageIds).sort()).toEqual(['G', 'H', 'I', 'J', 'K', 'L']);
    const extras = blue.filter(u => !battle.frontageIds.has(u.id));
    expect(extras.map(u => u.id).sort()).toEqual(['O', 'P']);
    for (const id of Array.from(battle.frontageIds)) {
      const role = battle.roles.get(id);
      expect(role && 'targetId' in role ? role.targetId.startsWith('Q') : true, id).toBe(false);
    }
  });

  it('unlocked flankers stage outside enemy reach and never block the frontage', () => {
    const blue = [
      ['O', -3, 4], ['P', -2, 4], ['G', 0, 2], ['H', 1, 2],
      ['I', 2, 2], ['J', 3, 2], ['K', 4, 2], ['L', 6, 2],
    ].map(([id, q, mp]) => mk({
      id: id as string, team: 'blue', hex: hex(q as number, -8), facing: 3,
      movementPoints: mp as number, actionsAvailable: 2, weaponString: SPEAR,
    }));
    const red = [-4, -3, -2, -1, 0, 1].map((q, i) => mk({
      id: `r${i}`, team: 'black', hex: hex(q, 0), facing: 0, weaponString: SPEAR,
    }));
    const ctx = ctxOf([...blue, ...red], ['blue'], 'enemy', { advanced: true, stance: 'aggressive' });
    const rng = vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const battle = assignBattleRoles(blue, red, ctx, true);
    const plans = planAiMoves(ctx);
    rng.mockRestore();

    for (const id of ['O', 'P']) {
      expect(battle.roles.get(id)?.kind === 'flank' || battle.roles.get(id)?.kind === 'rear').toBe(true);
      const plan = plans.find(p => p.unitId === id);
      expect(plan, id).toBeDefined();
      if (!plan) continue;
      const moves = plan.steps.filter(s => s.kind === 'move');
      const last = moves[moves.length - 1];
      const finalHex = last && last.kind === 'move' ? last.to : blue.find(u => u.id === id)!.hex;
      expect(Math.min(...red.map(e => dist(finalHex, e.hex))), id).toBeGreaterThanOrEqual(3);
      expect(plan.steps.some(s => s.kind === 'attack'), id).toBe(false);
      const finalFacing = plan.steps.reduce(
        (f, s) => s.kind === 'turn' ? (s.dir === 'left' ? (f + 5) % 6 : (f + 1) % 6) : f,
        blue.find(u => u.id === id)!.facing,
      );
      const nearest = red.slice().sort((a, b) => dist(finalHex, a.hex) - dist(finalHex, b.hex))[0];
      expect(arcOfTarget(finalHex, finalFacing, nearest.hex), id).not.toBe('rear');
    }
  });

  it('a standing structure pins its defender; it never voluntarily moves out', () => {
    const template: StructureTemplate = {
      id: 'gate', name: 'Gate', description: '', anchor: 'hex', color: '#000',
      imageUrl: '', battlement: false, barricade: false, sinWave: false, ladder: false,
      hexBorder: true, elevation: 10, mpClimbUp: 4, mpClimbDown: 4, mpMountedUp: 4,
      mpMountedDown: 4, ac: 10, doorHp: null, maxHp: 100, dt: 0, modifiers: [],
      createdAt: '', updatedAt: '',
    };
    const structures = { '0,0': { templateId: 'gate', hp: 100, doorHp: 100 } };
    const holder = mk({
      id: 'holder', team: 'blue', hex: hex(0, 0), facing: 0,
      movementPoints: 3, actionsAvailable: 2, weaponString: SPEAR,
    });
    const foe = mk({ id: 'foe', team: 'black', hex: hex(0, -1), facing: 3, weaponString: SPEAR });
    const ctx = ctxOf([holder, foe], ['blue'], 'enemy', {
      structures, structureTemplates: { gate: template },
    });
    expect(assignBattleRoles([holder], [foe], ctx, true).roles.get('holder')?.kind).toBe('structure');
    const plan = planAiMoves(ctx).find(p => p.unitId === 'holder');
    expect(plan).toBeDefined();
    expect(plan?.steps.some(s => s.kind === 'move')).toBe(false);
  });
});

describe('defensive reserve line coverage', () => {
  function dist(a: Hex, b: Hex): number {
    return Math.max(Math.abs(a.q - b.q), Math.abs(a.r - b.r), Math.abs(a.s - b.s));
  }
  function blue(qs: number[], r: number, prefix = 'b'): Unit[] {
    return qs.map((q, i) => mk({
      id: `${prefix}${i}`, team: 'blue', hex: hex(q, r), facing: 3,
      movementPoints: 3, actionsAvailable: 2, weaponString: SPEAR,
    }));
  }
  function red(qs: number[], r: number, prefix = 'r'): Unit[] {
    return qs.map((q, i) => mk({
      id: `${prefix}${i}`, team: 'black', hex: hex(q, r), facing: 0, weaponString: SPEAR,
    }));
  }
  function plansOf(units: Unit[], enemies: Unit[], over: Partial<AiPlanContext> = {}) {
    const ctx = ctxOf([...units, ...enemies], ['blue'], 'enemy', {
      advanced: true,
      stance: 'defensive',
      ...over,
    });
    const rng = vi.spyOn(Math, 'random').mockReturnValue(0.5);
    try {
      return { ctx, battle: assignBattleRoles(units, enemies, ctx, true), plans: planAiMoves(ctx) };
    } finally {
      rng.mockRestore();
    }
  }

  it('ignores a single unpaired front-line enemy and reacts to real flankers', () => {
    expect(reserveThreatKind({ rear: false, flanking: false, paired: false, unpaired: true, surplusDispatch: false, adjacentToLine: false })).toBeNull();
    expect(reserveThreatKind({ rear: false, flanking: false, paired: false, unpaired: true, surplusDispatch: true, adjacentToLine: false })).toBe('surplus');
    expect(reserveThreatKind({ rear: true, flanking: true, paired: true, unpaired: false, surplusDispatch: false, adjacentToLine: true })).toBe('rear');
    expect(reserveThreatKind({ rear: false, flanking: true, paired: true, unpaired: false, surplusDispatch: false, adjacentToLine: true })).toBeNull();
    expect(reserveThreatKind({ rear: false, flanking: true, paired: true, unpaired: false, surplusDispatch: false, adjacentToLine: false })).toBe('flank');
  });

  it('pairs reserves with surplus front-line enemies when outnumbered by more than one', () => {
    const own = [...blue([-2, -1, 0, 1, 2], -2), ...blue([-1, 1], -4, 'bR')];
    const foe = red([-4, -3, -2, -1, 0, 1, 2], 0);
    const { battle, plans } = plansOf(own, foe);
    const reserves = own.filter(u => battle.roles.get(u.id)?.kind === 'reserve');
    expect(reserves).toHaveLength(2);
    const unpaired = foe.filter(u => battle.unpairedFoeIds.has(u.id));
    expect(unpaired).toHaveLength(2);
    for (const reserve of reserves) {
      const plan = plans.find(p => p.unitId === reserve.id);
      expect(plan?.steps.length ?? 0, reserve.id).toBeGreaterThan(0);
      const moves = plan?.steps.filter(s => s.kind === 'move') ?? [];
      const last = moves[moves.length - 1];
      const final = last && last.kind === 'move' ? last.to : reserve.hex;
      const start = Math.min(...unpaired.map(e => dist(reserve.hex, e.hex)));
      const end = Math.min(...unpaired.map(e => dist(final, e.hex)));
      expect(end, reserve.id).toBeLessThan(start);
    }
  });

  it('intercepts a flanker beyond its own 3-hex radius', () => {
    const own = [...blue([-2, -1, 0, 1, 2, 3], -2), ...blue([0], -4, 'bR')];
    const foe = [...red([-3, -2, -1, 0, 1], 0), ...red([5], -1, 'rF')];
    const { plans } = plansOf(own, foe);
    const reserve = own.find(u => u.id === 'bR0')!;
    const plan = plans.find(p => p.unitId === reserve.id);
    expect(plan?.steps.some(s => s.kind === 'move'), 'reserve moved').toBe(true);
    const moves = plan?.steps.filter(s => s.kind === 'move') ?? [];
    const last = moves[moves.length - 1];
    const final = last && last.kind === 'move' ? last.to : reserve.hex;
    const flanker = foe.find(u => u.id === 'rF0')!;
    expect(dist(final, flanker.hex), 'closer to the flanker').toBeLessThan(dist(reserve.hex, flanker.hex));
    const finalFacing = plan!.steps.reduce(
      (f, s) => s.kind === 'turn' ? (s.dir === 'left' ? (f + 5) % 6 : (f + 1) % 6) : f,
      reserve.facing,
    );
    expect(arcOfTarget(final, finalFacing, flanker.hex), 'faces the flanker').toBe('front');
  });

  it('patches a routing hole when no threat is present', () => {
    const front = blue([-2, -1, 0, 1, 2], -2).map(u => (
      u.id === 'b2' ? { ...u, currentFormation: 'Routed' } : u
    ));
    const own = [...front, ...blue([0], -4, 'bR')];
    const foe = red([-2, -1, 0, 1, 2], 0);
    const { plans } = plansOf(own, foe);
    const reserve = own.find(u => u.id === 'bR0')!;
    const plan = plans.find(p => p.unitId === reserve.id);
    const moves = plan?.steps.filter(s => s.kind === 'move') ?? [];
    const last = moves[moves.length - 1];
    const final = last && last.kind === 'move' ? last.to : reserve.hex;
    expect(final.r, 'moved toward the line').toBeGreaterThan(reserve.hex.r);
    expect(final.q, 'moved into the broken line').toBeGreaterThanOrEqual(-2);
    expect(final.q, 'moved into the broken line').toBeLessThanOrEqual(0);
  });

  it('keeps an uncommitted advanced reserve in Scattered', () => {
    const own = blue([-2, -1, 0, 1, 2], -2).map(u => ({
      ...u, formationAvailability: ['Scattered'],
    }));
    const foe = red([-2, -1, 0, 1], 5);
    const { battle, plans } = plansOf(own, foe);
    const reserve = own.find(u => battle.roles.get(u.id)?.kind === 'reserve');
    expect(reserve).toBeDefined();
    const plan = plans.find(p => p.unitId === reserve!.id);
    expect(plan?.steps.some(s => s.kind === 'formation' && s.formation === 'Scattered')).toBe(true);
  });

  it('uses one central station per short line and splits a long line into sectors', () => {
    const short = blue([-2, -1, 0, 1, 2], 0);
    const shortFoe = red([0], 2);
    const shortLine = computeBattleLine(short, shortFoe)!;
    const shortPlacement = assignReservePlacements(blue([0], -4, 's'), shortLine, () => 6).get('s0')!;
    expect(shortPlacement.groupCount).toBe(1);
    expect(dist(shortPlacement.station, hex(0, 0))).toBe(2);

    const long = blue([-5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5, 6], 0);
    const longFoe = red([-2, -1, 0, 1, 2], 2);
    const longLine = computeBattleLine(long, longFoe)!;
    const placements = assignReservePlacements(blue([-4, 4], -4, 'l'), longLine, () => 6);
    const left = placements.get('l0')!;
    const right = placements.get('l1')!;
    expect(left.groupCount).toBe(2);
    expect(left.group).not.toBe(right.group);
    expect(left.station).not.toEqual(right.station);
  });

  it('classifies front, flank and rear threats and finds interior gaps', () => {
    const own = blue([-2, -1, 0, 1, 2], 0);
    const foe = red([0], 2);
    const line = computeBattleLine(own, foe)!;
    const front = red([0], 2, 'front')[0];
    const rear = red([0], -2, 'rear')[0];
    const flank = red([5], 1, 'flank')[0];
    expect(isFlankOrRearThreat(front, line)).toBe(false);
    expect(isFlankOrRearThreat(rear, line)).toBe(true);
    expect(isFlankOrRearThreat(flank, line)).toBe(true);

    const gapped = blue([-2, -1, 1, 2], 0, 'g');
    const gappedLine = computeBattleLine(gapped, foe)!;
    const gaps = findLineGaps(
      gappedLine,
      new Set([...gapped.map(u => u.id), 'gone']),
      new Map([...gapped.map(u => [u.id, u.hex] as const), ['gone', hex(0, 2)] as const]),
      new Set(),
    );
    expect(gaps.some(g => g.hexes.some(h => h.q === 0 && h.r === 0))).toBe(true);
    const slot = gaps.find(g => g.key === 'slot:gone');
    expect(slot?.hexes).toContainEqual(hex(0, 2));
  });
});

describe('enemyAI anti-idle and defensive facing', () => {
  function dist(a: Hex, b: Hex): number {
    return Math.max(Math.abs(a.q - b.q), Math.abs(a.r - b.r), Math.abs(a.s - b.s));
  }
  it('turns to face an adjacent flank enemy instead of taking an exposing attack', () => {
    const defender = mk({
      id: 'def', team: 'blue', hex: hex(0, 0), facing: 0,
      movementPoints: 3, actionsAvailable: 2, weaponString: SPEAR,
    });
    const front = mk({
      id: 'front', team: 'black', hex: hex(0, -1), facing: 0, weaponString: GREATSWORD,
    });
    const flank = mk({
      id: 'flank', team: 'black', hex: hex(-1, 0), facing: 1, weaponString: SPEAR,
    });
    const plan = planAiMoves(ctxOf([defender, front, flank], ['blue'], 'enemy', {
      advanced: false,
      stance: 'defensive',
    })).find(p => p.unitId === 'def');
    expect(plan, 'defender plan').toBeDefined();
    const firstAttack = plan!.steps.findIndex(s => s.kind === 'attack');
    const lastTurn = plan!.steps.reduce((idx, s, i) => s.kind === 'turn' ? i : idx, -1);
    expect(lastTurn, 'turns to face').toBeGreaterThanOrEqual(0);
    expect(firstAttack === -1 || lastTurn < firstAttack, 'faces before attacking').toBe(true);
  });

  it('pushes an end unit into reserve when the front lines match', () => {
    const blue = [-2, -1, 0, 1, 2, 3].map((q, i) => mk({
      id: `b${i}`, team: 'blue', hex: hex(q, -2), facing: 3,
      movementPoints: 3, actionsAvailable: 2, weaponString: SPEAR,
    }));
    const red = [-2, -1, 0, 1, 2, 3].map((q, i) => mk({
      id: `r${i}`, team: 'black', hex: hex(q, 0), facing: 0, weaponString: SPEAR,
    }));
    const ctx = ctxOf([...blue, ...red], ['blue'], 'enemy', {
      advanced: true,
      stance: 'defensive',
    });
    const rng = vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const battle = assignBattleRoles(blue, red, ctx, true);
    const plans = planAiMoves(ctx);
    rng.mockRestore();

    const extras = blue.filter(u => !battle.frontageIds.has(u.id));
    expect(extras).toHaveLength(1);
    expect(battle.roles.get(extras[0].id)?.kind).toBe('reserve');
    const plan = plans.find(p => p.unitId === extras[0].id);
    expect(plan?.steps.some(s => s.kind === 'move'), 'reserve leaves the end for its station').toBe(true);
  });

  it('does not close before the main body is engaged', () => {
    const blue = [
      ...['O', 'P'].map((id, i) => mk({
        id, team: 'blue', hex: hex(-3 + i, -1), facing: 3,
        movementPoints: 4, actionsAvailable: 2, weaponString: SPEAR,
      })),
      ...['G', 'H', 'I', 'J', 'K', 'L'].map((id, i) => mk({
        id, team: 'blue', hex: hex(i, -1), facing: 3,
        movementPoints: 3, actionsAvailable: 2, weaponString: SPEAR,
      })),
    ];
    const red = ['A', 'B', 'C', 'D', 'E', 'F'].map((id, i) => mk({
      id, team: 'black', hex: hex(i, 1), facing: 0, weaponString: SPEAR,
    }));
    const ctx = ctxOf([...blue, ...red], ['blue'], 'enemy', {
      advanced: true,
      stance: 'aggressive',
    });
    const rng = vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const plans = planAiMoves(ctx);
    rng.mockRestore();

    for (const id of ['O', 'P']) {
      const unit = blue.find(u => u.id === id)!;
      const plan = plans.find(p => p.unitId === id);
      expect(plan?.steps.some(s => s.kind === 'attack'), id).toBe(false);
      const moves = plan?.steps.filter(s => s.kind === 'move') ?? [];
      const last = moves[moves.length - 1];
      const finalHex = last && last.kind === 'move' ? last.to : unit.hex;
      expect(Math.min(...red.map(e => dist(finalHex, e.hex))), id).toBeGreaterThanOrEqual(3);
    }
  });

  it('faces once instead of oscillating between two adjacent flank enemies', () => {
    const defender = mk({
      id: 'def', team: 'blue', hex: hex(0, 0), facing: 0,
      movementPoints: 6, actionsAvailable: 2, weaponString: SPEAR,
    });
    const front = mk({
      id: 'front', team: 'black', hex: hex(0, -1), facing: 0, weaponString: GREATSWORD,
    });
    const left = mk({
      id: 'left', team: 'black', hex: hex(-1, 0), facing: 1, weaponString: SPEAR,
    });
    const right = mk({
      id: 'right', team: 'black', hex: hex(1, 0), facing: 4, weaponString: SPEAR,
    });
    const plan = planAiMoves(ctxOf([defender, front, left, right], ['blue'], 'enemy', {
      advanced: false,
      stance: 'defensive',
    })).find(p => p.unitId === 'def');
    const turns = plan?.steps.filter(s => s.kind === 'turn') ?? [];
    expect(turns.length, 'turns to face').toBeGreaterThan(0);
    expect(new Set(turns.map(t => t.kind === 'turn' ? t.dir : null)).size, 'one facing direction').toBe(1);
  });

  it('takes a near-breakeven attack with more than one action instead of holding', () => {
    const attacker = mk({
      id: 'a1', team: 'blue', hex: hex(0, 0), facing: 0, weaponString: DAGGER,
      currentTroopCount: 10, maxTroopCount: 10, currentUnitHp: 100, maxUnitHp: 100,
      actionsAvailable: 2,
    });
    const foe = mk({
      id: 'd1', team: 'black', hex: hex(0, -1), facing: 3, weaponString: GREATSWORD,
      currentTroopCount: 7, maxTroopCount: 7, troopHp: 10, currentUnitHp: 70, maxUnitHp: 70,
    });
    const forms: Record<string, Formation> = {
      'Open Order': { ...BASE_FORM, retaliate_arcs: { front: 'full', flank: 'full', rear: 'full' } },
    };
    const plan = planAiMoves(ctxWithForms([attacker, foe], ['blue'], 'enemy', forms, {
      advanced: true,
      stance: 'aggressive',
    }))[0];
    expect(plan?.steps.some(s => s.kind === 'attack')).toBe(true);
  });

  it('flankers keep circling and close on an engaged enemy instead of queueing', () => {
    const blue = [
      ...['O', 'P'].map((id, i) => mk({
        id, team: 'blue', hex: hex(-3 + i, -1), facing: 3,
        movementPoints: 4, actionsAvailable: 2, weaponString: SPEAR,
      })),
      ...['G', 'H', 'I', 'J', 'K', 'L'].map((id, i) => mk({
        id, team: 'blue', hex: hex(i, -1), facing: 3,
        movementPoints: 3, actionsAvailable: 2, weaponString: SPEAR,
      })),
    ];
    const red = ['A', 'B', 'C', 'D', 'E', 'F'].map((id, i) => mk({
      id, team: 'black', hex: hex(i, 0), facing: 0, weaponString: SPEAR,
    }));
    const ctx = ctxOf([...blue, ...red], ['blue'], 'enemy', {
      advanced: true,
      stance: 'aggressive',
    });
    const rng = vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const battle = assignBattleRoles(blue, red, ctx, true);
    const plans = planAiMoves(ctx);
    rng.mockRestore();

    for (const id of ['O', 'P']) {
      expect(battle.roles.get(id)?.kind === 'flank' || battle.roles.get(id)?.kind === 'rear').toBe(true);
      const unit = blue.find(u => u.id === id)!;
      const plan = plans.find(p => p.unitId === id);
      expect(plan?.steps.length ?? 0, id).toBeGreaterThan(0);
      const moves = plan?.steps.filter(s => s.kind === 'move') ?? [];
      const last = moves[moves.length - 1];
      const finalHex = last && last.kind === 'move' ? last.to : unit.hex;
      const attack = plan?.steps.some(s => s.kind === 'attack') ?? false;
      const startDist = Math.min(...red.map(e => dist(unit.hex, e.hex)));
      const endDist = Math.min(...red.map(e => dist(finalHex, e.hex)));
      expect(attack || endDist < startDist, `${id} circles or closes`).toBe(true);
    }
  });
});

describe('enemyAI allianceOf', () => {
  it('defaults to friendly for unknown teams', () => {
    expect(allianceOf(mk({ id: 'x', team: 'nope', hex: hex(0, 0) }), ALLIANCES)).toBe('friendly');
  });
});
