// src/packages/units/lib/warMachine.ts
// Deployed crew-served war machine action budget. A deployed unit has 5 steps
// per turn; Fire auto-loads when needed, and leftover steps auto-load after a
// shot. Moving spends the turn without loading or firing.
export const WAR_MACHINE_STEPS_PER_TURN = 5;

export interface WarMachineState {
  turn: number;
  stepsUsed: number;
  reloadProgress: number;
  armed: boolean;
}

export const EMPTY_WAR_MACHINE_STATE: WarMachineState = {
  turn: 0,
  stepsUsed: 0,
  reloadProgress: 0,
  armed: false,
};

export function normalizeWarMachineState(raw: unknown, turn: number): WarMachineState {
  const o = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  const stateTurn = Math.max(0, Math.floor(Number(o.turn) || 0));
  if (stateTurn !== turn) {
    return { turn, stepsUsed: 0, reloadProgress: 0, armed: false };
  }
  return {
    turn,
    stepsUsed: Math.max(0, Math.min(WAR_MACHINE_STEPS_PER_TURN, Math.floor(Number(o.stepsUsed) || 0))),
    reloadProgress: Math.max(0, Math.floor(Number(o.reloadProgress) || 0)),
    armed: !!o.armed,
  };
}

export function warMachineStepsRemaining(state: WarMachineState): number {
  return Math.max(0, WAR_MACHINE_STEPS_PER_TURN - state.stepsUsed);
}

export interface WarMachineActionResult {
  state: WarMachineState;
  fired: boolean;
  loads: number;
}

/** Load the machine by up to `steps` available card steps. */
export function planWarMachineLoad(
  raw: unknown,
  turn: number,
  reloadSteps: number,
  steps = WAR_MACHINE_STEPS_PER_TURN,
): WarMachineActionResult {
  const state = normalizeWarMachineState(raw, turn);
  if (reloadSteps <= 0 || state.armed) return { state, fired: false, loads: 0 };
  const available = Math.min(steps, warMachineStepsRemaining(state));
  const needed = Math.max(1, Math.floor(reloadSteps) - state.reloadProgress);
  const loads = Math.max(0, Math.min(available, needed));
  const progress = Math.min(Math.max(1, Math.floor(reloadSteps)), state.reloadProgress + loads);
  return {
    state: {
      ...state,
      stepsUsed: state.stepsUsed + loads,
      reloadProgress: progress,
      armed: progress >= Math.max(1, Math.floor(reloadSteps)),
    },
    fired: false,
    loads,
  };
}

/** Fire: load first if needed, fire if armed with a step left, then auto-load leftovers. */
export function planWarMachineFire(
  raw: unknown,
  turn: number,
  reloadSteps: number,
): WarMachineActionResult {
  let state = normalizeWarMachineState(raw, turn);
  const reload = Math.max(0, Math.floor(reloadSteps));
  let loads = 0;
  if (!state.armed && reload > 0) {
    const load = planWarMachineLoad(state, turn, reload, warMachineStepsRemaining(state));
    state = load.state;
    loads += load.loads;
  }
  if (!state.armed || warMachineStepsRemaining(state) <= 0) {
    return { state, fired: false, loads };
  }
  state = {
    ...state,
    stepsUsed: state.stepsUsed + 1,
    armed: false,
    reloadProgress: 0,
  };
  const fired = true;
  if (reload > 0 && warMachineStepsRemaining(state) > 0) {
    const auto = planWarMachineLoad(state, turn, reload, warMachineStepsRemaining(state));
    state = auto.state;
    loads += auto.loads;
  }
  return { state, fired, loads };
}

/** Moving a deployed war machine packs it up; no load/fire happens that turn. */
export function warMachineClearOnMove(raw: unknown, turn: number): WarMachineState {
  return { ...normalizeWarMachineState(raw, turn), stepsUsed: WAR_MACHINE_STEPS_PER_TURN, armed: false, reloadProgress: 0 };
}
