import { describe, it, expect } from 'vitest';
import { mapMapRow, mapEntityToRow } from '@/packages/world/lib/mapEntities';

describe('mapEntities mappers', () => {
  it('parses a snake_case row into a MapEntity', () => {
    const row = {
      id: 'm1',
      name: 'Castle Grounds',
      description: 'a',
      image_url: 'https://x/map.png',
      offset_x: 2, offset_y: -3, scale: 1.5, grid_radius: 10,
      structures: { '0,0,0': { templateId: 'wall-wood', outside: 'b' }, '2,-1': { templateId: 'tower' }, 'bad': { templateId: 'x' } },
      hex_effects: [{ q: 0, r: 0, effectId: 'burn' }],
      created_at: '2026-01-01', updated_at: '2026-01-02',
    };
    const m = mapMapRow(row);
    expect(m.id).toBe('m1');
    expect(m.imageUrl).toBe('https://x/map.png');
    expect(m.scale).toBe(1.5);
    expect(m.structures).toEqual({ '0,0,0': { templateId: 'wall-wood', outside: 'b' }, '2,-1': { templateId: 'tower' } }); // invalid keys dropped
    expect(m.hexEffects).toEqual([{ q: 0, r: 0, effectId: 'burn' }]);
  });

  it('round-trips an entity to a row', () => {
    const row = mapEntityToRow({
      id: 'm1', name: 'x', description: '', imageUrl: '', offsetX: 0, offsetY: 0,
      scale: 1, gridRadius: 12, structures: { '0,0,0': { templateId: 'wall' } }, hexEffects: [],
      createdAt: '', updatedAt: '',
    }, 'user-1');
    expect(row).toMatchObject({
      name: 'x',
      grid_radius: 12,
      structures: { '0,0,0': { templateId: 'wall' } },
      created_by: 'user-1',
    });
  });
});
