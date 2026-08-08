import { describe, it, expect } from 'vitest';
import { computeChargeOverLandingHex, isChargeOverEligible, CombatOutcome } from './chargeOver';
import { Formation, Unit, Hex } from '@/types/gameProtocol';

const h = (q: number, r: number): Hex => ({ q, r, s: -q - r });

const form = (partial: Partial<Formation>): Formation => ({
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
});

const openOrder = form({ name: 'Open Order', charge_through_arcs: ['front', 'flank', 'rear'] });
const closeOrder = form({ name: 'Close Order', charge_through_arcs: ['flank'] });
const routed = form({ name: 'Routed', charge_through_arcs: ['front', 'flank', 'rear'] });

// Charger at (0,0) facing 0 (front dirs (0,-1),(1,-1)); target at (1,-1).
// Land hex = 2*(1,-1) - (0,0) = (2,-2).
const charger = { hex: h(0, 0), facing: 0, currentFormation: 'Close Order', movementPointsAvailable: 4, actionsAvailable: 0 } as unknown as Unit;
const target = { hex: h(1, -1), facing: 0, currentFormation: 'Close Order' } as unknown as Unit;

const ok = (partial: Partial<CombatOutcome> = {}): CombatOutcome => ({
  attackerRouted: false,
  attackerKilled: false,
  defenderRouted: false,
  defenderKilled: false,
  ...partial,
});

describe('computeChargeOverLandingHex', () => {
  it('lands 2 hexes past the target, opposite the charger', () => {
    expect(computeChargeOverLandingHex(h(0, 0), h(1, -1))).toEqual(h(2, -2));
    expect(computeChargeOverLandingHex(h(0, 0), h(-1, 1))).toEqual(h(-2, 2));
  });
});

describe('isChargeOverEligible', () => {
  const empty = new Set<string>();

  it('allows overrun when the target formation is charge-through-able from the approach arc', () => {
    // Target Close Order faces the charger (approach arc = front); Close Order
    // only allows charge-through from the flank -> NOT eligible.
    expect(isChargeOverEligible(charger, target, ok(), empty, { 'Close Order': closeOrder }, 4)).toBe(false);
  });

  it('allows overrun through a flank approach arc of a dense formation', () => {
    const sideTarget = { ...target, facing: 2 } as unknown as Unit; // charger on its flank
    expect(isChargeOverEligible(charger, sideTarget, ok(), empty, { 'Close Order': closeOrder }, 4)).toBe(true);
  });

  it('allows overrun when the target routed / was killed by the attack', () => {
    expect(isChargeOverEligible(charger, target, ok({ defenderRouted: true }), empty, { 'Close Order': closeOrder, Routed: routed }, 4)).toBe(true);
    expect(isChargeOverEligible(charger, target, ok({ defenderKilled: true }), empty, { 'Close Order': closeOrder, Routed: routed }, 4)).toBe(true);
  });

  it('blocks when the attacker routed or was killed in combat', () => {
    expect(isChargeOverEligible(charger, target, ok({ attackerRouted: true }), empty, { 'Close Order': closeOrder }, 4)).toBe(false);
    expect(isChargeOverEligible(charger, target, ok({ attackerKilled: true }), empty, { 'Close Order': closeOrder }, 4)).toBe(false);
  });

  it('blocks when the charger cannot afford the 2 MP overrun', () => {
    const broke = { ...charger, movementPointsAvailable: 0, actionsAvailable: 0 } as unknown as Unit;
    expect(isChargeOverEligible(broke, target, ok(), empty, { 'Close Order': closeOrder }, 4)).toBe(false);
  });

  it('blocks when the landing hex is occupied', () => {
    expect(isChargeOverEligible(charger, target, ok(), new Set(['2,-2']), { 'Close Order': closeOrder }, 4)).toBe(false);
  });

  it('blocks when the target is not in the charger front arc', () => {
    const behind = { ...charger, facing: 3 } as unknown as Unit; // target no longer in front arc
    expect(isChargeOverEligible(behind, target, ok(), empty, { 'Close Order': closeOrder }, 4)).toBe(false);
  });
});
