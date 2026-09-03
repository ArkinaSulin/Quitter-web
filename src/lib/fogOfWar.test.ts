import { describe, it, expect } from 'vitest';
import { AllianceGroup } from '@/types/gameProtocol';
import { computeVisibleHexes, computeFog, DEFAULT_SIGHT_RADIUS, hexKey, unitSightRadius, FOG_RING_ALPHAS } from './fogOfWar';

const h = (q: number, r: number) => ({ q, r, s: -q - r });

const unit = (id: string, team: string, hex: { q: number; r: number; s: number }, overrides: Partial<any> = {}) => ({
  id, team, hex, isDeleted: false, hidden: false, currentUnitHp: 10, darkvision: 0, ...overrides,
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

  it('hidden units exert no darkvision — they reveal nothing', () => {
    const hiddenScout = unit('s', 'blue', h(5, 0), { hidden: true, darkvision: 4 });
    const visible = computeVisibleHexes([hiddenScout], 'friendly', groups, DEFAULT_SIGHT_RADIUS);
    expect(visible.size).toBe(0); // not even its own hex
  });

  it('hidden allies do not add to the shared reveal (only visible units count)', () => {
    const ally = unit('a', 'blue', h(0, 0));
    const hiddenScout = unit('s', 'blue', h(5, 0), { hidden: true, darkvision: 4 });
    const visible = computeVisibleHexes([ally, hiddenScout], 'friendly', groups, DEFAULT_SIGHT_RADIUS);
    expect(visible.has(hexKey(h(2, 0)))).toBe(true);  // visible ally's sight
    expect(visible.has(hexKey(h(5, 0)))).toBe(false); // hidden scout's area stays dark
    expect(visible.has(hexKey(h(7, 0)))).toBe(false);
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

  it('edge-anchored gradient at sight 2: edge 0.45, ring-1 0.30, own hex crisp', () => {
    const watcher = unit('a', 'blue', h(0, 0)); // base sight 2
    const fog = computeFog([watcher], 'friendly', groups, DEFAULT_SIGHT_RADIUS);
    expect(fog.dim.has(hexKey(h(0, 0)))).toBe(false); // crisp
    expect(fog.dim.get(hexKey(h(1, 0)))).toBe(FOG_RING_ALPHAS[1]); // 0.30
    expect(fog.dim.get(hexKey(h(2, 0)))).toBe(FOG_RING_ALPHAS[0]); // 0.45
    // Beyond sight: revealed nowhere, so absent from both structures.
    expect(fog.reveal.has(hexKey(h(3, 0)))).toBe(false);
    expect(fog.dim.has(hexKey(h(3, 0)))).toBe(false);
  });

  it('a sight-1 unit dims its adjacent hex 0.45 and keeps its own hex crisp', () => {
    const watcher = unit('a', 'blue', h(0, 0));
    const fog = computeFog([watcher], 'friendly', groups, 1);
    expect(fog.dim.get(hexKey(h(0, 0)))).toBe(undefined); // crisp
    expect(fog.dim.get(hexKey(h(1, 0)))).toBe(FOG_RING_ALPHAS[0]); // adjacent hex 0.45
  });

  it('sight 3 (darkvision 3) matches the authored example: 0.45 / 0.30 / 0.15', () => {
    const watcher = unit('a', 'blue', h(0, 0), { darkvision: 3 });
    const fog = computeFog([watcher], 'friendly', groups, DEFAULT_SIGHT_RADIUS);
    expect(fog.dim.get(hexKey(h(3, 0)))).toBe(0.45); // 3 hex away
    expect(fog.dim.get(hexKey(h(2, 0)))).toBe(0.30); // 2 hex away
    expect(fog.dim.get(hexKey(h(1, 0)))).toBe(0.15); // 1 hex away
    expect(fog.dim.has(hexKey(h(0, 0)))).toBe(false); // own hex crisp
  });

  it('the dim band stays ≤3 rings deep for long darkvision', () => {
    const watcher = unit('a', 'blue', h(0, 0), { darkvision: 6 });
    const fog = computeFog([watcher], 'friendly', groups, DEFAULT_SIGHT_RADIUS);
    expect(fog.dim.get(hexKey(h(6, 0)))).toBe(0.45); // edge
    expect(fog.dim.get(hexKey(h(5, 0)))).toBe(0.30);
    expect(fog.dim.get(hexKey(h(4, 0)))).toBe(0.15);
    expect(fog.dim.has(hexKey(h(3, 0)))).toBe(false); // deeper than 3 rings: crisp
    expect(fog.dim.has(hexKey(h(1, 0)))).toBe(false);
    expect(fog.dim.has(hexKey(h(0, 0)))).toBe(false);
  });

  it('darkvision extends the graded edge outward', () => {
    const watcher = unit('a', 'blue', h(0, 0), { darkvision: 4 });
    const fog = computeFog([watcher], 'friendly', groups, DEFAULT_SIGHT_RADIUS);
    expect(fog.dim.get(hexKey(h(4, 0)))).toBe(0.45); // d == 4 == sight
    expect(fog.dim.get(hexKey(h(3, 0)))).toBe(0.30); // d == 3 == sight-1
    expect(fog.dim.get(hexKey(h(2, 0)))).toBe(0.15); // d == 2 == sight-2
    expect(fog.dim.has(hexKey(h(1, 0)))).toBe(false); // 3+ rings in: crisp
  });

  it('clearest coverage wins when two units overlap (a unit on the hex clears its dim)', () => {
    const a = unit('a', 'blue', h(0, 0)); // sight 2
    const b = unit('b', 'blue', h(2, 0)); // sight 2, standing where a's outer ring dims
    const fog = computeFog([a, b], 'friendly', groups, DEFAULT_SIGHT_RADIUS);
    // Hex (2,0): a's edge ring would dim it 0.45, but b OWNS the hex -> crisp wins.
    expect(fog.reveal.has(hexKey(h(2, 0)))).toBe(true);
    expect(fog.dim.has(hexKey(h(2, 0)))).toBe(false);
    // Hex (4,0): a sees nothing (d 4); b's edge ring (d 2) dims it 0.45.
    expect(fog.dim.get(hexKey(h(4, 0)))).toBe(0.45);
    expect(fog.reveal.has(hexKey(h(4, 0)))).toBe(true);
  });

  it('clearest wins between 0.45 and 0.30 rings of overlapping units', () => {
    // a at origin (sight 2): hex (2,0) is its edge -> 0.45.
    // b at (3,0) sight 2: (2,0) is ring-1 (0.30) -> b's clearer cover wins.
    const a = unit('a', 'blue', h(0, 0));
    const b = unit('b', 'blue', h(3, 0));
    const fog = computeFog([a, b], 'friendly', groups, DEFAULT_SIGHT_RADIUS);
    expect(fog.reveal.has(hexKey(h(2, 0)))).toBe(true);
    expect(fog.dim.get(hexKey(h(2, 0)))).toBe(0.30);
  });

  it('hidden units exert no darkvision (their whole area stays dark)', () => {
    const hiddenScout = unit('s', 'blue', h(0, 0), { hidden: true, darkvision: 4 });
    const fog = computeFog([hiddenScout], 'friendly', groups, DEFAULT_SIGHT_RADIUS);
    expect(fog.reveal.size).toBe(0);
    expect(fog.dim.size).toBe(0);
  });

  it('enemy units reveal nothing and deleted units reveal nothing', () => {
    const enemy = unit('e', 'red', h(0, 0));
    const deadAlly = unit('d', 'blue', h(2, 0), { isDeleted: true });
    const fog = computeFog([enemy, deadAlly], 'friendly', groups, DEFAULT_SIGHT_RADIUS);
    expect(fog.reveal.size).toBe(0);
    expect(fog.dim.size).toBe(0);
  });
});
