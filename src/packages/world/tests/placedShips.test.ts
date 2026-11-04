import { describe, expect, it } from 'vitest';
import { parsePlacedShips } from '@/packages/world';

describe('parsePlacedShips', () => {
  it('normalizes placed ship entries and drops malformed rows', () => {
    const ships = parsePlacedShips([
      { id: 's1', templateId: 't1', name: 'Racer', role: 'Scout', imageUrl: 'x.png', keelLength: 120, imageOffsetY: 5, hex: { q: 2, r: -1 } },
      { id: 'bad', name: 'No hex' },
      null,
    ]);
    expect(ships).toHaveLength(1);
    expect(ships[0]).toMatchObject({
      id: 's1',
      templateId: 't1',
      name: 'Racer',
      role: 'Scout',
      imageUrl: 'x.png',
      keelLength: 120,
      imageOffsetY: 5,
    });
    expect(ships[0].hex).toEqual({ q: 2, r: -1, s: -1 });
  });

  it('returns an empty list for invalid input', () => {
    expect(parsePlacedShips(null)).toEqual([]);
    expect(parsePlacedShips({})).toEqual([]);
  });
});
