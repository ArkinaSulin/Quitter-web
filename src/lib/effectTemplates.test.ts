import { describe, it, expect } from 'vitest';
import { mapEffectRow, mapEffectToRow, blankEffectTemplate, parseModifiers, modifierSummary } from './effectTemplates';

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

describe('modifierSummary', () => {
  it('signs amounts and never prints a bogus mode for range', () => {
    expect(modifierSummary({ kind: 'range', dice: '2' })).toBe('range +2');
    expect(modifierSummary({ kind: 'range', dice: '-1' })).toBe('range -1');
    // a stray mode on a non-mode kind is ignored
    expect(modifierSummary({ kind: 'range', dice: '2', mode: 'melee' } as any)).toBe('range +2');
  });

  it('shows mode only for mode-honouring kinds', () => {
    expect(modifierSummary({ kind: 'ac', dice: '2', mode: 'melee' })).toBe('ac (melee) +2');
    expect(modifierSummary({ kind: 'advantage' })).toBe('advantage');
    expect(modifierSummary({ kind: 'block_attacks', mode: 'ranged', direction: 'in' })).toBe('block_attacks (ranged) /in');
  });

  it('renders the enter_org_max gate as a cap and keeps heal', () => {
    expect(modifierSummary({ kind: 'enter_org_max', dice: '1' })).toBe('enter_org_max ≤1');
    expect(modifierSummary({ kind: 'dot', dice: '1d6', healing: true })).toBe('dot 1d6 heal');
  });
});

describe('parseModifiers — block_attacks', () => {
  it('keeps mode and direction sub-state', () => {
    const [m] = parseModifiers([{ kind: 'block_attacks', mode: 'ranged', direction: 'in' }]);
    expect(m).toEqual({ kind: 'block_attacks', mode: 'ranged', direction: 'in' });
  });

  it('drops junk direction/mode', () => {
    const [m] = parseModifiers([{ kind: 'block_attacks', direction: 'sideways', mode: 'both' }]);
    expect(m).toEqual({ kind: 'block_attacks' });
  });
});
