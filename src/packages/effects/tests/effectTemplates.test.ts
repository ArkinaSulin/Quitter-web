import { describe, it, expect } from 'vitest';
import { mapEffectRow, mapEffectToRow, blankEffectTemplate, parseModifiers, modifierSummary, modifierScopeConflict, modifierUsesSave } from '@/packages/effects/lib/effectTemplates';

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

describe('parseModifiers', () => {
  it('normalizes a legacy numeric `delta` to `dice`', () => {
    const [m] = parseModifiers([{ kind: 'ac', delta: 3 }]);
    expect(m).toEqual({ kind: 'ac', dice: '3' });
  });

  it('turns a NEGATIVE flat dot into a positive healing amount (legacy Regen)', () => {
    const [m] = parseModifiers([{ kind: 'dot', delta: -4 }]);
    expect(m).toEqual({ kind: 'dot', dice: '4', healing: true });
  });

  it('leaves a positive dot and an explicit healing flag untouched', () => {
    expect(parseModifiers([{ kind: 'dot', delta: 4 }])[0]).toEqual({ kind: 'dot', dice: '4' });
    expect(parseModifiers([{ kind: 'dot', dice: '3', healing: true }])[0]).toEqual({ kind: 'dot', dice: '3', healing: true });
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

  it('renders the max_org_level_allowed cap as a cap and keeps heal', () => {
    expect(modifierSummary({ kind: 'max_org_level_allowed', dice: '1' })).toBe('max_org_level_allowed ≤1');
    expect(modifierSummary({ kind: 'dot', dice: '1d6', healing: true })).toBe('dot 1d6 heal');
  });

  it('prints friendly names for movement points and terrain cost', () => {
    expect(modifierSummary({ kind: 'movement', dice: '2' })).toBe('movement points +2');
    expect(modifierSummary({ kind: 'mp_cost', dice: '4' })).toBe('terrain cost +4');
    expect(modifierSummary({ kind: 'save_advantage' })).toBe('save advantage');
    expect(modifierSummary({ kind: 'save_disadvantage' })).toBe('save disadvantage');
    expect(modifierSummary({ kind: 'forced_stop' })).toBe('forced stop');
  });
});

describe('modifierUsesSave', () => {
  it('only dot / entry / hp_borrow take a save (the Save/DC fields)', () => {
    expect(modifierUsesSave('dot')).toBe(true);
    expect(modifierUsesSave('entry')).toBe(true);
    expect(modifierUsesSave('hp_borrow')).toBe(true);
    expect(modifierUsesSave('ac')).toBe(false);
    expect(modifierUsesSave('morale')).toBe(false);
    expect(modifierUsesSave('mp_cost')).toBe(false);
    expect(modifierUsesSave('range')).toBe(false);
    expect(modifierUsesSave('max_org_level_allowed')).toBe(false);
  });
});

describe('modifierScopeConflict', () => {
  it('flags mixing unit-only and zone-only modifiers', () => {
    expect(modifierScopeConflict([{ kind: 'movement', dice: '2' }, { kind: 'mp_cost', dice: '4' }])).toBe(true);
    expect(modifierScopeConflict([{ kind: 'hp_borrow', dice: '2' }, { kind: 'entry', dice: '3' }])).toBe(true);
  });

  it('allows compatible mixes', () => {
    expect(modifierScopeConflict([{ kind: 'ac', dice: '2' }, { kind: 'movement', dice: '2' }])).toBe(false);
    expect(modifierScopeConflict([{ kind: 'mp_cost', dice: '4' }])).toBe(false);
    expect(modifierScopeConflict([])).toBe(false);
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
