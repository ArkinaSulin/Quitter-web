import { describe, it, expect } from 'vitest';
import { mapTemplate, mapTemplateToRow } from './templateMappers';

describe('mapTemplate', () => {
  it('converts snake_case DB row to camelCase UnitTemplate', () => {
    const row = {
      id: 'abc-123',
      unit_name: 'Towns Guard',
      race_id: 'race-1',
      model_type_id: 'type-1',
      is_hero: false,
      troop_count: 20,
      level: 2,
      troop_hp: 11,
      max_unit_hp: 220,
      number_of_attacks: 1,
      armor_id: 'armor-1',
      is_shielded: true,
      base_ac: 10,
      baseline_ac: 18,
      weapon_string: 'Spear,3,single,1d6+1,1,0,false',
      mount_id: null,
      movement_points: 3,
      aggressiveness: 3,
      base_morale: 4,
      size_category: 100,
      visual_scale: 100,
      formation_availability: ['Scattered', 'Routed', 'Close Order', 'Open Order'],
      equip_cost_gp: 40,
      weekly_cost_gp: 16,
      can_charge: false,
      custom_image_url: null,
      unit_type_icon_url: null,
      created_at: '2024-01-01T00:00:00Z',
      updated_at: '2024-01-01T00:00:00Z',
    };

    const result = mapTemplate(row);

    expect(result.unitName).toBe('Towns Guard');
    expect(result.raceId).toBe('race-1');
    expect(result.troopCount).toBe(20);
    expect(result.isShielded).toBe(true);
    expect(result.baselineAc).toBe(18);
    expect(result.weaponString).toBe('Spear,3,single,1d6+1,1,0,false');
  });

  it('falls back to defaults for missing fields', () => {
    const result = mapTemplate({});

    expect(result.unitName).toBe('');
    expect(result.troopCount).toBe(1);
    expect(result.level).toBe(1);
    expect(result.baselineAc).toBe(10);
    expect(result.isShielded).toBe(false);
    expect(result.formationAvailability).toEqual(['Scattered', 'Routed']);
  });

  it('resolves joined relation fields when present', () => {
    const row = {
      races: { name: 'Human', base_hd: 1, icon_url: '/human.png', can_charge: false },
      armors: { name: 'Chain mail' },
      mounts: { name: 'Warhorse' },
      unit_types: { name: 'Infantry', icon_url: '/infantry.png' },
    };

    const result = mapTemplate(row);

    expect(result.raceName).toBe('Human');
    expect(result.armorName).toBe('Chain mail');
    expect(result.mountName).toBe('Warhorse');
  });
});

describe('mapTemplateToRow', () => {
  it('converts camelCase UnitTemplate to snake_case row', () => {
    const template = {
      id: 'abc-123',
      unitName: 'Towns Guard',
      raceId: 'race-1',
      modelTypeId: 'type-1',
      isHero: false,
      troopCount: 20,
      level: 2,
      troopHp: 11,
      maxUnitHp: 220,
      numberOfAttacks: 1,
      armorId: 'armor-1',
      isShielded: true,
      baseAc: 10,
      baselineAc: 18,
      weaponString: 'Spear,3,single,1d6+1,1,0,false',
      mountId: null,
      mountName: '',
      movementPoints: 3,
      aggressiveness: 3,
      baseMorale: 4,
      sizeCategory: 100,
      visualScale: 100,
      formationAvailability: ['Scattered', 'Routed', 'Close Order', 'Open Order'],
      equipCostGp: 40,
      weeklyCostGp: 16,
      canCharge: false,
      customImageUrl: null,
      unitTypeIconUrl: null,
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
    } as any;

    const row = mapTemplateToRow(template);

    expect(row.unit_name).toBe('Towns Guard');
    expect(row.troop_count).toBe(20);
    expect(row.is_shielded).toBe(true);
    expect(row.baseline_ac).toBe(18);
    expect(row.armor_id).toBe('armor-1');
    expect(row.weekly_cost_gp).toBe(16);
  });

  it('calculates max_unit_hp as troopHp * troopCount', () => {
    const template = { troopHp: 11, troopCount: 20 } as any;
    const result = mapTemplateToRow(template);
    expect(result.max_unit_hp).toBe(220);
  });

  it('calculates weekly_cost_gp as 4 * level^2', () => {
    const template = { level: 3 } as any;
    const result = mapTemplateToRow(template);
    expect(result.weekly_cost_gp).toBe(36);
  });
});

describe('roundtrip', () => {
  it('mapTemplate(mapTemplateToRow(template)) preserves data for known fields', () => {
    const template = {
      id: 'abc-123',
      unitName: 'Towns Guard',
      raceId: 'race-1',
      modelTypeId: 'type-1',
      isHero: false,
      troopCount: 20,
      level: 2,
      troopHp: 11,
      maxUnitHp: 220,
      numberOfAttacks: 1,
      armorId: 'armor-1',
      isShielded: true,
      baseAc: 10,
      baselineAc: 18,
      weaponString: 'Spear,3,single,1d6+1,1,0,false',
      mountId: null,
      mountName: '',
      movementPoints: 3,
      aggressiveness: 3,
      baseMorale: 4,
      sizeCategory: 100,
      visualScale: 100,
      formationAvailability: ['Scattered', 'Routed', 'Close Order', 'Open Order'],
      equipCostGp: 40,
      weeklyCostGp: 16,
      canCharge: false,
      customImageUrl: null,
      unitTypeIconUrl: null,
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
    } as any;

    const row = mapTemplateToRow(template);
    const roundtripped = mapTemplate(row);

    expect(roundtripped.unitName).toBe(template.unitName);
    expect(roundtripped.troopCount).toBe(template.troopCount);
    expect(roundtripped.level).toBe(template.level);
    expect(roundtripped.isShielded).toBe(template.isShielded);
    expect(roundtripped.baselineAc).toBe(template.baselineAc);
    expect(roundtripped.aggressiveness).toBe(template.aggressiveness);
    expect(roundtripped.baseMorale).toBe(template.baseMorale);
    expect(roundtripped.sizeCategory).toBe(template.sizeCategory);
    expect(roundtripped.formationAvailability).toEqual(template.formationAvailability);
  });
});
