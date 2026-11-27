import { describe, expect, it } from 'vitest';
import {
  planWarMachineFire,
  planWarMachineLoad,
  WAR_MACHINE_STEPS_PER_TURN,
  warMachineStepsRemaining,
} from '@/packages/units';
import type { WarMachineState } from '@/packages/units';

const state = (over: Partial<WarMachineState> = {}): WarMachineState => ({
  turn: 3,
  stepsUsed: 0,
  reloadProgress: 0,
  armed: false,
  ...over,
});

describe('deployed war machine steps', () => {
  it('loads up to the available steps', () => {
    const r = planWarMachineLoad(state(), 3, 5);
    expect(r.loads).toBe(5);
    expect(r.state.armed).toBe(true);
    expect(warMachineStepsRemaining(r.state)).toBe(0);
  });

  it('fire loads one step, fires, then auto-loads the rest', () => {
    const r = planWarMachineFire(state(), 3, 3);
    expect(r.fired).toBe(true);
    expect(r.loads).toBe(4); // three loads + one auto-load after firing
    expect(r.state.stepsUsed).toBe(5); // three load steps + fire + one auto-load
  });

  it('does not fire when the load exhausts all five steps', () => {
    const r = planWarMachineFire(state(), 3, 6);
    expect(r.fired).toBe(false);
    expect(r.state.stepsUsed).toBe(WAR_MACHINE_STEPS_PER_TURN);
  });

  it('resets steps when the turn changes', () => {
    const r = planWarMachineFire(state({ turn: 2, stepsUsed: 5, armed: true }), 3, 2);
    expect(r.state.turn).toBe(3);
    expect(r.fired).toBe(true);
  });
});
