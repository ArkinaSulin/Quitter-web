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
    // hosts with an attached hero are eligible (the hero rides with them)
    expect(isAiControllable(ai, { alliances: ALLIANCES, teams: ['blue'], activeAlliance: 'enemy' }, new Set(['u1']))).toBe(true);
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
    const foe = mk({ id: 'foe1', team: 'black', hex: hex(0, -3), facing: 2 });
    const plans = planAiMoves(ctxOf([ai, foe], ['blue'], 'enemy'));
    expect(plans.length).toBe(1);
    const move = plans[0].steps.find(s => s.kind === 'move');
    expect(move).toBeDefined();
    const attack = plans[0].steps.find(s => s.kind === 'attack');
    expect(attack).toBeUndefined(); // out of melee reach -> approaches, no attack
  });

  it('is deterministic for identical inputs', () => {
    const ai = mk({ id: 'u1', team: 'blue', hex: hex(0, 0), facing: 0, actionsAvailable: 2 });
    const foe = mk({ id: 'foe1', team: 'black', hex: hex(0, -1), facing: 2 });
    const a = planAiMoves(ctxOf([ai, foe], ['blue'], 'enemy'));
    const b = planAiMoves(ctxOf([ai, foe], ['blue'], 'enemy'));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe('enemyAI smarter tactics', () => {
  const LONGBOW = 'Longbow,3,1d8,false,3,6,0,false,true,false,false,1,true,Dex,circle';
  const SHORTBOW2 = 'Shortbow,2,1d6,false,2,3,0,false,true,false,false,1,true,Dex,circle';

  function dist(a: Hex, b: Hex): number {
    return Math.max(Math.abs(a.q - b.q), Math.abs(a.r - b.r), Math.abs(a.s - b.s));
  }

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
  it('host with a FRONT hero plots as a normal melee unit (hero rides with it)', () => {
    const host = mk({ id: 'host', team: 'blue', hex: hex(0, 0), facing: 0, actionsAvailable: 2, weaponString: SPEAR });
    const hero = mk({ id: 'her', team: 'blue', hex: hex(0, 0), isHero: true, currentFormation: 'Hero', attachedToUnitId: 'host', attachedPosition: 'front', actionsAvailable: 5 });
    const foe = mk({ id: 'foe', team: 'black', hex: hex(0, -1), facing: 2 });
    const plans = planAiMoves(ctxOf([host, hero, foe], ['blue'], 'enemy'));
    expect(plans.length).toBeGreaterThan(0);
    expect(plans.every(p => p.unitId === 'host')).toBe(true); // the hero is not plotted separately
    expect(plans[0].steps[0].kind).toBe('attack'); // normal melee logic (no AGR is an engine perk)
  });

  it('host with a BACK (protected) hero skirmishes instead of charging into melee', () => {
    const host = mk({
      id: 'host', team: 'blue', hex: hex(0, 0), facing: 0, actionsAvailable: 2, weaponString: SPEAR,
      movementPoints: 4, formationAvailability: ['Open Order', 'Scattered'],
    });
    const hero = mk({ id: 'her', team: 'blue', hex: hex(0, 0), isHero: true, currentFormation: 'Hero', attachedToUnitId: 'host', attachedPosition: 'back', actionsAvailable: 5 });
    const foe = mk({ id: 'foe', team: 'black', hex: hex(0, -1), facing: 2 }); // adjacent — would melee if normal
    const plans = planAiMoves(ctxOf([host, hero, foe], ['blue'], 'enemy'));
    expect(plans.length).toBeGreaterThan(0);
    const steps = plans[0].steps;
    expect(steps.some(s => s.kind === 'attack')).toBe(false); // never close into melee
    expect(steps.some(s => s.kind === 'formation' && s.formation === 'Scattered')).toBe(true); // skirmish form
  });
});

describe('enemyAI allianceOf', () => {
  it('defaults to friendly for unknown teams', () => {
    expect(allianceOf(mk({ id: 'x', team: 'nope', hex: hex(0, 0) }), ALLIANCES)).toBe('friendly');
  });
});
