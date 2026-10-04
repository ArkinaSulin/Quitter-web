import { describe, it, expect } from 'vitest';
import { structureBadges } from './mapFeatureDraw';
import { StructureTemplate } from '@/types/structure';

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
    expect(b.hpText).toBe('30');
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
