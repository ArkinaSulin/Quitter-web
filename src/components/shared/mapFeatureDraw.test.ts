import { describe, it, expect } from 'vitest';
import { structureBadges, edgeStructureVisuals } from './mapFeatureDraw';
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
  mpFootIn: null,
  mpFootOut: null,
  mpMountedIn: null,
  mpMountedOut: null,
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
    expect(b.destroyed).toBe(false);
    expect(b.hpText).toBe('HP: 30');
  });

  it('shows a destroyed badge (not HP) for maxHp > 0 and hp <= 0', () => {
    const b = structureBadges(template(), { templateId: 't', hp: 0 });
    expect(b.destroyed).toBe(true);
    expect(b.hpText).toBeNull();
  });

  it('shows nothing for a decorative maxHp = 0 structure', () => {
    const b = structureBadges(template({ maxHp: 0 }), { templateId: 't' });
    expect(b.destroyed).toBe(false);
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

  it('an ignore_climb edge (no ladder flag) also draws the ladder', () => {
    const v = edgeStructureVisuals({ ...geom, template: edge({ modifiers: [{ kind: 'ignore_climb' }] }), instance: inst() });
    expect(v.ladder).not.toBeNull();
    expect(v.baseLine).toBe(false);
  });
});
