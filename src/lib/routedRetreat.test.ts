import { describe, it, expect } from 'vitest';
import { Unit, AllianceGroup, Formation } from '@/types/gameProtocol';
import { adjacentRetreatCandidates, routThroughOptions, defaultRetreat, enemyKillZone, retreatDiagnosis } from './routedRetreat';

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


describe('routing units never yield (no rout-through through another routing unit)', () => {
  const routedFriendly = () => unit('rf', 'blue', h(0, 0), { currentFormation: 'Routed', movementPoints: 3 });
  const around = (hex: { q: number; r: number; s: number }) => unit('x', 'blue', hex, { currentFormation: 'Open Order' });
  const neighborHexes = [h(1, 0), h(0, 1), h(-1, 1), h(-1, 0), h(0, -1), h(1, -1)];

  it('a friendly Routed unit is not a rout-through candidate, even as the only neighbour', () => {
    const routed = routedFriendly();
    const routedAlly = unit('ra', 'blue', h(1, -1), { currentFormation: 'Routed' });
    // Only adjacent unit is another routing ally; all other hexes far.
    const ctx = { routed, units: [routed, routedAlly], alliances: groups, formationsMap: forms(1) };
    expect(routThroughOptions(ctx).length).toBe(0);
    const diag = retreatDiagnosis(ctx);
    expect(diag.allAdjacentRouting).toBe(true);
  });

  it('fully surrounded by routing allies: no legal adjacent, no through, flags all-routing', () => {
    const routed = routedFriendly();
    const crowd = neighborHexes.map((hex, i) => unit(`c${i}`, 'blue', hex, { currentFormation: 'Routed' }));
    const ctx = { routed, units: [routed, ...crowd], alliances: groups, formationsMap: forms(1) };
    expect(adjacentRetreatCandidates(ctx).length).toBe(0);
    expect(routThroughOptions(ctx).length).toBe(0);
    const diag = retreatDiagnosis(ctx);
    expect(diag.adjacentLegal).toBe(0);
    expect(diag.throughLegal).toBe(0);
    expect(diag.allAdjacentRouting).toBe(true);
    expect(diag.allAdjacentOrdered).toBe(false);
  });

  it('surrounded by ordered ranks flags all-ordered (routed cannot push through)', () => {
    const routed = routedFriendly();
    const ranks = neighborHexes.map((hex, i) => unit(`o${i}`, 'blue', hex, { currentFormation: 'Close Order' }));
    const ctx = { routed, units: [routed, ...ranks], alliances: groups, formationsMap: forms(1) };
    const diag = retreatDiagnosis(ctx);
    expect(diag.allAdjacentOrdered).toBe(true);
    expect(diag.allAdjacentRouting).toBe(false);
    expect(routThroughOptions(ctx).length).toBe(0); // Close Order is not pass-through
  });

  it('no blockers / legal options exist: diagnosis stays neutral', () => {
    const routed = routedFriendly();
    const enemy = unit('e', 'red', h(9, 0));
    const ctx = { routed, units: [routed, enemy], alliances: groups, formationsMap: forms(1) };
    const diag = retreatDiagnosis(ctx);
    expect(diag.adjacentLegal).toBe(6);
    expect(diag.allAdjacentRouting).toBe(false);
    expect(diag.allAdjacentOrdered).toBe(false);
    void around; // (helper above used by future cases)
  });
});
