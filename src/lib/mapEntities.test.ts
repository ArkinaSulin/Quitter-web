import { describe, it, expect } from 'vitest';
import { mapMapRow, mapEntityToRow, parseTerrainCosts } from './mapEntities';

describe('mapEntities mappers', () => {
  it('parses a snake_case row into a MapEntity', () => {
    const row = {
      id: 'm1',
      name: 'Castle Grounds',
      description: 'a',
      image_url: 'https://x/map.png',
      offset_x: 2, offset_y: -3, scale: 1.5, grid_radius: 10,
      terrain_costs: { '0,-1': 2, '1,1': 0, 'bad': 5, 'x,y': 3 },
      hex_effects: [{ q: 0, r: 0, effectId: 'burn' }],
      created_at: '2026-01-01', updated_at: '2026-01-02',
    };
    const m = mapMapRow(row);
    expect(m.id).toBe('m1');
    expect(m.imageUrl).toBe('https://x/map.png');
    expect(m.scale).toBe(1.5);
    expect(m.terrainCosts).toEqual({ '0,-1': 2, '1,1': 0 }); // invalid keys dropped
    expect(m.hexEffects).toEqual([{ q: 0, r: 0, effectId: 'burn' }]);
  });

  it('drops out-of-range terrain costs during parsing', () => {
    expect(parseTerrainCosts({ '0,0': 9, '1,0': 10, '2,0': -1, '3,0': 2.6 })).toEqual({ '0,0': 9, '3,0': 3 });
  });

  it('round-trips an entity to a row', () => {
    const row = mapEntityToRow({
      id: 'm1', name: 'x', description: '', imageUrl: '', offsetX: 0, offsetY: 0,
      scale: 1, gridRadius: 12, terrainCosts: { '0,-1': 2 }, hexEffects: [],
      createdAt: '', updatedAt: '',
    }, 'user-1');
    expect(row).toMatchObject({
      name: 'x',
      grid_radius: 12,
      terrain_costs: { '0,-1': 2 },
      created_by: 'user-1',
    });
  });
});
