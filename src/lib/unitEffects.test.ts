import { describe, it, expect } from 'vitest';
import { Unit, UnitEffect, GroundEffect, AllianceGroup } from '@/types/gameProtocol';
import { applyEffectChanges, removeEffectChanges, dotDamageChanges, computeEndTurnEffects, effectByKey, newEffectKey } from './unitEffects';

const h = (q: number, r: number) => ({ q, r, s: -q - r });

const unit = (id: string, team: string, hex = h(0, 0), overrides: Partial<Unit> = {}): Unit => ({
  id,
  scenarioId: 'sc',
  templateId: null,
  unitName: id,
  raceId: 'r',
  raceName: '',
  armorName: '',
  mountId: null,
  mountName: '',
  isHero: false,
  attachedToUnitId: null,
  attachedPosition: null,
  currentTroopCount: 10,
  maxTroopCount: 10,
  level: 1,
  troopHp: 1,
  maxUnitHp: 10,
  currentUnitHp: 10,
  isShielded: false,
  baselineAc: 12,
  currentAc: 12,
  weaponString: '',
  movementPoints: 3,
  movementPointsAvailable: 0,
  aggressiveness: 3,
  baseMorale: 3,
  currentMoraleModifier: 0,
  sizeCategory: 100,
  visualScale: 100,
  currentFormation: 'Open Order',
  formationAvailability: [],
  equipCostGp: 0,
  canCharge: false,
  hex,
  facing: 0,
  team,
  hidden: false,
  isDeleted: false,
  ignoreMoraleChecks: false,
  isCharging: false,
  chargeDistance: 0,
  commandSeq: 0,
  organizationLevel: 1,
  actionsAvailable: 2,
  attacksUsed: 0,
  archerReactionUsed: false,
  activeWeaponIndex: 0,
  str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0,
  effects: [],
  ...overrides,
});

const ef = (over: Partial<UnitEffect> = {}, overrides?: Partial<Unit>): UnitEffect => ({
  key: newEffectKey(() => 0.42),
  name: 'Bless',
  color: '#ffd700',
  kind: 'ac',
  delta: 2,
  duration: 3,
  turnsLeft: 3,
  casterUnitId: 'caster',
  casterTeam: 'blue',
  base: 12,
  ...over,
});

const groups: Record<string, AllianceGroup> = { blue: 'friendly', red: 'enemy' };

describe('apply / remove effect changes', () => {
  it('ac effect: snapshots base and writes currentAc + delta', () => {
    const u = unit('u', 'blue');
    const { changes, effect } = applyEffectChanges(u, { name: 'Bless', color: '#ffd700', kind: 'ac', delta: 2, duration: 3, turnsLeft: 3, casterUnitId: 'c', casterTeam: 'blue' }, 'k1');
    const effects = changes.find(c => c.field === 'effects');
    expect((effects!.to as UnitEffect[]).length).toBe(1);
    expect(effect.base).toBe(12);
    expect(changes.find(c => c.field === 'currentAc')).toEqual({ field: 'currentAc', from: 12, to: 14 });
  });

  it('movement effect modifies the movementPoints base field', () => {
    const u = unit('u', 'blue');
    const { changes } = applyEffectChanges(u, { name: 'Haste', color: '#66ff66', kind: 'movement', delta: 2, duration: 2, turnsLeft: 2, casterUnitId: 'c', casterTeam: 'blue' }, 'k2');
    expect(changes.find(c => c.field === 'movementPoints')).toEqual({ field: 'movementPoints', from: 3, to: 5 });
  });

  it('morale effect modifies currentMoraleModifier', () => {
    const u = unit('u', 'blue');
    const { changes } = applyEffectChanges(u, { name: 'Chill', color: '#88bbff', kind: 'morale', delta: -2, duration: 3, turnsLeft: 3, casterUnitId: 'c', casterTeam: 'blue' }, 'k3');
    expect(changes.find(c => c.field === 'currentMoraleModifier')).toEqual({ field: 'currentMoraleModifier', from: 0, to: -2 });
  });

  it('no same-kind stacking: second ac apply is a no-op returning the existing effect', () => {
    const u = unit('u', 'blue', h(0, 0), { effects: [ef({ key: 'k1' })] });
    const { changes, effect } = applyEffectChanges(u, { name: 'Curse', color: '#ff8888', kind: 'ac', delta: -2, duration: 2, turnsLeft: 2, casterUnitId: 'c', casterTeam: 'blue' }, 'k2');
    expect(changes).toEqual([]);
    expect(effect.key).toBe('k1');
  });

  it('remove restores the snapshotted base', () => {
    const u = unit('u', 'blue', h(0, 0), { effects: [ef({ key: 'k1', base: 12 })], currentAc: 14 });
    const changes = removeEffectChanges(u, 'k1');
    expect(changes.find(c => c.field === 'currentAc')).toEqual({ field: 'currentAc', from: 14, to: 12 });
    expect((changes.find(c => c.field === 'effects')!.to as UnitEffect[]).length).toBe(0);
  });

  it('remove of an unknown key is a no-op', () => {
    const u = unit('u', 'blue');
    expect(removeEffectChanges(u, 'nope')).toEqual([]);
  });

  it('dot apply writes no stat field', () => {
    const u = unit('u', 'blue');
    const { changes } = applyEffectChanges(u, { name: 'Burning', color: '#ff8844', kind: 'dot', delta: 3, duration: 2, turnsLeft: 2, casterUnitId: 'c', casterTeam: 'blue' }, 'k9');
    expect(changes.some(c => c.field !== 'effects')).toBe(false);
  });
});

describe('dotDamageChanges', () => {
  it('reduces hp and keeps troops synced to hp', () => {
    const u = unit('u', 'blue', h(0, 0), { troopHp: 2, maxTroopCount: 5, currentTroopCount: 5, maxUnitHp: 10, currentUnitHp: 10 });
    const changes = dotDamageChanges(u, 3);
    expect(changes.find(c => c.field === 'currentUnitHp')!.to).toBe(7);
    expect(changes.find(c => c.field === 'currentTroopCount')!.to).toBe(4); // ceil(7/2)
  });

  it('clamps at zero hp / troops', () => {
    const u = unit('u', 'blue', h(0, 0), { troopHp: 5, currentUnitHp: 4, currentTroopCount: 1, maxTroopCount: 2 });
    const changes = dotDamageChanges(u, 10);
    expect(changes.find(c => c.field === 'currentUnitHp')!.to).toBe(0);
    expect(changes.find(c => c.field === 'currentTroopCount')!.to).toBe(0);
  });
});

describe('computeEndTurnEffects', () => {
  const makeKey = (() => { let n = 0; return () => `k${++n}`; })();

  it('ticks a DoT on the caster activation and decrements turnsLeft', () => {
    const caster = unit('caster', 'blue');
    const target = unit('target', 'red', h(5, 0), { effects: [ef({ key: 'd1', kind: 'dot', delta: 4, turnsLeft: 2, duration: 2, casterUnitId: 'caster', casterTeam: 'blue' })] });
    const res = computeEndTurnEffects({ units: [caster, target], zones: [], nextGroup: 'friendly', alliances: groups, makeKey });
    const step = res.subSteps.find(s => s.unitId === 'target');
    expect(step).toBeDefined();
    expect(step!.changes.find(c => c.field === 'currentUnitHp')!.to).toBe(6); // 10 - 4
    const effects = step!.changes.find(c => c.field === 'effects')!.to as UnitEffect[];
    expect(effects[0].turnsLeft).toBe(1);
  });

  it('expires at 0 on the caster tick and restores the stat', () => {
    const caster = unit('caster', 'blue');
    const target = unit('target', 'red', h(5, 0), { effects: [ef({ key: 'a1', base: 12, turnsLeft: 1, duration: 1, casterUnitId: 'caster', casterTeam: 'blue' })], currentAc: 14 });
    const res = computeEndTurnEffects({ units: [caster, target], zones: [], nextGroup: 'friendly', alliances: groups, makeKey });
    const step = res.subSteps.find(s => s.unitId === 'target');
    expect(step!.changes.find(c => c.field === 'currentAc')!.to).toBe(12);
    expect((step!.changes.find(c => c.field === 'effects')!.to as UnitEffect[]).length).toBe(0);
  });

  it('does not tick when a different alliance activates', () => {
    const target = unit('target', 'red', h(5, 0), { effects: [ef({ key: 'a1', kind: 'dot', delta: 4, turnsLeft: 2, duration: 2, casterUnitId: 'caster', casterTeam: 'blue' })] });
    const caster = unit('caster', 'blue');
    const res = computeEndTurnEffects({ units: [caster, target], zones: [], nextGroup: 'enemy', alliances: groups, makeKey });
    expect(res.subSteps.length).toBe(0);
  });

  it('expires immediately when the caster unit is deleted', () => {
    const caster = unit('caster', 'blue', h(9, 9), { isDeleted: true });
    const target = unit('target', 'red', h(5, 0), { effects: [ef({ key: 'a1', base: 12, turnsLeft: 3, duration: 3, casterUnitId: 'caster', casterTeam: 'blue' })], currentAc: 14 });
    const res = computeEndTurnEffects({ units: [caster, target], zones: [], nextGroup: 'enemy', alliances: groups, makeKey });
    const step = res.subSteps.find(s => s.unitId === 'target');
    expect(step!.changes.find(c => c.field === 'currentAc')!.to).toBe(12);
  });

  it('creates a stat zone membership at the start of a standing unit\'s activation', () => {
    const zone: GroundEffect = { key: 'z1', q: 0, r: 0, name: 'Acid Pool', color: '#88ff44', kind: 'ac', delta: -2, duration: 4, turnsLeft: 4, casterTeam: 'blue', casterUnitId: 'caster' };
    const caster = unit('caster', 'blue', h(3, 3));
    const u = unit('u', 'blue'); // stands at (0,0) -> zone
    const res = computeEndTurnEffects({ units: [caster, u], zones: [zone], nextGroup: 'friendly', alliances: groups, makeKey });
    const step = res.subSteps.find(s => s.unitId === 'u');
    expect(step).toBeDefined();
    expect(step!.changes.find(c => c.field === 'currentAc')!.to).toBe(10); // 12 - 2
    const effects = step!.changes.find(c => c.field === 'effects')!.to as UnitEffect[];
    expect(effects.find(e => e.key === 'z1' && e.zoneHex)).toBeDefined();
  });

  it('removes a zone membership once the unit leaves the hex (its own activation)', () => {
    const zone: GroundEffect = { key: 'z1', q: 0, r: 0, name: 'Acid Pool', color: '#88ff44', kind: 'ac', delta: -2, duration: 4, turnsLeft: 4, casterTeam: 'blue', casterUnitId: 'caster' };
    const caster = unit('caster', 'blue', h(3, 3));
    const u = unit('u', 'blue', h(2, 2), {
      currentAc: 10,
      effects: [{ key: 'z1', zoneHex: h(0, 0), name: 'Acid Pool', color: '#88ff44', kind: 'ac', delta: -2, duration: 4, turnsLeft: 4, casterUnitId: 'caster', casterTeam: 'blue', base: 12 }],
    });
    const res = computeEndTurnEffects({ units: [caster, u], zones: [zone], nextGroup: 'friendly', alliances: groups, makeKey });
    const step = res.subSteps.find(s => s.unitId === 'u');
    expect(step!.changes.find(c => c.field === 'currentAc')!.to).toBe(12); // restored
  });

  it('a stat zone expires at 0 on its caster activation: removed + memberships restored', () => {
    const zone: GroundEffect = { key: 'z1', q: 0, r: 0, name: 'Acid Pool', color: '#88ff44', kind: 'ac', delta: -2, duration: 1, turnsLeft: 1, casterTeam: 'blue', casterUnitId: 'caster' };
    const caster = unit('caster', 'blue', h(3, 3));
    const u = unit('u', 'blue', h(0, 0), {
      currentAc: 10,
      effects: [{ key: 'z1', zoneHex: h(0, 0), name: 'Acid Pool', color: '#88ff44', kind: 'ac', delta: -2, duration: 1, turnsLeft: 1, casterUnitId: 'caster', casterTeam: 'blue', base: 12 }],
    });
    const res = computeEndTurnEffects({ units: [caster, u], zones: [zone], nextGroup: 'friendly', alliances: groups, makeKey });
    expect(res.zonesAfter.length).toBe(0);
    const step = res.subSteps.find(s => s.unitId === 'u');
    expect(step!.changes.find(c => c.field === 'currentAc')!.to).toBe(12);
  });

  it('a dot zone deals damage to every standing unit when its caster activates', () => {
    const zone: GroundEffect = { key: 'z9', q: 0, r: 0, name: 'Burning Field', color: '#ff8844', kind: 'dot', delta: 3, duration: 3, turnsLeft: 3, casterTeam: 'blue', casterUnitId: 'caster' };
    const caster = unit('caster', 'blue', h(3, 3));
    const u = unit('u', 'red', h(0, 0));
    const res = computeEndTurnEffects({ units: [caster, u], zones: [zone], nextGroup: 'friendly', alliances: groups, makeKey });
    const step = res.subSteps.find(s => s.unitId === 'u');
    expect(step).toBeDefined();
    expect(step!.changes.find(c => c.field === 'currentUnitHp')!.to).toBe(7);
    expect(res.zonesAfter[0].turnsLeft).toBe(2); // not expired yet
  });
});
