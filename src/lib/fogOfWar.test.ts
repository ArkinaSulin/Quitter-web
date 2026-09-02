import { describe, it, expect } from 'vitest';
import { AllianceGroup } from '@/types/gameProtocol';
import { computeVisibleHexes, DEFAULT_SIGHT_RADIUS, hexKey, unitSightRadius } from './fogOfWar';

const h = (q: number, r: number) => ({ q, r, s: -q - r });

const unit = (id: string, team: string, hex: { q: number; r: number; s: number }, overrides: Partial<any> = {}) => ({
  id, team, hex, isDeleted: false, currentUnitHp: 10, nightVision: 0, ...overrides,
});

describe('unitSightRadius', () => {
  it('defaults to the scenario base and honors night vision (max)', () => {
    expect(unitSightRadius({ nightVision: 0 }, DEFAULT_SIGHT_RADIUS)).toBe(2);
    expect(unitSightRadius({ nightVision: 4 }, DEFAULT_SIGHT_RADIUS)).toBe(4); // night vision wins
    expect(unitSightRadius({ nightVision: 1 }, DEFAULT_SIGHT_RADIUS)).toBe(2); // below base -> base
    expect(unitSightRadius({ nightVision: 0 }, 5)).toBe(5);
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

  it('night-vision unit sees further', () => {
    const watcher = unit('a', 'blue', h(0, 0), { nightVision: 4 });
    const visible = computeVisibleHexes([watcher], 'friendly', groups, DEFAULT_SIGHT_RADIUS);
    expect(visible.has(hexKey(h(4, 0)))).toBe(true);
    expect(visible.has(hexKey(h(5, 0)))).toBe(false);
  });

  it('radius excludes nothing at distance 0 but own hex is always visible', () => {
    const u = unit('a', 'blue', h(0, 0), { nightVision: 1 });
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
