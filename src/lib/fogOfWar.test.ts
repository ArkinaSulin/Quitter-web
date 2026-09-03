import { describe, it, expect } from 'vitest';
import { AllianceGroup } from '@/types/gameProtocol';
import { computeVisibleHexes, computeFog, DEFAULT_SIGHT_RADIUS, hexKey, unitSightRadius, FOG_OUTER_RING_ALPHA, FOG_INNER_RING_ALPHA } from './fogOfWar';

const h = (q: number, r: number) => ({ q, r, s: -q - r });

const unit = (id: string, team: string, hex: { q: number; r: number; s: number }, overrides: Partial<any> = {}) => ({
  id, team, hex, isDeleted: false, currentUnitHp: 10, darkvision: 0, ...overrides,
});

describe('unitSightRadius', () => {
  it('defaults to the scenario base and honors darkvision (max)', () => {
    expect(unitSightRadius({ darkvision: 0 }, DEFAULT_SIGHT_RADIUS)).toBe(2);
    expect(unitSightRadius({ darkvision: 4 }, DEFAULT_SIGHT_RADIUS)).toBe(4); // darkvision wins
    expect(unitSightRadius({ darkvision: 1 }, DEFAULT_SIGHT_RADIUS)).toBe(2); // below base -> base
    expect(unitSightRadius({ darkvision: 0 }, 5)).toBe(5);
  });
});

describe('computeVisibleHexes', () => {
  // alliances maps TEAM -> group (blue team is the friendly alliance, red is enemy).
  const groups: Record<string, AllianceGroup> = { blue: 'friendly', red: 'enemy' };

  it('reveals within the base radius around the viewer alliance only', () => {
    const ally = unit('a', 'blue', h(0, 0)); // friendly group
    const enemyNear = unit('e', 'red', h(1, 0)); // enemy group, inside sight but not revealed
    const visible = computeVisibleHexes([ally, enemyNear], 'friendly', groups, 2);
    expect(visible.has(hexKey(h(0, 0)))).toBe(true);   // own hex
    expect(visible.has(hexKey(h(1, 0)))).toBe(true);   // ally sees its ring 1 (enemy hex revealed as terrain/unit)
    expect(visible.has(hexKey(h(2, 0)))).toBe(true);   // ring 2
    expect(visible.has(hexKey(h(3, 0)))).toBe(false);  // beyond
  });

  it('does not reveal around enemy units', () => {
    const farEnemy = unit('e', 'red', h(6, 0));
    const visible = computeVisibleHexes([farEnemy], 'friendly', groups, 2);
    expect(visible.size).toBe(0);
  });

  it('darkvision unit sees further', () => {
    const watcher = unit('a', 'blue', h(0, 0), { darkvision: 4 });
    const visible = computeVisibleHexes([watcher], 'friendly', groups, DEFAULT_SIGHT_RADIUS);
    expect(visible.has(hexKey(h(4, 0)))).toBe(true);
    expect(visible.has(hexKey(h(5, 0)))).toBe(false);
  });

  it('radius excludes nothing at distance 0 but own hex is always visible', () => {
    const u = unit('a', 'blue', h(0, 0), { darkvision: 1 });
    const visible = computeVisibleHexes([u], 'friendly', groups, 2);
    // base 2 still applies (max(2,1)=2), so ring 2 is visible
    expect(visible.has(hexKey(h(0, 2)))).toBe(true);
  });

  it('deleted units reveal nothing', () => {
    const dead = unit('a', 'blue', h(0, 0), { isDeleted: true });
    const visible = computeVisibleHexes([dead], 'friendly', groups, DEFAULT_SIGHT_RADIUS);
    expect(visible.size).toBe(0);
  });
});

describe('computeFog', () => {
  const groups: Record<string, AllianceGroup> = { blue: 'friendly', red: 'enemy' };

  it('reveals the same hexes as computeVisibleHexes', () => {
    const ally = unit('a', 'blue', h(0, 0), { darkvision: 4 });
    const fog = computeFog([ally], 'friendly', groups, DEFAULT_SIGHT_RADIUS);
    const visible = computeVisibleHexes([ally], 'friendly', groups, DEFAULT_SIGHT_RADIUS);
    expect(fog.reveal.size).toBe(visible.size);
    expect(fog.reveal).toEqual(visible);
  });

  it('graded rings: outer sight ring 0.6, next-in 0.3, inner crisp, unseen absent', () => {
    const watcher = unit('a', 'blue', h(0, 0)); // base sight 2
    const fog = computeFog([watcher], 'friendly', groups, DEFAULT_SIGHT_RADIUS);
    // Own hex is crisp (not in dim); ring 1 (d == sight-1) dims 0.3; ring 2 (d == sight) 0.6.
    expect(fog.dim.has(hexKey(h(0, 0)))).toBe(false);
    expect(fog.dim.get(hexKey(h(1, 0)))).toBe(FOG_INNER_RING_ALPHA);
    expect(fog.dim.get(hexKey(h(2, 0)))).toBe(FOG_OUTER_RING_ALPHA);
    // Beyond sight: revealed nowhere, so absent from both structures.
    expect(fog.reveal.has(hexKey(h(3, 0)))).toBe(false);
    expect(fog.dim.has(hexKey(h(3, 0)))).toBe(false);
  });

  it('a single sight-1 unit dims ring 1 (its outer ring) and keeps its own hex crisp', () => {
    // Sight is max(base 2, darkvision 1) = 2, so use a smaller base to force r=1.
    const watcher = unit('a', 'blue', h(0, 0));
    const fog = computeFog([watcher], 'friendly', groups, 1);
    expect(fog.dim.get(hexKey(h(0, 0)))).toBe(undefined); // crisp
    expect(fog.dim.get(hexKey(h(1, 0)))).toBe(FOG_OUTER_RING_ALPHA); // r=1 -> outer ring is ring 1
  });

  it('darkvision extends the graded edge outward', () => {
    const watcher = unit('a', 'blue', h(0, 0), { darkvision: 4 });
    const fog = computeFog([watcher], 'friendly', groups, DEFAULT_SIGHT_RADIUS);
    expect(fog.dim.get(hexKey(h(4, 0)))).toBe(FOG_OUTER_RING_ALPHA); // d == 4 == sight
    expect(fog.dim.get(hexKey(h(3, 0)))).toBe(FOG_INNER_RING_ALPHA); // d == 3 == sight-1
    expect(fog.dim.has(hexKey(h(2, 0)))).toBe(false); // crisp
  });

  it('clearest coverage wins when two units overlap (a unit on the hex clears its dim)', () => {
    const a = unit('a', 'blue', h(0, 0)); // sight 2
    const b = unit('b', 'blue', h(2, 0)); // sight 2, standing where a's outer ring dims
    const fog = computeFog([a, b], 'friendly', groups, DEFAULT_SIGHT_RADIUS);
    // Hex (2,0): a's outer ring would dim it 0.6, but b OWNS the hex -> crisp wins.
    expect(fog.reveal.has(hexKey(h(2, 0)))).toBe(true);
    expect(fog.dim.has(hexKey(h(2, 0)))).toBe(false);
    // Hex (4,0): a sees nothing (d 4); b's outer ring (d 2) dims it 0.6.
    expect(fog.dim.get(hexKey(h(4, 0)))).toBe(FOG_OUTER_RING_ALPHA);
    expect(fog.reveal.has(hexKey(h(4, 0)))).toBe(true);
  });

  it('clearest wins between 0.6 and 0.3 rings of overlapping units', () => {
    // a at origin (sight 2): hex (2,0) is its outer ring -> 0.6.
    // b at (2,2) with sight 2: distance to (2,0) = 2 -> also outer ring 0.6. same.
    // Instead overlap a 0.6 ring with a 0.3 ring: b at (3,0) sight 2 -> (2,0) is ring-1 -> 0.3.
    const a = unit('a', 'blue', h(0, 0));
    const b = unit('b', 'blue', h(3, 0));
    const fog = computeFog([a, b], 'friendly', groups, DEFAULT_SIGHT_RADIUS);
    expect(fog.reveal.has(hexKey(h(2, 0)))).toBe(true);
    expect(fog.dim.get(hexKey(h(2, 0)))).toBe(FOG_INNER_RING_ALPHA); // 0.3 from b beats 0.6 from a
  });

  it('enemy units reveal nothing and deleted units reveal nothing', () => {
    const enemy = unit('e', 'red', h(0, 0));
    const deadAlly = unit('d', 'blue', h(2, 0), { isDeleted: true });
    const fog = computeFog([enemy, deadAlly], 'friendly', groups, DEFAULT_SIGHT_RADIUS);
    expect(fog.reveal.size).toBe(0);
    expect(fog.dim.size).toBe(0);
  });
});
