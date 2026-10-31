import { describe, expect, it } from 'vitest';
import {
  componentTemplateToAccessoryRow,
  componentTemplateToComponentRow,
  componentTemplateToWeaponRow,
  mapAccessoryToTemplate,
  mapComponentToTemplate,
  mapWeaponToTemplate,
  slugifyComponentName,
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
  it('maps a component row to the unified template', () => {
    const t = mapComponentToTemplate({
      id: 'c1', name: 'helm', mass: 1, crew: 1, cost: 0,
      hittable: true, effect: 'steering', ac: 10, imageUrl: 'x',
    });
    expect(t.kind).toBe('component');
    expect(t.name).toBe('helm');
    expect(t.effect).toBe('steering');
    expect(t.damage).toBe('');
    expect(t.imageUrl).toBe('x');
  });

  it('maps a weapon row and writes the new weapon columns', () => {
    const t = mapWeaponToTemplate({
      id: 'w1', name: 'heavy ram', mass: 3, damage: '6d10',
      minRange: 0, range: 1, maxRange: 1, fireCycleStep: 2,
      crew: 2, cost: 100, ammoCost: null, special: 'melee', ac: 10,
    });
    expect(t.kind).toBe('weapon');
    expect(t.fireCycleStep).toBe(2);
    expect(componentTemplateToWeaponRow(t)).toMatchObject({
      name: 'heavy_ram',
      mass: 3,
      min_range: 0,
      range: 1,
      max_range: 1,
      fire_cycle_step: 2,
    });
  });

  it('maps an accessory row and writes the existing accessory columns only', () => {
    const t = mapAccessoryToTemplate({
      id: 'a1', name: 'ram_mount', mass: 5, crew: 0, cost: 5000,
      hittable: true, effect: 'mount', ac: 10,
    });
    expect(t.kind).toBe('accessory');
    expect(componentTemplateToAccessoryRow(t)).toEqual({
      name: 'ram_mount',
      mass: 5,
      crew: 0,
      cost: 5000,
      hittable: true,
      effect: 'mount',
      ac: 10,
      image_url: '',
    });
  });

  it('slugifies names and keeps component built-ins name-only', () => {
    expect(slugifyComponentName('Heavy Ram!')).toBe('heavy_ram');
    const t = mapComponentToTemplate({
      id: 'c1', name: 'helm', mass: 1, crew: 1, cost: 0, hittable: true, effect: null,
    });
    expect(componentTemplateToComponentRow(t).name).toBe('helm');
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
