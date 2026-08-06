import { describe, it, expect } from 'vitest';
import {
  canMeleeTarget,
  canRangedTarget,
  getThreatMode,
  getRetaliationMode,
  canFormationCharge,
  canStopEnemyMovement,
  canChargeThrough,
  beAttackedModifier,
  beAttackedModifierNote,
  getEffectivePosition,
} from './formationRules';
import { Formation } from '@/types/gameProtocol';

function form(partial: Partial<Formation>): Formation {
  return {
    id: 'x',
    name: 'X',
    ac_modifier: 0,
    movement_multiplier: 1,
    attack_modifier: 0,
    morale_modifier: 0,
    row_capacity_multiplier: 1,
    attack_capacity_multiplier: 1,
    melee_target_arcs: ['front'],
    ranged_target_arcs: ['front', 'flank', 'rear'],
    threat_arcs: ['front', 'flank'],
    double_threat_arcs: ['rear'],
    retaliate_arcs: { front: 'full', flank: 'rows', rear: 'none' },
    retaliate_vs_ranged: false,
    can_charge: false,
    stop_enemy_movement_arcs: ['front'],
    charge_through_arcs: [],
    be_attacked_melee_modifier: 1,
    be_attacked_range_modifier: 1,
    ...partial,
  };
}

describe('formationRules', () => {
  const hero = form({ name: 'Hero', melee_target_arcs: ['front', 'flank', 'rear'], threat_arcs: ['front', 'flank', 'rear'], double_threat_arcs: [], retaliate_arcs: { front: 'full', flank: 'full', rear: 'full' }, stop_enemy_movement_arcs: [], can_charge: false });
  const scattered = form({ name: 'Scattered', melee_target_arcs: ['front', 'flank', 'rear'], threat_arcs: ['front', 'flank', 'rear'], double_threat_arcs: [], retaliate_arcs: { front: 'rows', flank: 'rows', rear: 'rows' }, stop_enemy_movement_arcs: [], be_attacked_melee_modifier: 1.5, be_attacked_range_modifier: 0.5 });
  const routed = form({ name: 'Routed', melee_target_arcs: [], ranged_target_arcs: [], threat_arcs: [], double_threat_arcs: ['front', 'flank', 'rear'], retaliate_arcs: { front: 'none', flank: 'none', rear: 'none' }, stop_enemy_movement_arcs: [], be_attacked_melee_modifier: 2, be_attacked_range_modifier: 0.5 });
  const formed = form({ name: 'Open Order', can_charge: true });

  it('canMeleeTarget respects the melee arc set', () => {
    expect(canMeleeTarget(formed, 'front')).toBe(true);
    expect(canMeleeTarget(formed, 'flank')).toBe(false);
    expect(canMeleeTarget(hero, 'rear')).toBe(true);
    expect(canMeleeTarget(scattered, 'rear')).toBe(true);
    expect(canMeleeTarget(routed, 'front')).toBe(false);
  });

  it('canRangedTarget respects the ranged arc set', () => {
    expect(canRangedTarget(routed, 'front')).toBe(false);
    expect(canRangedTarget(scattered, 'front')).toBe(true);
    expect(canRangedTarget(formed, 'front')).toBe(true);
  });

  it('getThreatMode returns normal / double / none per arc', () => {
    expect(getThreatMode(formed, 'front')).toBe('normal');
    expect(getThreatMode(formed, 'rear')).toBe('double');
    expect(getThreatMode(hero, 'rear')).toBe('normal');
    expect(getThreatMode(routed, 'front')).toBe('double');
    expect(getThreatMode(routed, 'rear')).toBe('double');
  });

  it('getRetaliationMode per arc', () => {
    expect(getRetaliationMode(formed, 'front')).toBe('full');
    expect(getRetaliationMode(formed, 'flank')).toBe('rows');
    expect(getRetaliationMode(formed, 'rear')).toBe('none');
    expect(getRetaliationMode(scattered, 'front')).toBe('rows');
    expect(getRetaliationMode(routed, 'rear')).toBe('none');
    expect(getRetaliationMode(hero, 'rear')).toBe('full');
  });

  it('canFormationCharge', () => {
    expect(canFormationCharge(formed)).toBe(true);
    expect(canFormationCharge(scattered)).toBe(false);
    expect(canFormationCharge(routed)).toBe(false);
    expect(canFormationCharge(null)).toBe(false);
  });

  it('canStopEnemyMovement', () => {
    expect(canStopEnemyMovement(formed, 'front')).toBe(true);
    expect(canStopEnemyMovement(scattered, 'front')).toBe(false);
    expect(canStopEnemyMovement(hero, 'front')).toBe(false);
  });

  it('canChargeThrough', () => {
    const chargeable = form({ name: 'Open Order', charge_through_arcs: ['front', 'flank', 'rear'] });
    expect(canChargeThrough(chargeable, 'front')).toBe(true);
    expect(canChargeThrough(chargeable, 'rear')).toBe(true);
    expect(canChargeThrough(formed, 'front')).toBe(false);
  });

  it('beAttackedModifier: melee vs ranged', () => {
    expect(beAttackedModifier(scattered, false)).toBe(1.5);
    expect(beAttackedModifier(scattered, true)).toBe(0.5);
    expect(beAttackedModifier(routed, false)).toBe(2);
    expect(beAttackedModifier(formed, false)).toBe(1);
    expect(beAttackedModifier(null, false)).toBe(1);
  });

  it('beAttackedModifierNote explains the count change', () => {
    expect(beAttackedModifierNote(scattered, true)).toContain('ranged');
    expect(beAttackedModifierNote(scattered, true)).toContain('-50%');
    expect(beAttackedModifierNote(scattered, false)).toContain('+50%');
    expect(beAttackedModifierNote(routed, false)).toContain('+100%');
    expect(beAttackedModifierNote(formed, false)).toBeUndefined();
    expect(beAttackedModifierNote(null, false)).toBeUndefined();
  });

  it('getEffectivePosition maps retaliation mode to a coarse label', () => {
    expect(getEffectivePosition(hero, 'rear')).toBe('front');
    expect(getEffectivePosition(scattered, 'rear')).toBe('flank');
    expect(getEffectivePosition(routed, 'front')).toBe('rear');
    expect(getEffectivePosition(formed, 'rear')).toBe('rear');
  });
});
