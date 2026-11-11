import { describe, expect, it } from 'vitest';
import {
  advanceShipReload,
  fireShipWeapon,
  pickShipComponent,
  rollShipDamage,
  shipArcAllowed,
  shipAttackMode,
  shipCollisionDamage,
  shipRamDamage,
  shipRangeBand,
  shipTargetArc,
} from '@/packages/ships';
import { HEX_DIRS } from '@/packages/primitives';

const weapon = { minRange: 1, range: 3, maxRange: 10 };

describe('shipRangeBand', () => {
  it('rejects inside minimum and beyond max', () => {
    expect(shipRangeBand(0, weapon)).toBe('tooClose');
    expect(shipRangeBand(1, weapon)).toBe('tooClose');
    expect(shipRangeBand(11, weapon)).toBe('outOfRange');
  });

  it('normal inside range, disadvantage to max', () => {
    expect(shipRangeBand(2, weapon)).toBe('normal');
    expect(shipRangeBand(3, weapon)).toBe('normal');
    expect(shipRangeBand(4, weapon)).toBe('disadvantage');
    expect(shipRangeBand(10, weapon)).toBe('disadvantage');
  });
});

describe('firing arcs', () => {
  const origin = { q: 0, r: 0, s: 0 };
  const at = (dir: number) => ({ q: HEX_DIRS[dir].q, r: HEX_DIRS[dir].r, s: -HEX_DIRS[dir].q - HEX_DIRS[dir].r });

  it('maps front dirs to bow, rear dirs to stern, sides to port/starboard', () => {
    expect(shipTargetArc(origin, 0, at(4))).toBe('bow');
    expect(shipTargetArc(origin, 0, at(5))).toBe('bow');
    expect(shipTargetArc(origin, 0, at(1))).toBe('stern');
    expect(shipTargetArc(origin, 0, at(2))).toBe('stern');
    expect(shipTargetArc(origin, 0, at(3))).toBe('port');
    expect(shipTargetArc(origin, 0, at(0))).toBe('starboard');
  });

  it('respects arc lists, and arcs off is 360', () => {
    expect(shipArcAllowed(['bow'], 'bow')).toBe(true);
    expect(shipArcAllowed(['bow'], 'stern')).toBe(false);
    expect(shipArcAllowed(['bow'], 'stern', false)).toBe(true);
  });

  it('combines range and arc', () => {
    expect(shipAttackMode(2, weapon, ['bow'], origin, 0, at(4)).mode).toBe('normal');
    expect(shipAttackMode(2, weapon, ['stern'], origin, 0, at(4)).mode).toBe('none');
    expect(shipAttackMode(5, weapon, ['bow'], origin, 0, at(4)).mode).toBe('disadvantage');
    expect(shipAttackMode(11, weapon, ['bow'], origin, 0, at(4)).mode).toBe('none');
  });
});

describe('damage formulas', () => {
  it('uses min(floor(ton/10),16)d(speed)', () => {
    expect(shipRamDamage(80, 7)).toEqual({ count: 8, faces: 7 });
    expect(shipRamDamage(400, 9)).toEqual({ count: 16, faces: 9 });
    expect(shipRamDamage(4, 5)).toEqual({ count: 1, faces: 5 });
  });

  it('collision is half the ram dice count (min 1)', () => {
    expect(shipCollisionDamage(80, 7)).toEqual({ count: 4, faces: 7 });
    expect(shipCollisionDamage(4, 5)).toEqual({ count: 1, faces: 5 });
  });

  it('rolls deterministic dice', () => {
    expect(rollShipDamage(2, 6, () => 0)).toBe(2);
    expect(rollShipDamage(2, 6, () => 0.999)).toBe(12);
  });
});

describe('component selection', () => {
  it('weights by tons and skips safe cards', () => {
    const cards = [
      { key: 'hull', name: 'Hull', tons: 10 },
      { key: 'armor', name: 'Armor', tons: 50, safe: true },
      { key: 'weapon', name: 'Ballista', tons: 2, kind: 'weapon' as const },
    ];
    expect(pickShipComponent(cards, () => 0)?.key).toBe('hull');
    expect(pickShipComponent(cards, () => 0.99)?.key).toBe('weapon');
    expect(pickShipComponent([{ key: 'armor', name: 'Armor', tons: 50, safe: true }])).toBeNull();
  });
});

describe('reload', () => {
  it('arms after reloadSteps loading steps', () => {
    let state = { progress: 0, armed: false };
    for (let i = 0; i < 4; i += 1) state = advanceShipReload(state, 4);
    expect(state).toEqual({ progress: 4, armed: true });
  });

  it('reload 0 is armed immediately and firing resets', () => {
    expect(advanceShipReload({ progress: 0, armed: false }, 0)).toEqual({ progress: 0, armed: true });
    expect(fireShipWeapon()).toEqual({ progress: 0, armed: false });
  });

  it('an armed weapon stays armed until fired', () => {
    expect(advanceShipReload({ progress: 4, armed: true }, 4)).toEqual({ progress: 4, armed: true });
  });
});
