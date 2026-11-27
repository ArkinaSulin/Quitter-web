import { describe, expect, it } from 'vitest';
import { classifyUnitShipAttack, unitShipAttackWeapon } from '@/packages/units';
import type { Weapon } from '@/packages/units';

const weapon = (over: Partial<Weapon>): Weapon => ({
  name: 'w',
  attackBonus: 0,
  damageDice: '1d6',
  isHealing: false,
  range: 1,
  maxRange: 1,
  magicDimension: 0,
  shape: 'circle',
  reach: false,
  noRetaliation: false,
  freeAction: false,
  isTwoHanded: false,
  numberOfAttacks: 1,
  onSaveHalfOrNeg: true,
  savingThrow: 'Dex',
  saveDC: 10,
  ...over,
});

describe('unit ship attack classification', () => {
  it('personal weapons cannot damage ships', () => {
    expect(classifyUnitShipAttack({ sizeCategory: 100 }, weapon({}))).toBe('personal');
  });

  it('war machines are siege, area magic is AoE, flagged magic is single-target', () => {
    expect(classifyUnitShipAttack({ sizeCategory: 100 }, weapon({ warMachine: true }))).toBe('siege');
    expect(classifyUnitShipAttack({ sizeCategory: 100 }, weapon({ magicDimension: 20 }))).toBe('magic-aoe');
    expect(classifyUnitShipAttack({ sizeCategory: 100 }, weapon({ magic: true }))).toBe('magic-single');
  });

  it('Huge and larger units use the ship-weapon pipeline regardless of weapon', () => {
    expect(classifyUnitShipAttack({ sizeCategory: 300 }, weapon({}))).toBe('huge');
    expect(classifyUnitShipAttack({ sizeCategory: 400 }, weapon({ magicDimension: 20 }))).toBe('huge');
  });

  it('picks the longest-range weapon that reaches the target', () => {
    const melee = weapon({ name: 'claw', maxRange: 1 });
    const bow = weapon({ name: 'bow', maxRange: 6 });
    const far = weapon({ name: 'far', maxRange: 10 });
    expect(unitShipAttackWeapon([melee, bow, far], 3)?.name).toBe('far');
    expect(unitShipAttackWeapon([melee, bow], 5)?.name).toBe('bow');
    expect(unitShipAttackWeapon([melee], 2)).toBeNull();
  });
});
