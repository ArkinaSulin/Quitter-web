// src/components/ScenarioMap/routeUnit.ts
// Shared chained ROUT command builder (combat, magic, reactions).
import { Unit } from '@/types/gameProtocol';
import { ActionType, SubStep, CommandLogRow } from '@/packages/infra';
import { unitHasFeatherFall } from '@/packages/effects';
import { canFly, rollFallDamage } from '@/packages/movement';

export type ExecuteFn = (
  actionType: ActionType,
  subSteps: SubStep[],
  description: string,
  /** `message` = plain chat override (defaults to `description`); `verboseMessage`
   *  = full verbose text, always recorded and shown when verbose combat is on. */
  options?: { chained?: boolean; message?: string; verboseMessage?: string },
) => Promise<CommandLogRow | null>;

/**
 * ELEVATE + (per-troop) DAMAGE steps for one unit dropping to elevation `to`.
 * Returns the steps (empty when already at `to`), a one-line note for the message
 * panel, and the post-fall HP/troops (for death routing). `feather_fall` negates
 * the damage (still lands).
 */
export function fallSteps(unit: Unit, to = 0): { steps: SubStep[]; note: string; newHp: number; newTroops: number } {
  const target = Math.max(0, Math.round(to));
  const feet = Math.max(0, (unit.elevation ?? 0) - target);
  let newHp = unit.currentUnitHp ?? 0;
  let newTroops = unit.currentTroopCount;
  if (feet <= 0) return { steps: [], note: '', newHp, newTroops };
  const steps: SubStep[] = [{
    type: 'ELEVATE',
    description: `${unit.unitName} falls to the ground`,
    unitId: unit.id,
    changes: [{ field: 'elevation', from: unit.elevation ?? 0, to: target }],
  }];
  let note = `${unit.unitName} fell ${feet} ft`;
  const n = Math.max(0, Math.floor(feet / 10));
  if (unitHasFeatherFall(unit)) {
    note += ' (Feather Fall — no damage)';
  } else {
    const roll = rollFallDamage(feet);
    const perTroop = roll.total;
    const total = perTroop * Math.max(0, unit.currentTroopCount);
    if (total > 0) {
      const dice = n > 0 ? `(${n}d6: ${roll.faces.join(',')})` : '';
      const breakdown = `${dice} per troop × ${unit.currentTroopCount} = ${total} HP`.trim();
      newHp = Math.max(0, newHp - total);
      newTroops = Math.max(0, Math.ceil(newHp / Math.max(1, unit.troopHp)));
      steps.push({
        type: 'DAMAGE',
        description: `${unit.unitName} fell ${feet} ft — ${breakdown}`,
        unitId: unit.id,
        changes: [
          { field: 'currentUnitHp', from: unit.currentUnitHp, to: newHp },
          { field: 'currentTroopCount', from: unit.currentTroopCount, to: newTroops },
        ],
      });
      note += ` — ${breakdown}`;
    }
  }
  return { steps, note, newHp, newTroops };
}

/**
 * Steps to detach any hero riding `host` when the host is lost (killed or removed):
 * each hero detaches, then falls (per-troop fall damage) if it is airborne and
 * cannot fly. One description per step so the message panel shows each event.
 */
export function hostLostHeroSteps(host: Unit, units: Unit[], fallTo = 0): { steps: SubStep[]; notes: string[] } {
  const steps: SubStep[] = [];
  const notes: string[] = [];
  const heroes = units.filter(u => u.attachedToUnitId === host.id && !u.isDeleted);
  for (const hero of heroes) {
    steps.push({
      type: 'DETACH_HERO',
      description: `${hero.unitName} detaches — ${host.unitName} is gone`,
      unitId: hero.id,
      changes: [
        { field: 'attachedToUnitId', from: hero.attachedToUnitId, to: null },
        { field: 'attachedPosition', from: hero.attachedPosition, to: null },
      ],
    });
    notes.push(`${hero.unitName} detached`);
    if ((hero.elevation ?? 0) > fallTo && !canFly(hero)) {
      const f = fallSteps(hero, fallTo);
      if (f.steps.length > 0) {
        steps.push(...f.steps);
        notes.push(f.note);
      }
    }
  }
  return { steps, notes };
}

/**
 * Chained ROUT command for a killed/routed unit. `causeId` (the unit that caused
 * the rout, when known) is carried in the sub-step `payload` so the retreat
 * orchestrator can prefer the attacker as pursuer. The server never applies
 * payloads — they are metadata only.
 *
 * A unit that routes WHILE CLIMBING free-falls off the wall first (d6 per 10 ft,
 * down to `climbFallTo`, default 0 = ground) — clearing its climb state — before
 * the normal rout / retreat picker runs.
 *
 * When `killed` (not merely routed), any hero riding this unit is auto-detached —
 * and falls if airborne and unable to fly (see `hostLostHeroSteps`). `units` is the
 * live roster used to find the rider.
 */
export async function routeUnit(
  execute: ExecuteFn,
  unit: Unit,
  reason: string,
  killed: boolean,
  causeId?: string | null,
  climbFallTo = 0,
  units: Unit[] = [],
): Promise<void> {
  const name = unit.unitName;
  const verb = !killed ? 'routed' : unit.isHero ? 'down' : 'annihilated';
  const subSteps: SubStep[] = [];
  const notes: string[] = [];

  if (unit.climbTo) {
    const to = Math.max(0, Math.round(climbFallTo));
    const feet = Math.max(0, (unit.elevation ?? 0) - to);
    const n = Math.floor(feet / 10);
    let total = 0;
    const faces: number[] = [];
    if (!unitHasFeatherFall(unit)) {
      for (let i = 0; i < n; i++) {
        const r = 1 + Math.floor(Math.random() * 6);
        faces.push(r);
        total += r;
      }
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

  // Fearless units never enter the Routed formation — a downed fearless hero
  // stays in its own formation (0 HP already renders it as down).
  subSteps.push({
    type: 'ROUT',
    description: `${name} ${verb} (${reason})`,
    unitId: unit.id,
    changes: unit.ignoreMoraleChecks
      ? []
      : [{ field: 'currentFormation', from: unit.currentFormation, to: 'Routed' }],
    payload: causeId ? { cause: causeId } : undefined,
  });

  // A killed/removed unit: a rider killed in air detaches from its mount, any unit
  // killed AIRBORNE drops to elevation 0 in its own hex, and its own riders detach
  // (falling if airborne). Each step is logged.
  if (killed) {
    if (unit.attachedToUnitId) {
      subSteps.push({
        type: 'DETACH_HERO',
        description: `${name} falls off its mount`,
        unitId: unit.id,
        changes: [
          { field: 'attachedToUnitId', from: unit.attachedToUnitId, to: null },
          { field: 'attachedPosition', from: unit.attachedPosition, to: null },
        ],
      });
      notes.push(`${name} detached`);
    }
    // Killed in air (not mid-climb, handled above) → drop to the ground, no damage.
    if (!unit.climbTo && (unit.elevation ?? 0) > 0) {
      subSteps.push({
        type: 'ELEVATE',
        description: `${name} falls to the ground`,
        unitId: unit.id,
        changes: [{ field: 'elevation', from: unit.elevation ?? 0, to: 0 }],
      });
    }
    const lost = hostLostHeroSteps(unit, units, climbFallTo);
    if (lost.steps.length > 0) {
      subSteps.push(...lost.steps);
      notes.push(...lost.notes);
    }
  }

  const message = notes.length > 0 ? `${name} ${verb}! · ${notes.join(' · ')}` : `${name} ${verb}!`;
  await execute('ROUT', subSteps, message, { chained: true });
  // Local fallback: tell THIS window a rout happened so the retreat modal opens
  // even if the realtime scenario_command_log event is delayed/missed. The orchestrator
  // dedupes against the live ROUT row via its retreatPick/busy guards.
  if (typeof window !== 'undefined' && !killed) {
    setTimeout(() => {
      window.dispatchEvent(new CustomEvent('quitter:rout', { detail: { unitId: unit.id, causeId: causeId ?? null } }));
    }, 0);
  }
}
