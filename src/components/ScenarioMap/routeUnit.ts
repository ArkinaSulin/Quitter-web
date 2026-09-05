// src/components/ScenarioMap/routeUnit.ts
// Shared chained ROUT command builder (combat, magic, reactions).
import { Unit } from '@/types/gameProtocol';
import { ActionType, SubStep, CommandLogRow } from '@/lib/commandLog';

export type ExecuteFn = (
  actionType: ActionType,
  subSteps: SubStep[],
  description: string,
  options?: { chained?: boolean; message?: string },
) => Promise<CommandLogRow | null>;

/**
 * Chained ROUT command for a killed/routed unit. `causeId` (the unit that caused
 * the rout, when known) is carried in the sub-step `payload` so the retreat
 * orchestrator can prefer the attacker as pursuer. The server never applies
 * payloads — they are metadata only.
 */
export async function routeUnit(execute: ExecuteFn, unit: Unit, reason: string, killed: boolean, causeId?: string | null): Promise<void> {
  const name = unit.unitName;
  const verb = !killed ? 'routed' : unit.isHero ? 'down' : 'annihilated';
  await execute('ROUT', [{
    type: 'ROUT',
    description: `${name} ${verb} (${reason})`,
    unitId: unit.id,
    changes: [{ field: 'currentFormation', from: unit.currentFormation, to: 'Routed' }],
    payload: causeId ? { cause: causeId } : undefined,
  }], `${name} ${verb}!`, { chained: true });
}
