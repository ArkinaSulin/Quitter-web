import { describe, it, expect } from 'vitest';
import { structureBadges, edgeStructureVisuals, mapTextStyles, climbLabelText, hexClimbLabels } from './mapFeatureDraw';
import { StructureTemplate, StructureInstance } from '@/types/structure';

const template = (over: Partial<StructureTemplate> = {}): StructureTemplate => ({
  id: 't',
  name: 'Gate Tower',
  description: '',
  anchor: 'hex',
  color: '#ffffff',
  imageUrl: '',
  battlement: false,
  barricade: false,
  sinWave: false,
  ladder: false,
  hexBorder: true,
  mpClimbUp: 4,
  mpClimbDown: 4,
  mpMountedUp: 4,
  mpMountedDown: 4,
  doorHp: null,
  maxHp: 30,
  dt: 15,
  modifiers: [],
  createdAt: '',
  updatedAt: '',
  ...over,
});

describe('structureBadges', () => {
  it('shows the HP number for an intact structure', () => {
    const b = structureBadges(template(), { templateId: 't' });
    expect(b.hpText).toBe('HP: 30');
  });

  it('shows no HP badge at 0 HP (the instance is removed by the caller)', () => {
    const b = structureBadges(template(), { templateId: 't', hp: 0 });
    expect(b.hpText).toBeNull();
  });

  it('shows nothing for a decorative maxHp = 0 structure', () => {
    const b = structureBadges(template({ maxHp: 0 }), { templateId: 't' });
    expect(b.hpText).toBeNull();
    expect(b.doorText).toBeNull();
  });

  it('shows door badges (door N / open / broken)', () => {
    expect(structureBadges(template({ doorHp: 20, maxHp: 30 }), { templateId: 't' }).doorText).toBe('door 20');
    expect(structureBadges(template({ doorHp: 20, maxHp: 30 }), { templateId: 't', open: true }).doorText).toBe('open');
    expect(structureBadges(template({ doorHp: 20, maxHp: 30 }), { templateId: 't', doorHp: 0 }).doorText).toBe('broken');
  });
});

describe('edgeStructureVisuals (shared by scenario + Map Editor)', () => {
  const edge = (over: Partial<StructureTemplate> = {}) => template({ anchor: 'edge', ...over });
  const inst = (over: Partial<StructureInstance> = {}): StructureInstance => ({ templateId: 't', ...over });
  const geom = {
    a: { x: 0, y: 0 },
    b: { x: 100, y: 0 },
    hexA: { x: 50, y: -80 }, // edge face A sits "up"
    hexB: { x: 50, y: 80 },
    surfaceA: 0,
    surfaceB: 0,
  };

  it('a plain edge draws the base wall line only', () => {
    const v = edgeStructureVisuals({ ...geom, template: edge(), instance: inst() });
    expect(v.baseLine).toBe(true);
    expect(v.decorationKind).toBe('none');
    expect(v.decorationPath).toBeNull();
    expect(v.ladder).toBeNull();
  });

  it('a battlement edge draws the base line + a crenellation path', () => {
    const v = edgeStructureVisuals({ ...geom, template: edge({ battlement: true }), instance: inst() });
    expect(v.baseLine).toBe(true);
    expect(v.decorationKind).toBe('battlement');
    expect(v.decorationPath).toBeTruthy();
    expect(v.ladder).toBeNull();
  });

  it('a barricade / sine-wave edge draws no base line', () => {
    expect(edgeStructureVisuals({ ...geom, template: edge({ barricade: true }), instance: inst() }).baseLine).toBe(false);
    expect(edgeStructureVisuals({ ...geom, template: edge({ sinWave: true }), instance: inst() }).baseLine).toBe(false);
  });

  it('a ladder edge draws ONLY the ladder (no base line) and leans toward the higher surface', () => {
    const up = edgeStructureVisuals({ ...geom, surfaceA: 30, surfaceB: 0, template: edge({ ladder: true }), instance: inst() });
    expect(up.baseLine).toBe(false);
    expect(up.decorationPath).toBeNull();
    expect(up.ladder).not.toBeNull();
    // Auto (higher = A) matches an explicit ladderSide 'a', and differs from 'b'.
    const explicitA = edgeStructureVisuals({ ...geom, template: edge({ ladder: true }), instance: inst({ ladderSide: 'a' }) });
    const explicitB = edgeStructureVisuals({ ...geom, template: edge({ ladder: true }), instance: inst({ ladderSide: 'b' }) });
    expect(up.ladder!.rungs).toBe(explicitA.ladder!.rungs);
    expect(up.ladder!.rungs).not.toBe(explicitB.ladder!.rungs);
  });

  it('an ignore_climb modifier alone no longer draws a ladder (structure ignore_climb retired)', () => {
    const v = edgeStructureVisuals({ ...geom, template: edge({ modifiers: [{ kind: 'ignore_climb' }] }), instance: inst() });
    expect(v.ladder).toBeNull();
    expect(v.baseLine).toBe(true);
  });
});

describe('mapTextStyles (single source for all three renderers)', () => {
  it('scales HP and elevation at the SAME 12× rate (the reported bug)', () => {
    const a = mapTextStyles(1);
    const b = mapTextStyles(3);
    expect(b.hp.fontPx - a.hp.fontPx).toBe(24);
    expect(b.elevation.fontPx - a.elevation.fontPx).toBe(24);
    expect(a.hp.fontPx).toBe(Math.max(11, 12));
    expect(a.elevation.fontPx).toBe(Math.max(10, 12));
  });

  it('is world/screen stable: a world font of fontPx/zoom renders at fontPx screen', () => {
    for (const zoom of [0.5, 1, 2, 3]) {
      const ts = mapTextStyles(zoom);
      expect((ts.hp.fontPx / zoom) * zoom).toBeCloseTo(ts.hp.fontPx);
      expect((ts.elevation.linePx / zoom) * zoom).toBeCloseTo(ts.elevation.linePx);
    }
  });
});

describe('climbLabelText', () => {
  it('collapses equal values and hides a fully free climb', () => {
    expect(climbLabelText(4, 4)).toBe('4');
    expect(climbLabelText(0, 0)).toBeNull();
  });

  it('shows both when they differ, keeping a lone 0', () => {
    expect(climbLabelText(0, 4)).toBe('0/4');
    expect(climbLabelText(4, 6)).toBe('4/6');
  });

  it('renders a hard block (negative) as -', () => {
    expect(climbLabelText(-4, 4)).toBe('-/4');
    expect(climbLabelText(-4, -4)).toBe('-');
  });
});

describe('hexClimbLabels (per-edge totals for a hex structure)', () => {
  const tower = (over: Partial<StructureTemplate> = {}) =>
    template({ anchor: 'hex', elevation: 10, mpClimbUp: 4, mpMountedUp: 4, ...over });

  it('labels all 6 edges of a tower on the ground (total = steps x rate)', () => {
    const labels = hexClimbLabels({ q: 0, r: 0 }, { '0,0': { templateId: 't' } }, { t: tower() });
    expect(labels).toHaveLength(6);
    expect(labels.every(l => l.foot === 4 && l.mounted === 4)).toBe(true);
  });

  it('scales the total by 10-ft steps', () => {
    const labels = hexClimbLabels({ q: 0, r: 0 }, { '0,0': { templateId: 't' } }, { t: tower({ elevation: 20 }) });
    expect(labels[0].foot).toBe(8);
  });

  it('hides an edge to a same-height neighbour (no extra crossing cost)', () => {
    const structures = { '0,0': { templateId: 't' }, '1,0': { templateId: 't' } };
    const labels = hexClimbLabels({ q: 0, r: 0 }, structures, { t: tower() });
    expect(labels.some(l => l.dir === 0)).toBe(false);
    expect(labels).toHaveLength(5);
  });

  it('skips edges covered by an edge structure', () => {
    const structures = { '0,0': { templateId: 't' }, '0,0,0': { templateId: 'e' } };
    const labels = hexClimbLabels({ q: 0, r: 0 }, structures, { t: tower(), e: tower({ anchor: 'edge' }) });
    expect(labels.some(l => l.dir === 0)).toBe(false);
    expect(labels).toHaveLength(5);
  });

  it('returns [] for a hex with no structure', () => {
    expect(hexClimbLabels({ q: 5, r: 5 }, {}, {})).toEqual([]);
  });
});
