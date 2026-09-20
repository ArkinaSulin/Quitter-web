import { describe, it, expect } from 'vitest';
import { hexStructureAttackKind, resolveHexStructureAttack, isAttackableHexStructure } from './structureCombat';
import { StructureTemplate, StructureInstance } from '@/types/structure';
import { Hex } from '@/types/gameProtocol';

const h = (q: number, r: number): Hex => ({ q, r, s: -q - r });

const template = (over: Partial<StructureTemplate> = {}): StructureTemplate => ({
  id: 't', name: 'Gate Tower', description: '', anchor: 'hex', color: '#fff', imageUrl: '',
  battlement: false,
  edgeABlock: false, edgeAMoveCost: null, edgeAMeleeAc: null, edgeARangedAc: null,
  edgeBBlock: false, edgeBMoveCost: null, edgeBMeleeAc: null, edgeBRangedAc: null,
  hexMoveCost: 2, doorHp: 30, maxHp: 100, dt: 15, modifiers: [], createdAt: '', updatedAt: '',
  ...over,
});

const bow = { damageDice: '1d6', range: 4, maxRange: 8 };
const sword = { damageDice: '1d8', range: 1, maxRange: 1 };
const fixed = (v: number) => () => Math.min(0.999, (v - 1) / 6); // 1d6 -> v (for v=1..6)

describe('hexStructureAttackKind', () => {
  it('melee at adjacency, ranged within weapon band, null otherwise', () => {
    const t = h(3, 0);
    expect(hexStructureAttackKind({ hex: h(2, 0) }, t, sword)).toBe('melee');
    expect(hexStructureAttackKind({ hex: h(1, 0) }, t, bow)).toBe('ranged'); // dist 2
    expect(hexStructureAttackKind({ hex: h(1, 0) }, t, sword)).toBeNull(); // melee weapon out of reach
    expect(hexStructureAttackKind({ hex: h(-6, 0) }, t, bow)).toBeNull(); // dist 9 > maxRange 8
  });
});

describe('isAttackableHexStructure', () => {
  it('true with a standing door or destructible HP', () => {
    expect(isAttackableHexStructure(template(), { templateId: 't' })).toBe(true); // door 30
    expect(isAttackableHexStructure(template({ doorHp: null, maxHp: 50 }), { templateId: 't' })).toBe(true);
    expect(isAttackableHexStructure(template({ doorHp: null, maxHp: 0 }), { templateId: 't' })).toBe(false);
  });
});

describe('resolveHexStructureAttack (door-first)', () => {
  const inst = (over: Partial<StructureInstance> = {}): StructureInstance => ({ templateId: 't', ...over });

  it('deflects at or below the DT', () => {
    const r = resolveHexStructureAttack(template({ dt: 6 }), inst(), bow, fixed(6)); // 6 damage
    expect(r.deflected).toBe(true);
    expect(r.hitDoor).toBe(true);
    expect(r.doorHpAfter).toBe(30);
  });

  it('damages the door first, leaving the structure HP untouched', () => {
    const r = resolveHexStructureAttack(template({ dt: 0 }), inst(), bow, fixed(6));
    expect(r.hitDoor).toBe(true);
    expect(r.applied).toBe(6);
    expect(r.doorHpAfter).toBe(24);
    expect(r.hpAfter).toBe(100);
    expect(r.destroyed).toBe(false);
  });

  it('destroys the door at 0, then hits the structure', () => {
    const doorGone = resolveHexStructureAttack(template({ dt: 0 }), inst({ doorHp: 5 }), bow, fixed(6));
    expect(doorGone.hitDoor).toBe(true);
    expect(doorGone.doorHpAfter).toBe(0);
    const onStructure = resolveHexStructureAttack(template({ dt: 0 }), inst({ doorHp: 0 }), bow, fixed(6));
    expect(onStructure.hitDoor).toBe(false);
    expect(onStructure.hpAfter).toBe(94);
    expect(onStructure.destroyed).toBe(false);
  });

  it('destroys the structure at 0 HP', () => {
    const r = resolveHexStructureAttack(template({ dt: 0, maxHp: 5 }), inst({ doorHp: 0, maxHp: 5, hp: 5 }), bow, fixed(6));
    expect(r.destroyed).toBe(true);
    expect(r.hpAfter).toBe(0);
  });

  it('a doorless structure takes damage directly', () => {
    const r = resolveHexStructureAttack(template({ doorHp: null, dt: 0 }), inst(), bow, fixed(6));
    expect(r.hitDoor).toBe(false);
    expect(r.doorHpAfter).toBeNull();
    expect(r.hpAfter).toBe(94);
  });

  it('an OPEN gate bypasses the door and exposes the structure HP', () => {
    const r = resolveHexStructureAttack(template({ dt: 0 }), inst({ open: true }), bow, fixed(6));
    expect(r.hitDoor).toBe(false);
    expect(r.doorHpAfter).toBeNull();
    expect(r.hpAfter).toBe(94);
    expect(isAttackableHexStructure(template(), inst({ open: true }))).toBe(true);
  });

  it('does nothing once the door is gone and the structure is indestructible', () => {
    const r = resolveHexStructureAttack(template({ dt: 0, maxHp: 0 }), inst({ doorHp: 0 }), bow, fixed(6));
    expect(r.applied).toBe(0);
    expect(r.destroyed).toBe(false);
  });
});
