import { describe, it, expect } from 'vitest';
import { allianceOf, isHostile, sameAlliance } from './alliances';
import { AllianceGroup } from '@/types/gameProtocol';

const A: Record<string, AllianceGroup> = { blue: 'friendly', red: 'enemy', green: 'neutral' };

describe('alliances', () => {
  it('allianceOf resolves a team group (default friendly)', () => {
    expect(allianceOf('blue', A)).toBe('friendly');
    expect(allianceOf('red', A)).toBe('enemy');
    expect(allianceOf('green', A)).toBe('neutral');
    expect(allianceOf('ghost', A)).toBe('friendly');
    expect(allianceOf(null, A)).toBe('friendly');
    expect(allianceOf(undefined, A)).toBe('friendly');
  });

  it('isHostile: every cross-group is hostile; same-group (incl. neutral↔neutral) is not', () => {
    expect(isHostile('blue', 'red', A)).toBe(true);
    expect(isHostile('blue', 'green', A)).toBe(true);
    expect(isHostile('red', 'green', A)).toBe(true);
    expect(isHostile('blue', 'blue', A)).toBe(false);
    expect(isHostile('green', 'green', A)).toBe(false);
  });

  it('sameAlliance is the inverse of isHostile', () => {
    expect(sameAlliance('blue', 'blue', A)).toBe(true);
    expect(sameAlliance('blue', 'red', A)).toBe(false);
  });
});
