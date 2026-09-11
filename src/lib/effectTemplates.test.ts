import { describe, it, expect } from 'vitest';
import { mapEffectRow, mapEffectToRow, blankEffectTemplate } from './effectTemplates';

describe('effectTemplates mappers', () => {
  it('maps a row including image scale + transparent background', () => {
    const t = mapEffectRow({
      id: 'e1', name: 'Fog', description: '', color: '#888888', image_url: 'u',
      image_scale: 180, transparent_background: true, layer: 'above',
      scope: 'zone', default_duration: 4, modifiers: [], created_at: '', updated_at: '',
    });
    expect(t.imageUrl).toBe('u');
    expect(t.imageScale).toBe(180);
    expect(t.transparentBackground).toBe(true);
    expect(t.layer).toBe('above');
    expect(t.scope).toBe('zone');
  });

  it('defaults image scale to 100 and transparent background to false', () => {
    const t = mapEffectRow({ id: 'e2', name: 'X', modifiers: [] });
    expect(t.imageScale).toBe(100);
    expect(t.transparentBackground).toBe(false);
  });

  it('writes image_scale (rounded) and transparent_background', () => {
    const row = mapEffectToRow({ ...blankEffectTemplate(), imageScale: 133.7, transparentBackground: true });
    expect(row.image_scale).toBe(134);
    expect(row.transparent_background).toBe(true);
  });
});
