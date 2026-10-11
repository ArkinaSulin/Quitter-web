import { describe, it, expect } from 'vitest';
import { Unit, AllianceGroup, Formation, getOrganizationLevel } from '@/types/gameProtocol';
import { routRetreatPath, enemyKillZone } from '@/packages/morale/lib/routedRetreat';

const h = (q: number, r: number) => ({ q, r, s: -q - r });

const unit = (id: string, team: string, hex: { q: number; r: number; s: number }, overrides: Partial<Unit> = {}): Unit => ({
  id, team, hex, isDeleted: false, hidden: false, isHero: false, attachedToUnitId: null, attachedPosition: null,
  currentFormation: 'Open Order', facing: 0, currentUnitHp: 10, maxUnitHp: 10, sizeCategory: 100,
  isShielded: false, canCharge: false, isCharging: false, chargeDistance: 0,
  ignoreMoraleChecks: false, currentTroopCount: 1, maxTroopCount: 1,
  movementPoints: 3, movementPointsAvailable: 0, actionsAvailable: 2, ...overrides,
} as unknown as Unit);

const form = (name: string): Formation => ({ name, movement_multiplier: 1, stop_enemy_movement_arcs: ['front'] } as unknown as Formation);
const forms: Record<string, Formation> = {
  Routed: form('Routed'), 'Open Order': form('Open Order'), 'Close Order': form('Close Order'),
  Scattered: form('Scattered'), Hero: form('Hero'),
};
const groups: Record<string, AllianceGroup> = { blue: 'friendly', red: 'enemy' };
const ctxOf = (routed: Unit, units: Unit[], attacker: Unit | null = null, rnd = () => 0) => ({
  routed, units, alliances: groups, formationsMap: forms, attacker, rnd,
});

// HEX_DIRS: 0:(1,0) 1:(0,1) 2:(-1,1) 3:(-1,0) 4:(0,-1) 5:(1,-1)
// Attacker at (3,0) → dir 0 → away = dir 3 = (-1,0). Flanks = dirs 5(1,-1),1(0,1).
// Fronts = dirs 2(-1,1),4(0,-1).

describe('routRetreatPath — away axis', () => {
  it('retreats directly away from an attacker (dir 4) when empty', () => {
    const routed = unit('r', 'blue', h(0, 0), { currentFormation: 'Routed' });
    const attacker = unit('a', 'red', h(3, 0));
    const res = routRetreatPath(ctxOf(routed, [routed, attacker], attacker));
    expect(res.dest).toEqual(h(-1, 0));
  });

  it('without an attacker, retreats away from the nearest hostile', () => {
    const routed = unit('r', 'blue', h(0, 0), { currentFormation: 'Routed' });
    const enemy = unit('e', 'red', h(1, 0)); // adjacent → away = opposite (dir 3)
    const res = routRetreatPath(ctxOf(routed, [routed, enemy]));
    expect(res.dest).toEqual(h(-1, 0));
  });
});

describe('routRetreatPath — away blocked, away-side flanks (3/5) first', () => {
  it('when away is blocked, prefers an AWAY-side flank not adjacent to a hostile', () => {
    const routed = unit('r', 'blue', h(0, 0), { currentFormation: 'Routed' });
    const attacker = unit('a', 'red', h(3, 0)); // away = dir 3 = (-1,0)
    const blocker = unit('b', 'blue', h(-1, 0), { currentFormation: 'Close Order' }); // blocks away
    const extra = unit('e2', 'red', h(0, -2)); // adjacent to the away-side flank (0,-1) only
    const res = routRetreatPath(ctxOf(routed, [routed, attacker, blocker, extra], attacker));
    // Away-side flanks (0,-1) [1 hostile adjacent] and (-1,1) [0] → (-1,1).
    expect(res.dest).toEqual(h(-1, 1));
  });
});

describe('routRetreatPath — attacker directly above (same hex)', () => {
  it('does not force east — falls through to a random direction', () => {
    const routed = unit('r', 'blue', h(0, 0), { currentFormation: 'Routed' });
    const attacker = unit('a', 'red', h(0, 0), { facing: 3 }); // same hex; ZoC = its front-2
    const res = routRetreatPath(ctxOf(routed, [routed, attacker], attacker, () => 0.75));
    // Fallback axis = dir 4 = (0,-1) (north), empty/safe → north.
    expect(res.dest).toEqual(h(0, -1));
    expect(res.dest).not.toEqual(h(1, 0)); // was always east
  });

  it('uses the swoop launch hex (attackerFrom) as the away axis', () => {
    const routed = unit('r', 'blue', h(0, 0), { currentFormation: 'Routed' });
    const attacker = unit('a', 'red', h(0, 0), { facing: 0 }); // now shares the hex
    const res = routRetreatPath({ ...ctxOf(routed, [routed, attacker], attacker), attackerFrom: h(3, 0) });
    // Away = opposite the east launch hex → west (-1,0).
    expect(res.dest).toEqual(h(-1, 0));
  });

  it('same-hex attacker + another hostile elsewhere → random (not east)', () => {
    const routed = unit('r', 'blue', h(0, 0), { currentFormation: 'Routed' });
    const attacker = unit('a', 'red', h(0, 0), { facing: 3 }); // directly above
    const other = unit('e', 'red', h(3, 0)); // another hostile east — must NOT force east
    const res = routRetreatPath(ctxOf(routed, [routed, attacker, other], attacker, () => 0.75));
    expect(res.dest).toEqual(h(0, -1)); // random dir 4 (north)
    expect(res.dest).not.toEqual(h(1, 0));
  });
});

describe('routRetreatPath — hostile mass', () => {
  it('retreats away from the centroid, not east', () => {
    const routed = unit('r', 'blue', h(0, 0), { currentFormation: 'Routed' });
    const e1 = unit('e1', 'red', h(0, -3));
    const e2 = unit('e2', 'red', h(1, -3)); // both distance 3 → mass axis
    const res = routRetreatPath(ctxOf(routed, [routed, e1, e2]));
    // Centroid (0.5,-3) → away is south-west (-1,1), not east (1,0).
    expect(res.dest).toEqual(h(-1, 1));
    expect(res.dest).not.toEqual(h(1, 0));
  });
});

describe('routRetreatPath — pass through friendlies', () => {
  // Block the flanks (3/5) and fronts (2/6) so the ONLY route is through the
  // away-direction friendly (4). Attacker at (3,0) → away = (-1,0).
  const blocks = () => [h(1, -1), h(0, 1), h(-1, 1), h(0, -1)].map((hex, i) =>
    unit(`c${i}`, 'blue', hex, { currentFormation: 'Close Order' }));

  it('pushes through a friendly Open Order (scattering it) to the gap beyond', () => {
    const routed = unit('r', 'blue', h(0, 0), { currentFormation: 'Routed' });
    const attacker = unit('a', 'red', h(3, 0));
    const open = unit('o', 'blue', h(-1, 0), { currentFormation: 'Open Order' });
    const res = routRetreatPath(ctxOf(routed, [routed, attacker, open, ...blocks()], attacker));
    expect(res.dest).toEqual(h(-2, 0));
    expect(res.scatters).toEqual(['o']);
    expect(res.through).toEqual(['o']);
    expect(res.path).toEqual([h(-1, 0)]);
  });

  it('a Scattered friendly is pushed through without disruption', () => {
    const routed = unit('r', 'blue', h(0, 0), { currentFormation: 'Routed' });
    const attacker = unit('a', 'red', h(3, 0));
    const sc = unit('s', 'blue', h(-1, 0), { currentFormation: 'Scattered' });
    const res = routRetreatPath(ctxOf(routed, [routed, attacker, sc, ...blocks()], attacker));
    expect(res.dest).toEqual(h(-2, 0));
    expect(res.scatters).toEqual([]);
    expect(res.through).toEqual(['s']);
  });

  it('routed friendlies YIELD (pass), and heroes pass', () => {
    const routed = unit('r', 'blue', h(0, 0), { currentFormation: 'Routed' });
    const attacker = unit('a', 'red', h(3, 0));
    const ally = unit('ra', 'blue', h(-1, 0), { currentFormation: 'Routed' });
    const res = routRetreatPath(ctxOf(routed, [routed, attacker, ally, ...blocks()], attacker));
    expect(res.dest).toEqual(h(-2, 0));
    expect(res.through).toEqual(['ra']);
  });

  it('a Close Order friendly blocks (cannot push through ordered ranks)', () => {
    const routed = unit('r', 'blue', h(0, 0), { currentFormation: 'Routed' });
    const attacker = unit('a', 'red', h(3, 0));
    // Block the five candidate directions with Close Order units.
    const walls = [h(-1, 0), h(1, -1), h(0, 1), h(-1, 1), h(0, -1)].map((hex, i) =>
      unit(`w${i}`, 'blue', hex, { currentFormation: 'Close Order' }));
    const res = routRetreatPath(ctxOf(routed, [routed, attacker, ...walls], attacker));
    expect(res.dest).toBeNull();
    expect(res.reason).toBeTruthy();
  });
});

describe('routRetreatPath — enemy kill zone blocks', () => {
  it('does not route into an enemy kill-zone hex', () => {
    const routed = unit('r', 'blue', h(0, 0), { currentFormation: 'Routed' });
    const enemy = unit('e', 'red', h(-1, 0), { facing: 3 }); // dominates its front-2
    const ctx = ctxOf(routed, [routed, enemy]);
    const kill = enemyKillZone(ctx);
    // Sanity: enemy dominates at least one hex (its front-2).
    expect(kill.size).toBeGreaterThan(0);
    const res = routRetreatPath(ctx);
    if (res.dest) expect(kill.has(`${res.dest.q},${res.dest.r}`)).toBe(false);
  });
});

describe('getOrganizationLevel sanity (formation names used above)', () => {
  it('Open=1, Close=2, Scattered/Routed/Hero=0', () => {
    expect(getOrganizationLevel('Open Order')).toBe(1);
    expect(getOrganizationLevel('Close Order')).toBe(2);
    expect(getOrganizationLevel('Scattered')).toBe(0);
    expect(getOrganizationLevel('Routed')).toBe(0);
    expect(getOrganizationLevel('Hero')).toBe(0);
  });
});
