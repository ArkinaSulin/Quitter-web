import { Unit, AllianceGroup } from '@/types/gameProtocol';
import { CommandEntry, CommandLogRow, parseSubSteps, rowToEntry } from '@/lib/commandLog';

export type { CommandLogRow };
export { parseSubSteps, rowToEntry };

export interface ReplayState {
  /** Accumulated per-unit field values keyed by unit id. A PLACE seeds the full unit. */
  units: Record<string, Partial<Unit>>;
  alliances: Record<string, AllianceGroup>;
  /** Scenario-row fields changed via SCENARIO sub-steps (turn state, etc.). */
  scenario: Record<string, unknown>;
}

export interface ReplayStep {
  /** The root entry plus any chained follow-ups (one playback "beat"). */
  entries: CommandEntry[];
  /** Full state after applying this step's entries. */
  state: ReplayState;
}

/**
 * Convert a replay state's unit map into a renderable Unit list. PLACE payloads
 * carry the full unit, and later deltas override specific fields, so each entry
 * with an id is a complete-enough unit for the map pipeline.
 */
export function replayStateToUnits(state: ReplayState): Unit[] {
  return Object.values(state.units).filter((u): u is Unit => !!u.id) as Unit[];
}

/**
 * Build the replay timeline from the command log alone. Replay starts from an
 * empty world and applies the net timeline (soft-deleted / undone rows skipped);
 * each unit is seeded by its full-snapshot PLACE payload, so no baseline is
 * needed. Each step is one command group (a non-chained entry followed by its
 * chained sub-entries). Because sub-steps carry final field deltas, no
 * re-simulation or RNG is needed.
 */
export function buildReplayTimeline(rows: CommandLogRow[]): ReplayStep[] {
  const entries = rows
    .filter(r => !r.deleted_at)
    .map(rowToEntry)
    .sort((a, b) => a.timestamp - b.timestamp);

  const units: Record<string, Partial<Unit>> = {};
  const alliances: Record<string, AllianceGroup> = {};
  const scenario: Record<string, unknown> = {};

  const snapshotState = (): ReplayState => ({
    units: JSON.parse(JSON.stringify(units)) as Record<string, Partial<Unit>>,
    alliances: { ...alliances },
    scenario: { ...scenario },
  });

  const steps: ReplayStep[] = [];
  let i = 0;
  while (i < entries.length) {
    const group: CommandEntry[] = [entries[i]];
    i++;
    while (i < entries.length && entries[i].chained) {
      group.push(entries[i]);
      i++;
    }

    for (const entry of group) {
      for (const step of entry.subSteps) {
        if (step.type === 'PLACE' && step.payload && typeof step.payload === 'object') {
          units[step.unitId] = { ...(step.payload as Partial<Unit>) };
          continue;
        }
        if (step.type === 'ALLIANCE') {
          for (const change of step.changes) {
            alliances[step.unitId] = change.to as AllianceGroup;
          }
          continue;
        }
        if (step.type === 'SCENARIO') {
          for (const change of step.changes) {
            scenario[change.field] = change.to;
          }
          continue;
        }
        for (const change of step.changes) {
          units[step.unitId] = { ...(units[step.unitId] ?? {}), [change.field]: change.to };
        }
      }
    }
    steps.push({ entries: group, state: snapshotState() });
  }
  return steps;
}
