// src/components/ScenarioMap/routeUnit.ts
// Shared chained ROUT command builder (combat, magic, reactions).
import { Unit } from '@/types/gameProtocol';
import { ActionType, SubStep, CommandLogRow } from '@/lib/commandLog';

export type ExecuteFn = (
  actionType: ActionType,
  subSteps: SubStep[],
  description: string,
  /** `message` = plain chat override (defaults to `description`); `verboseMessage`
   *  = full verbose text, always recorded and shown when verbose combat is on. */
  options?: { chained?: boolean; message?: string; verboseMessage?: string },
) => Promise<CommandLogRow | null>;

/**
 * Chained ROUT command for a killed/routed unit. `causeId` (the unit that caused
 * the rout, when known) is carried in the sub-step `payload` so the retreat
 * orchestrator can prefer the attacker as pursuer. The server never applies
 * payloads — they are metadata only.
 *
 * A unit that routes WHILE CLIMBING free-falls off the wall first (d6 per 10 ft,
 * down to `climbFallTo`, default 0 = ground) — clearing its climb state — before
 * the normal rout / retreat picker runs.
 */
export async function routeUnit(
  execute: ExecuteFn,
  unit: Unit,
  reason: string,
  killed: boolean,
  causeId?: string | null,
  climbFallTo = 0,
): Promise<void> {
  const name = unit.unitName;
  const verb = !killed ? 'routed' : unit.isHero ? 'down' : 'annihilated';
  const subSteps: SubStep[] = [];

  if (unit.climbTo) {
    const to = Math.max(0, Math.round(climbFallTo));
    const feet = Math.max(0, (unit.elevation ?? 0) - to);
    const n = Math.floor(feet / 10);
    let total = 0;
    const faces: number[] = [];
    for (let i = 0; i < n; i++) {
      const r = 1 + Math.floor(Math.random() * 6);
      faces.push(r);
      total += r;
    }
    subSteps.push({
      type: 'ELEVATE',
      description: `${name} falls off the wall`,
      unitId: unit.id,
      changes: [
        { field: 'elevation', from: unit.elevation ?? 0, to },
        { field: 'climbTo', from: unit.climbTo, to: null },
      ],
    });
    if (total > 0) {
      const newHp = Math.max(0, (unit.currentUnitHp ?? 0) - total);
      const newTroops = Math.max(0, Math.ceil(newHp / Math.max(1, unit.troopHp)));
      subSteps.push({
        type: 'DAMAGE',
        description: `${name} took ${total} falling damage`,
        unitId: unit.id,
        changes: [
          { field: 'currentUnitHp', from: unit.currentUnitHp, to: newHp },
          { field: 'currentTroopCount', from: unit.currentTroopCount, to: newTroops },
        ],
      });
    }
  }

  subSteps.push({
    type: 'ROUT',
    description: `${name} ${verb} (${reason})`,
    unitId: unit.id,
    changes: [{ field: 'currentFormation', from: unit.currentFormation, to: 'Routed' }],
    payload: causeId ? { cause: causeId } : undefined,
  });

  await execute('ROUT', subSteps, `${name} ${verb}!`, { chained: true });
  // Local fallback: tell THIS window a rout happened so the retreat modal opens
  // even if the realtime scenario_command_log event is delayed/missed. The orchestrator
  // dedupes against the live ROUT row via its retreatPick/busy guards.
  if (typeof window !== 'undefined' && !killed) {
    setTimeout(() => {
      window.dispatchEvent(new CustomEvent('quitter:rout', { detail: { unitId: unit.id, causeId: causeId ?? null } }));
    }, 0);
  }
}
