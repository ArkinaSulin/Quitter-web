import { describe, it, expect, vi } from 'vitest';
import { routeUnit, hostLostHeroSteps, detachOnDeath } from './routeUnit';
import { Unit } from '@/types/gameProtocol';
import { ActionType, SubStep } from '@/packages/infra';

const unit = (over: Partial<Unit> = {}): Unit => ({
  id: 'u1', unitName: 'Arc', isHero: false, currentFormation: 'Open Order',
  ignoreMoraleChecks: false, elevation: 0, climbTo: null, currentUnitHp: 0,
  currentTroopCount: 0, troopHp: 1, hex: { q: 0, r: 0, s: 0 }, isDeleted: false,
  ...over,
} as unknown as Unit);

const capture = () => {
  const calls: { type: ActionType; steps: SubStep[] }[] = [];
  const execute = vi.fn(async (type: ActionType, steps: SubStep[]) => {
    calls.push({ type, steps });
    return null;
  });
  return { execute, calls };
};

describe('routeUnit — fearless guard', () => {
  it('does NOT set the Routed formation on a fearless unit', async () => {
    const { execute, calls } = capture();
    await routeUnit(execute as any, unit({ ignoreMoraleChecks: true, currentFormation: 'Hero' }), 'killed', true);
    const rout = calls.find(c => c.type === 'ROUT')!;
    const formationChange = rout.steps.flatMap(s => s.changes).find(c => c.field === 'currentFormation');
    expect(formationChange).toBeUndefined();
  });

  it('sets the Routed formation on a non-fearless unit', async () => {
    const { execute, calls } = capture();
    await routeUnit(execute as any, unit({ ignoreMoraleChecks: false }), 'broke', false);
    const rout = calls.find(c => c.type === 'ROUT')!;
    const formationChange = rout.steps.flatMap(s => s.changes).find(c => c.field === 'currentFormation');
    expect(formationChange).toEqual({ field: 'currentFormation', from: 'Open Order', to: 'Routed' });
  });
});

describe('hostLostHeroSteps — rider auto-detach on host loss', () => {
  it('detaches an airborne non-flying rider and makes it fall (per-troop damage)', () => {
    const host = unit({ id: 'host' });
    const hero = unit({
      id: 'hero', isHero: true, attachedToUnitId: 'host', attachedPosition: 'front',
      elevation: 20, flySpeed: 0, currentUnitHp: 10, troopHp: 1, currentTroopCount: 10,
    });
    const { steps, notes } = hostLostHeroSteps(host, [host, hero], 0);
    expect(steps.some(s => s.type === 'DETACH_HERO')).toBe(true);
    expect(steps.some(s => s.type === 'ELEVATE')).toBe(true);
    expect(steps.some(s => s.type === 'DAMAGE')).toBe(true);
    expect(notes.some(n => n.includes('detached'))).toBe(true);
  });

  it('detaches a flyer but does not make it fall', () => {
    const host = unit({ id: 'host' });
    const hero = unit({ id: 'hero', isHero: true, attachedToUnitId: 'host', elevation: 20, flySpeed: 6 });
    const { steps } = hostLostHeroSteps(host, [host, hero], 0);
    expect(steps.some(s => s.type === 'DETACH_HERO')).toBe(true);
    expect(steps.some(s => s.type === 'ELEVATE')).toBe(false);
  });
});

describe('routeUnit — killed in the air', () => {
  it('drops an airborne killed unit to elevation 0 in its own hex', async () => {
    const { execute, calls } = capture();
    await routeUnit(execute as any, unit({ elevation: 20, flySpeed: 6 }), 'slain', true);
    const rout = calls.find(c => c.type === 'ROUT')!;
    const elev = rout.steps.find(s => s.type === 'ELEVATE');
    expect(elev?.changes).toEqual([{ field: 'elevation', from: 20, to: 0 }]);
  });

  it('detaches a rider killed while attached', async () => {
    const { execute, calls } = capture();
    await routeUnit(execute as any, unit({ elevation: 20, attachedToUnitId: 'mount', attachedPosition: 'rider' }), 'slain', true);
    const rout = calls.find(c => c.type === 'ROUT')!;
    const detach = rout.steps.find(s => s.type === 'DETACH_HERO');
    expect(detach?.changes).toEqual([
      { field: 'attachedToUnitId', from: 'mount', to: null },
      { field: 'attachedPosition', from: 'rider', to: null },
    ]);
  });
});

describe('detachOnDeath — the single check for both ends of a link', () => {
  it('detaches the dying unit itself AND its own riders', () => {
    const mount = unit({ id: 'mount' });
    const rider = unit({
      id: 'rider', isHero: true, attachedToUnitId: 'mount', attachedPosition: 'rider',
      elevation: 10, flySpeed: 0, currentUnitHp: 5, troopHp: 1, currentTroopCount: 5,
    });
    const passenger = unit({
      id: 'passenger', isHero: true, attachedToUnitId: 'rider', attachedPosition: 'back',
      elevation: 10, flySpeed: 0, currentUnitHp: 5, troopHp: 1, currentTroopCount: 5,
    });
    const { steps, notes } = detachOnDeath(rider, [mount, rider, passenger], 0);
    const detaches = steps.filter(s => s.type === 'DETACH_HERO');
    expect(detaches).toHaveLength(2); // itself (off mount) + its passenger
    expect(notes.some(n => n.includes('detached'))).toBe(true);
  });
});
