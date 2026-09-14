import { describe, it, expect } from 'vitest';
import { Unit, Hex, Formation, AllianceGroup } from '@/types/gameProtocol';
import { imposesZocOn, disengageAttackers } from './zocDisengage';

const h = (q: number, r: number): Hex => ({ q, r, s: -q - r });

const form = (name: string, stop: string[] = ['front']): Formation => ({
  id: name, name,
  melee_ac_modifier: 0, range_ac_modifier: 0, movement_multiplier: 1, attack_modifier: 0, morale_modifier: 0,
  row_capacity_multiplier: 1, attack_capacity_multiplier: 1,
  melee_target_arcs: ['front'], ranged_target_arcs: ['front', 'flank', 'rear'],
  threat_arcs: ['front', 'flank'], double_threat_arcs: ['rear'],
  retaliate_arcs: { front: 'full', flank: 'rows', rear: 'none' },
  retaliate_vs_ranged: false, can_charge: false,
  stop_enemy_movement_arcs: stop, charge_through_arcs: [],
  be_attacked_melee_modifier: 1, be_attacked_range_modifier: 1,
} as Formation);

const FORMS: Record<string, Formation> = {
  'Close Order': form('Close Order', ['front']),
  Scattered: form('Scattered', []),
  Routed: form('Routed', []),
  Hero: form('Hero', []),
};

function unit(over: Partial<Unit> & { id: string; team: string }): Unit {
  return {
    scenarioId: 's', templateId: null, unitName: over.id, raceId: '', raceName: '', armorName: '',
    mountId: null, mountName: '', isHero: false, attachedToUnitId: null, attachedPosition: null,
    currentTroopCount: 10, maxTroopCount: 10, level: 1, troopHp: 1, maxUnitHp: 10, currentUnitHp: 10,
    isShielded: false, baselineAc: 10, currentAc: 10, weaponString: '', movementPoints: 3,
    movementPointsAvailable: 0, aggressiveness: 5, baseMorale: 5, currentMoraleModifier: 0,
    sizeCategory: 100, visualScale: 100, currentFormation: 'Close Order', formationAvailability: [],
    equipCostGp: 0, canCharge: false, hex: h(0, 0), facing: 0, hidden: false, isDeleted: false,
    ignoreMoraleChecks: false, isCharging: false, chargeDistance: 0, commandSeq: 0,
    organizationLevel: 2, actionsAvailable: 2, attacksUsed: 0, archerReactionUsed: false,
    partingShotUsed: false, activeWeaponIndex: 0, str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0,
    ...over,
  } as Unit;
}

const ALLIANCES: Record<string, AllianceGroup> = { red: 'enemy', blue: 'friendly' };

describe('imposesZocOn', () => {
  // Enemy at (0,0) facing 0 → front hexes (0,-1) and (1,-1).
  const enemy = unit({ id: 'e', team: 'red', hex: h(0, 0), facing: 0 });
  it('covers the two front hexes for a formed unit', () => {
    expect(imposesZocOn(enemy, h(0, -1), FORMS)).toBe(true);
    expect(imposesZocOn(enemy, h(1, -1), FORMS)).toBe(true);
    expect(imposesZocOn(enemy, h(-1, 0), FORMS)).toBe(false); // rear
    expect(imposesZocOn(enemy, h(3, 0), FORMS)).toBe(false); // not adjacent
  });
  it('Scattered, Routed and Heroes impose none', () => {
    expect(imposesZocOn({ ...enemy, currentFormation: 'Scattered' }, h(0, -1), FORMS)).toBe(false);
    expect(imposesZocOn({ ...enemy, currentFormation: 'Routed' }, h(0, -1), FORMS)).toBe(false);
    expect(imposesZocOn({ ...enemy, isHero: true, currentFormation: 'Hero' }, h(0, -1), FORMS)).toBe(false);
  });
  it('hidden / attached impose none', () => {
    expect(imposesZocOn({ ...enemy, hidden: true }, h(0, -1), FORMS)).toBe(false);
    expect(imposesZocOn({ ...enemy, attachedToUnitId: 'host' }, h(0, -1), FORMS)).toBe(false);
  });
});

describe('disengageAttackers', () => {
  const mover = unit({ id: 'm', team: 'blue', hex: h(0, -1) });
  const enemy = unit({ id: 'e', team: 'red', hex: h(0, 0), facing: 0 });

  it('returns a formed hostile whose kill zone is being left', () => {
    const out = disengageAttackers(mover, h(0, -1), h(0, -2), [mover, enemy], ALLIANCES, FORMS);
    expect(out.map(u => u.id)).toEqual(['e']);
  });

  it('does not fire when the mover stays inside the kill zone', () => {
    // (0,-1) -> (1,-1) is still one of the enemy's front hexes.
    const out = disengageAttackers(mover, h(0, -1), h(1, -1), [mover, enemy], ALLIANCES, FORMS);
    expect(out).toEqual([]);
  });

  it('ignores enemies whose kill zone only covers the destination', () => {
    const out = disengageAttackers(mover, h(-2, 0), h(0, -1), [mover, enemy], ALLIANCES, FORMS);
    expect(out).toEqual([]);
  });

  it('Scattered / Routed / Hero enemies never part', () => {
    const scattered = { ...enemy, id: 's', currentFormation: 'Scattered' };
    const routed = { ...enemy, id: 'r', currentFormation: 'Routed' };
    const hero = { ...enemy, id: 'h', isHero: true, currentFormation: 'Hero' };
    const out = disengageAttackers(mover, h(0, -1), h(0, -2), [mover, scattered, routed, hero], ALLIANCES, FORMS);
    expect(out).toEqual([]);
  });

  it('a unit that already parted this turn is skipped', () => {
    const used = { ...enemy, partingShotUsed: true };
    const out = disengageAttackers(mover, h(0, -1), h(0, -2), [mover, used], ALLIANCES, FORMS);
    expect(out).toEqual([]);
  });

  it('same-alliance enemies never part', () => {
    const friendly = { ...enemy, id: 'f', team: 'blue' };
    const out = disengageAttackers(mover, h(0, -1), h(0, -2), [mover, friendly], ALLIANCES, FORMS);
    expect(out).toEqual([]);
  });
});
