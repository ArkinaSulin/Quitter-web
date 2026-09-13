import { describe, it, expect } from 'vitest';
import { Unit, AllianceGroup, Formation } from '@/types/gameProtocol';
import { canRally } from './rally';

const h = (q: number, r: number) => ({ q, r, s: -q - r });

function makeUnit(overrides: Partial<Unit> = {}): Unit {
  return {
    id: 'u1', scenarioId: 's1', templateId: null, unitName: 'Test Unit', raceId: '', raceName: '',
    armorName: '', mountId: null, mountName: '', isHero: false, attachedToUnitId: null, attachedPosition: null,
    currentTroopCount: 20, maxTroopCount: 20, level: 5, troopHp: 10, maxUnitHp: 200, currentUnitHp: 200,
    isShielded: false, baselineAc: 14, currentAc: 14, weaponString: '', movementPoints: 3, movementPointsAvailable: 3,
    aggressiveness: 7, baseMorale: 20, currentMoraleModifier: 0, sizeCategory: 100, visualScale: 100,
    currentFormation: 'Routed', formationAvailability: [], equipCostGp: 0, raceIconUrl: '', unitTypeIconUrl: '',
    customImageUrl: '', canCharge: false, ignoreMoraleChecks: false, hex: h(0, 0), facing: 0, team: 'blue',
    hidden: false, isDeleted: false, isCharging: false, chargeDistance: 0, commandSeq: 0, organizationLevel: 0,
    actionsAvailable: 0, attacksUsed: 0, archerReactionUsed: false, partingShotUsed: false, activeWeaponIndex: 0,
    str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0, effects: [],
    ...overrides,
  };
}

const alliances: Record<string, AllianceGroup> = { blue: 'friendly', red: 'enemy' };
const formationsMap = {
  Routed: { name: 'Routed', morale_modifier: 0 } as unknown as Formation,
  Scattered: { name: 'Scattered', morale_modifier: 0 } as unknown as Formation,
  'Open Order': { name: 'Open Order', morale_modifier: 0 } as unknown as Formation,
  Hero: { name: 'Hero', morale_modifier: 0 } as unknown as Formation,
};

describe('canRally', () => {
  it('is unavailable for fearless units', () => {
    const u = makeUnit({ ignoreMoraleChecks: true });
    expect(canRally(u, [u], alliances, formationsMap)).toEqual({ ok: false, reason: 'fearless' });
  });

  it('is unavailable unless currently Routed', () => {
    const u = makeUnit({ currentFormation: 'Open Order' });
    expect(canRally(u, [u], alliances, formationsMap)).toMatchObject({ ok: false, reason: 'not routed' });
  });

  it('is unavailable when destroyed', () => {
    const u = makeUnit({ currentUnitHp: 0 });
    expect(canRally(u, [u], alliances, formationsMap)).toMatchObject({ ok: false, reason: 'destroyed' });
  });

  it('requires positive effective morale', () => {
    const u = makeUnit({ baseMorale: 0 });
    const check = canRally(u, [u], alliances, formationsMap);
    expect(check.ok).toBe(false);
    expect(check.reason).toMatch(/^morale/);
  });

  it('is blocked by an adjacent visible hostile (routed ones still count)', () => {
    const u = makeUnit();
    const enemy = makeUnit({ id: 'e1', team: 'red', hex: h(-1, 0), currentFormation: 'Routed' });
    expect(canRally(u, [u, enemy], alliances, formationsMap)).toMatchObject({ ok: false, reason: 'enemy adjacent' });
  });

  it('ignores hidden hostiles', () => {
    const u = makeUnit();
    const hiddenEnemy = makeUnit({ id: 'e1', team: 'red', hex: h(-1, 0), hidden: true });
    expect(canRally(u, [u, hiddenEnemy], alliances, formationsMap).ok).toBe(true);
  });

  it('rallies a unit to Scattered', () => {
    const u = makeUnit();
    expect(canRally(u, [u], alliances, formationsMap)).toEqual({ ok: true, target: 'Scattered' });
  });

  it('rallies a hero to Hero', () => {
    const hero = makeUnit({ isHero: true });
    expect(canRally(hero, [hero], alliances, formationsMap)).toEqual({ ok: true, target: 'Hero' });
  });
});
