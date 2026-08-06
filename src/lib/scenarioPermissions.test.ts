import { describe, it, expect } from 'vitest';
import { AllianceGroup } from '@/types/gameProtocol';
import {
  getRoleCapabilities,
  scopeContainsTeam,
  canMoveUnit,
  canAdjustUnit,
  emptyCapabilities,
  allTrueCapabilities,
} from './scenarioPermissions';

const alliances: Record<string, AllianceGroup> = {
  blue: 'friendly',
  green: 'friendly',
  red: 'enemy',
};

const caps = (partial: Partial<ReturnType<typeof emptyCapabilities>>) => ({
  ...emptyCapabilities(),
  ...partial,
});

describe('getRoleCapabilities', () => {
  it('grants everything to the GM and unknown/null roles get nothing', () => {
    expect(getRoleCapabilities('GM', {}).move_any_team).toBe(true);
    expect(getRoleCapabilities('GM', {}).kick_player).toBe(true);
    expect(getRoleCapabilities(null, {})).toEqual(emptyCapabilities());
    expect(getRoleCapabilities('MysteryRole' as any, {})).toEqual(emptyCapabilities());
  });

  it('resolves a seeded role from the matrix', () => {
    const matrix = { Player: caps({ move_own_team: true }) };
    expect(getRoleCapabilities('Player', matrix).move_own_team).toBe(true);
    expect(getRoleCapabilities('Player', matrix).move_any_team).toBe(false);
  });

  it('unknown roles fall back to empty even when GM is present', () => {
    const matrix = { Player: allTrueCapabilities() };
    expect(getRoleCapabilities('SuperPlayer', matrix).move_own_team).toBe(false);
  });
});

describe('scopeContainsTeam', () => {
  it('any_team includes every team even for unassigned players', () => {
    expect(scopeContainsTeam('any_team', null, 'blue', alliances)).toBe(true);
  });

  it('own_team requires an exact team match and an assigned player', () => {
    expect(scopeContainsTeam('own_team', 'blue', 'blue', alliances)).toBe(true);
    expect(scopeContainsTeam('own_team', 'blue', 'green', alliances)).toBe(false);
    expect(scopeContainsTeam('own_team', null, 'blue', alliances)).toBe(false);
  });

  it('own_alliance matches alliance groups, not team identity', () => {
    expect(scopeContainsTeam('own_alliance', 'blue', 'green', alliances)).toBe(true);
    expect(scopeContainsTeam('own_alliance', 'blue', 'red', alliances)).toBe(false);
    expect(scopeContainsTeam('own_alliance', null, 'blue', alliances)).toBe(false);
  });

  it('own_alliance works when the player side is the enemy alliance', () => {
    const enemySide: Record<string, AllianceGroup> = { blue: 'enemy', green: 'enemy', yellow: 'friendly' };
    expect(scopeContainsTeam('own_alliance', 'blue', 'green', enemySide)).toBe(true);
    expect(scopeContainsTeam('own_alliance', 'blue', 'yellow', enemySide)).toBe(false);
  });

  it('own_alliance works in the neutral alliance', () => {
    const neutralSide: Record<string, AllianceGroup> = { blue: 'neutral', green: 'neutral', yellow: 'friendly' };
    expect(scopeContainsTeam('own_alliance', 'blue', 'green', neutralSide)).toBe(true);
    expect(scopeContainsTeam('own_alliance', 'blue', 'yellow', neutralSide)).toBe(false);
  });
});

describe('canMoveUnit / canAdjustUnit', () => {
  const moveOwn = caps({ move_own_team: true });
  const moveAlliance = caps({ move_own_alliance: true });
  const moveAny = caps({ move_any_team: true });
  const adjustOwn = caps({ adjust_team_stats: true });
  const adjustAny = caps({ adjust_all_stats: true });

  it('move_own_team gates to exactly the player team', () => {
    expect(canMoveUnit(moveOwn, 'blue', 'blue', alliances)).toBe(true);
    expect(canMoveUnit(moveOwn, 'blue', 'green', alliances)).toBe(false);
    expect(canMoveUnit(moveOwn, null, 'blue', alliances)).toBe(false);
  });

  it('move_own_alliance covers same-alliance teams but not enemies', () => {
    expect(canMoveUnit(moveAlliance, 'blue', 'green', alliances)).toBe(true);
    expect(canMoveUnit(moveAlliance, 'blue', 'red', alliances)).toBe(false);
  });

  it('move_any_team works even when the player is unassigned', () => {
    expect(canMoveUnit(moveAny, null, 'red', alliances)).toBe(true);
  });

  it('a bare move_own_alliance cannot move own team only by alliance identity', () => {
    // blue's alliance is friendly and blue is in it — still covered.
    expect(canMoveUnit(moveAlliance, 'blue', 'blue', alliances)).toBe(true);
  });

  it('unassigned players are read-only (no move/adjust scope)', () => {
    expect(canMoveUnit(moveOwn, null, 'blue', alliances)).toBe(false);
    expect(canAdjustUnit(adjustOwn, null, 'blue', alliances)).toBe(false);
  });

  it('adjust_* mirrors move scoping', () => {
    expect(canAdjustUnit(adjustOwn, 'blue', 'blue', alliances)).toBe(true);
    expect(canAdjustUnit(adjustOwn, 'blue', 'green', alliances)).toBe(false);
    expect(canAdjustUnit(adjustAny, null, 'red', alliances)).toBe(true);
  });

  it('all-true caps (GM) pass every check', () => {
    const all = allTrueCapabilities();
    expect(canMoveUnit(all, null, 'red', alliances)).toBe(true);
    expect(canAdjustUnit(all, null, 'blue', alliances)).toBe(true);
  });
});
