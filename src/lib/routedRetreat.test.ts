import { describe, it, expect } from 'vitest';
import { Unit, AllianceGroup, Formation } from '@/types/gameProtocol';
import { adjacentRetreatCandidates, routThroughOptions, defaultRetreat, choosePursuer, enemyKillZone } from './routedRetreat';

const h = (q: number, r: number) => ({ q, r, s: -q - r });

const unit = (id: string, team: string, hex: { q: number; r: number; s: number }, overrides: Partial<Unit> = {}): Unit => ({
  id, team, hex, isDeleted: false, hidden: false, isHero: false, attachedToUnitId: null,
  currentFormation: 'Open Order', facing: 0, currentUnitHp: 10, maxUnitHp: 10,
  isShielded: false, canCharge: false, isCharging: false, chargeDistance: 0,
  ignoreMoraleChecks: false, currentTroopCount: 1, maxTroopCount: 1,
  movementPoints: 3, movementPointsAvailable: 0, actionsAvailable: 2, ...overrides,
} as unknown as Unit);

const form = (mult: number): Formation => ({ name: 'x', movement_multiplier: mult } as unknown as Formation);
const forms = (friendlyMult = 1): Record<string, Formation> => ({
  Routed: form(friendlyMult),
  'Open Order': { name: 'Open Order', movement_multiplier: 1, stop_enemy_movement_arcs: ['front'] } as unknown as Formation,
  Scattered: { name: 'Scattered', movement_multiplier: 1 } as unknown as Formation,
});

const groups: Record<string, AllianceGroup> = { blue: 'friendly', red: 'enemy' };

describe('routed retreat candidates', () => {
  it('excludes occupied and enemy kill-zone hexes; keeps other neighbors', () => {
    const routed = unit('r', 'blue', h(0, 0), { currentFormation: 'Routed' });
    const occupier = unit('f', 'blue', h(0, -1)); // friendly blocker
    const enemy = unit('e', 'red', h(5, 0));      // far ZOC, not adjacent to routed
    const units = [routed, occupier, enemy];
    const ctx = { routed, units, alliances: groups, formationsMap: forms(1) };
    const cands = adjacentRetreatCandidates(ctx);
    expect(cands.length).toBe(5); // 6 neighbors minus occupied (0,-1)
    expect(cands.some(c => c.q === 0 && c.r === -1)).toBe(false);
    const kill = enemyKillZone(ctx);
    for (const c of cands) expect(kill.has(`${c.q},${c.r}`)).toBe(false);
    expect(kill.has('5,-1')).toBe(true); // enemy ZOC exists (far away)
  });
});

describe('rout-through friendly units', () => {
  it('offers 2-hex rout through Open Order (disrupts) and Scattered (free), no adjacency needed', () => {
    const routed = unit('r', 'blue', h(0, 0), { currentFormation: 'Routed' });
    const enemy = unit('e', 'red', h(9, 0)); // far, so no adjacent option here
    const open = unit('o', 'blue', h(1, -1), { currentFormation: 'Open Order' });
    const scattered = unit('s', 'blue', h(0, -1), { currentFormation: 'Scattered' });
    const ctx = { routed, units: [routed, enemy, open, scattered], alliances: groups, formationsMap: forms(1) };
    // Block all adjacent retreats by surrounding routed with friendly units + enemy far.
    const opts = routThroughOptions(ctx);
    expect(opts.length).toBe(2);
    const oo = opts.find(o => o.throughUnitId === 'o');
    const sc = opts.find(o => o.throughUnitId === 's');
    expect(oo?.disruptToScattered).toBe(true);   // Open Order scatters
    expect(oo?.dest).toEqual(h(2, -2));
    expect(sc?.disruptToScattered).toBe(false);  // Scattered unaffected
    expect(sc?.dest).toEqual(h(0, -2));
  });

  it('ignores ordered (Close Order) friendly blockers — no rout-through through them', () => {
    const routed = unit('r', 'blue', h(0, 0), { currentFormation: 'Routed' });
    const ordered = unit('c', 'blue', h(1, -1), { currentFormation: 'Close Order' });
    const ctx = { routed, units: [routed, ordered], alliances: groups, formationsMap: forms(1) };
    expect(routThroughOptions(ctx).length).toBe(0);
  });
});

describe('defaultRetreat resolution', () => {
  it('single legal hex auto-chooses it; several legal hexes require the owner', () => {
    const routed = unit('r', 'blue', h(0, 0), { currentFormation: 'Routed' });
    const enemy = unit('e', 'red', h(9, 0));
    // One blocker -> five legal neighbors: owner-pick.
    const blocker = unit('f', 'blue', h(0, -1));
    let ctx = { routed, units: [routed, enemy, blocker], alliances: groups, formationsMap: forms(1) };
    expect(defaultRetreat(ctx).kind).toBe('owner-pick');
    // No empty neighbors at all (all six occupied by friendly Open Order) ->
    // falls back to rout-through, preferred over standing still.
    const neighborHexes = [h(1, 0), h(0, 1), h(-1, 1), h(-1, 0), h(0, -1), h(1, -1)];
    const wall = neighborHexes.map((hex, i) => unit(`w${i}`, 'blue', hex, { currentFormation: 'Open Order' }));
    ctx = { routed, units: [routed, ...wall], alliances: groups, formationsMap: forms(1) };
    const res = defaultRetreat(ctx);
    expect(res.kind).toBe('rout-through');
    if (res.kind === 'rout-through') expect(res.option.disruptToScattered).toBe(true);
  });
});

describe('choosePursuer', () => {
  const rout = () => unit('r', 'blue', h(0, 0), { currentFormation: 'Routed', movementPoints: 3, movementPointsAvailable: 0, actionsAvailable: 0 });
  const host = (id: string, hex: { q: number; r: number; s: number }, mp = 6, availMp = 0) =>
    unit(id, 'red', hex, { movementPoints: mp, movementPointsAvailable: availMp, actionsAvailable: 1 });

  it('returns the attacker when it is faster and can pay', () => {
    const attacker = host('a', h(1, 0), 6, 1);
    const routed = rout();
    const units = [routed, attacker];
    const p = choosePursuer(attacker, routed, units, groups, forms(1), () => 0.1);
    expect(p?.id).toBe('a');
  });

  it('skips faster units that cannot pay; pays with actions', () => {
    const brokeFast = host('b', h(1, 0), 6, 0); // no MP, but 1 action (can pay)
    const routed = rout();
    const units = [routed, brokeFast];
    const p = choosePursuer(unit('x', 'red', h(9, 0), { movementPoints: 1 }), routed, units, groups, forms(1));
    expect(p?.id).toBe('b'); // b can convert its action
    const brokeAll = host('c', h(1, 0), 6, 0);
    brokeAll.actionsAvailable = 0;
    const p2 = choosePursuer(unit('x', 'red', h(9, 0), { movementPoints: 1 }), routed, [routed, brokeAll], groups, forms(1));
    expect(p2).toBeNull(); // faster but cannot pay -> no pursuit
  });

  it('picks the fastest eligible when the attacker is too slow', () => {
    const slowAttacker = host('a', h(1, 0), 2, 1); // speed 2 not > 3
    const fast1 = host('f1', h(0, 1), 5, 2);
    const fast2 = host('f2', h(1, -1), 5, 1);
    const routed = rout();
    const units = [routed, slowAttacker, fast1, fast2];
    const p = choosePursuer(slowAttacker, routed, units, groups, forms(1), () => 0.5);
    // same speed: most available MP wins (fast1 has 2)
    expect(p?.id).toBe('f1');
  });

  it('returns null when no adjacent hostile is faster', () => {
    const routed = rout();
    const slow = host('s', h(1, 0), 2, 2);
    const p = choosePursuer(slow, routed, [routed, slow], groups, forms(1));
    expect(p).toBeNull();
  });
});
