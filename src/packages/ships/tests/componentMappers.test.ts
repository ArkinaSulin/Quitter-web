import { describe, expect, it } from 'vitest';
import {
  componentTemplateToComponentRow,
  componentTemplateToWeaponRow,
  mapComponentToTemplate,
  mapWeaponToTemplate,
  validateShipComponentTemplate,
} from '@/packages/ships/lib/componentMappers';

const weaponTemplate = () => ({
  id: 'w1',
  kind: 'weapon' as const,
  name: 'heavy ram',
  mass: 3,
  crew: 2,
  hittable: true,
  cost: 100,
  effect: '',
  builtIn: false,
  damage: '6d10',
  minRange: 0,
  range: 1,
  maxRange: 1,
  fireCycleStep: 2,
  special: 'melee',
  ac: 10,
  imageUrl: '',
});

describe('component workshop mappers', () => {
  it('maps a built-in component row', () => {
    const t = mapComponentToTemplate({
      id: 'c1', name: 'helm', mass: 1, crew: 1, cost: 0,
      hittable: true, effect: 'steering', builtIn: true, ac: 10, imageUrl: 'x',
    });
    expect(t.kind).toBe('component');
    expect(t.builtIn).toBe(true);
    expect(t.name).toBe('helm');
    expect(t.effect).toBe('steering');
    expect(t.imageUrl).toBe('x');
  });

  it('maps an optional component row', () => {
    const t = mapComponentToTemplate({
      id: 'c2', name: 'ram', mass: 5, crew: 0, cost: 5000,
      hittable: true, effect: '16d10 ram', builtIn: false, ac: 10,
    });
    expect(t.builtIn).toBe(false);
    expect(componentTemplateToComponentRow(t)).toMatchObject({
      name: 'ram',
      mass: 5,
      built_in: false,
    });
  });

  it('maps a weapon row and writes the new weapon columns', () => {
    const t = mapWeaponToTemplate({
      id: 'w1', name: 'heavy ram', mass: 3, damage: '6d10',
      minRange: 0, range: 1, maxRange: 1, fireCycleStep: 2,
      crew: 2, cost: 100, ammoCost: null, special: 'melee', ac: 10,
    });
    expect(t.kind).toBe('weapon');
    expect(t.builtIn).toBe(false);
    expect(t.fireCycleStep).toBe(2);
    expect(componentTemplateToWeaponRow(t)).toMatchObject({
      name: 'heavy ram',
      mass: 3,
      min_range: 0,
      range: 1,
      max_range: 1,
      fire_cycle_step: 2,
    });
  });

});

describe('component workshop validation', () => {
  it('requires a name', () => {
    expect(validateShipComponentTemplate({ ...weaponTemplate(), name: '' })).toBe('Name is required.');
  });

  it('rejects negative mass/crew/cost', () => {
    expect(validateShipComponentTemplate({ ...weaponTemplate(), mass: -1 })).toContain('Mass');
    expect(validateShipComponentTemplate({ ...weaponTemplate(), crew: -1 })).toContain('Crew');
    expect(validateShipComponentTemplate({ ...weaponTemplate(), cost: -1 })).toContain('Cost');
  });

  it('validates weapon range order and fire cycle', () => {
    expect(validateShipComponentTemplate({ ...weaponTemplate(), minRange: 2, range: 1 })).toContain('Min range');
    expect(validateShipComponentTemplate({ ...weaponTemplate(), range: 2, maxRange: 1 })).toContain('Range');
    expect(validateShipComponentTemplate({ ...weaponTemplate(), fireCycleStep: 0 })).toContain('Fire cycle');
    expect(validateShipComponentTemplate(weaponTemplate())).toBeNull();
  });
});
