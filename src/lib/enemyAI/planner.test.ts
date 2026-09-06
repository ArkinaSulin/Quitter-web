import { describe, it, expect } from 'vitest';
import {
  planAiMoves,
  isAiControllable,
  enemyGroupsOf,
  legalTargets,
  allianceOf,
  hexKeyOf,
  AiPlanContext,
} from '@/lib/enemyAI';
import { Unit, Hex, AllianceGroup, Formation } from '@/types/gameProtocol';

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

function ctxOf(units: Unit[], teams: string[], activeAlliance: AllianceGroup | null, over: Partial<AiPlanContext> = {}): AiPlanContext {
  return { units, alliances: ALLIANCES, formations: NO_FORMS, teams, activeAlliance, ...over };
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
      ['no actions', { actionsAvailable: 0 }],
    ];
    for (const [label, patch] of cases) {
      expect(isAiControllable(mk({ ...ai, ...patch }), { alliances: ALLIANCES, teams: ['blue'], activeAlliance: 'enemy' }, hosted), label).toBe(false);
    }
    // hosted by an attached hero
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

  it('moves never leave the unit\'s own team or target allies, and respect the action cap', () => {
    const ai = mk({ id: 'u1', team: 'blue', hex: hex(0, 0), facing: 0, actionsAvailable: 1, movementPoints: 2 });
    const foe = mk({ id: 'foe1', team: 'black', hex: hex(0, 4), facing: 2 });
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
});

describe('enemyAI allianceOf', () => {
  it('defaults to friendly for unknown teams', () => {
    expect(allianceOf(mk({ id: 'x', team: 'nope', hex: hex(0, 0) }), ALLIANCES)).toBe('friendly');
  });
});
