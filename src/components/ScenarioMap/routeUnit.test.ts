import { describe, it, expect, vi } from 'vitest';
import { routeUnit } from './routeUnit';
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
