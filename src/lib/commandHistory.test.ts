import { describe, it, expect } from 'vitest';
import { buildReplayTimeline, replayStateToUnits, ReplayState } from './commandHistory';
import { CommandLogRow } from './commandLog';

function makeRow(overrides: Partial<CommandLogRow> = {}): CommandLogRow {
  return {
    id: `id-${Math.random()}`,
    scenario_id: 's1',
    player_id: 'p1',
    player_name: 'Player',
    action_type: 'MOVE',
    description: 'moved',
    sub_steps: [],
    chained: false,
    created_at: '2026-08-02T00:00:00.000Z',
    deleted_at: null,
    seq: 0,
    ...overrides,
  };
}

describe('buildReplayTimeline', () => {
  const placeRow = makeRow({
    id: 'place',
    action_type: 'PLACE',
    description: 'placed',
    created_at: '2026-08-02T00:00:00.000Z',
    sub_steps: [
      {
        type: 'PLACE',
        description: 'Placed Unit #1',
        unitId: 'u1',
        changes: [{ field: 'isDeleted', from: true, to: false }],
        payload: { id: 'u1', unitName: 'Unit #1', hex: { q: 1, r: 0, s: -1 }, team: 'blue', currentUnitHp: 100 },
      },
    ],
  });

  const moveRow = makeRow({
    id: 'move',
    action_type: 'MOVE',
    description: 'moved',
    created_at: '2026-08-02T00:00:01.000Z',
    sub_steps: [
      {
        type: 'MOVE',
        description: 'moved',
        unitId: 'u1',
        changes: [{ field: 'hex', from: { q: 1, r: 0, s: -1 }, to: { q: 2, r: 0, s: -2 } }],
      },
    ],
  });

  it('skips soft-deleted (undone) rows — net timeline', () => {
    const undone = { ...moveRow, id: 'move-undone', deleted_at: '2026-08-02T00:00:02.000Z' };
    const steps = buildReplayTimeline([placeRow, undone]);
    expect(steps).toHaveLength(1);
    expect(steps[0].entries.map(e => e.id)).toEqual(['place']);
    expect(steps[0].state.units.u1?.hex).toEqual({ q: 1, r: 0, s: -1 });
  });

  it('starts from an empty world — PLACE payload seeds the unit, deltas apply on top', () => {
    const steps = buildReplayTimeline([placeRow, moveRow]);
    expect(steps).toHaveLength(2);
    expect(steps[0].state.units.u1?.hex).toEqual({ q: 1, r: 0, s: -1 });
    expect(steps[0].state.units.u1?.unitName).toBe('Unit #1');
    expect(steps[1].state.units.u1?.hex).toEqual({ q: 2, r: 0, s: -2 });
  });

  it('groups a root command with its chained sub-entries into one step', () => {
    const routChain = makeRow({
      id: 'rout',
      action_type: 'ROUT',
      description: 'routed',
      chained: true,
      created_at: '2026-08-02T00:00:02.000Z',
      sub_steps: [
        {
          type: 'ROUT',
          description: 'routed',
          unitId: 'u1',
          changes: [{ field: 'isRouting', from: false, to: true }],
        },
      ],
    });
    const steps = buildReplayTimeline([placeRow, moveRow, routChain]);
    expect(steps).toHaveLength(2);
    expect(steps[1].entries.map(e => e.id)).toEqual(['move', 'rout']);
    expect(steps[1].state.units.u1?.isRouting).toBe(true);
  });
});

describe('replayStateToUnits', () => {
  it('converts the unit map to a renderable list, dropping id-less entries', () => {
    const state: ReplayState = {
      units: {
        u1: { id: 'u1', unitName: 'Unit #1', hex: { q: 1, r: 0, s: -1 } },
        ghost: { unitName: 'No id' },
      },
      alliances: {},
      scenario: {},
    };
    const units = replayStateToUnits(state);
    expect(units).toHaveLength(1);
    expect(units[0].unitName).toBe('Unit #1');
  });
});
