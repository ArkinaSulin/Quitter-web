// src/packages/combat/lib/swoop.ts
// Pure "swoop drop" validation shared by the map UI and the AI planner.
import { Unit, Hex, AllianceGroup, Formation } from '@/types/gameProtocol';
import { getSetting } from '@/packages/infra';
import {
  computeChargeReachable,
  flyMax,
  isAirborne,
  isLooseUnit,
  isMoveAffordable,
  isHeroMoveAffordable,
  meleeElevationFor,
  moveBudgetUnit,
  MapStructures,
  structureSurfaceAt,
} from '@/packages/movement';
import { computeOccupiedHexes, computeThreatHexes } from '@/packages/world';
import { facingToward } from '@/packages/primitives';
import { StructureTemplate } from '@/types/structure';
import { isSwooping } from './chargeStance';

export interface SwoopDropPlan {
  landHex: Hex;
  elevation: number;
  cost: number;
  maxMP: number;
  overBudget: boolean;
}

export interface SwoopContext {
  units: Unit[];
  alliances: Record<string, AllianceGroup>;
  formations: Record<string, Formation>;
  structures?: MapStructures;
  structureTemplates?: Record<string, StructureTemplate>;
  archerReactionEnabled?: boolean;
}

/** The swoop plan for this pair, or null when it does not apply. */
export function buildSwoopDropPlan(attacker: Unit, target: Unit, ctx: SwoopContext): SwoopDropPlan | null {
  if (!isSwooping(attacker, structureSurfaceAt(attacker.hex, ctx.structures, ctx.structureTemplates))) return null;
  if (isAirborne(target.elevation, structureSurfaceAt(target.hex, ctx.structures, ctx.structureTemplates))) return null;
  if (target.isDeleted || target.id === attacker.id) return null;
  // v1: the flyer drops alone.
  if (ctx.units.some(u => u.attachedToUnitId === attacker.id && !u.isDeleted)) return null;

  const maxMP = flyMax(attacker);
  const budgetUnit = moveBudgetUnit(attacker, 'fly');
  const occupied = computeOccupiedHexes(ctx.units, attacker.id, 1);
  const threatHexes = computeThreatHexes(ctx.units, attacker.id, ctx.alliances, ctx.formations, ctx.structures, ctx.structureTemplates);
  const loose = isLooseUnit(attacker, ctx.formations[attacker.currentFormation]);
  const facing = loose ? facingToward(attacker.hex, target.hex) : attacker.facing;
  const reach = computeChargeReachable(
    { hex: attacker.hex, facing },
    occupied,
    maxMP,
    undefined,
    undefined,
    threatHexes,
    !!ctx.archerReactionEnabled,
  );
  const cost = reach.get(`${target.hex.q},${target.hex.r}`);
  if (cost == null) return null;
  if ((attacker.chargeDistance ?? 0) + cost < getSetting('charge_full_distance', 2)) return null;
  const affordable = attacker.isHero
    ? isHeroMoveAffordable(budgetUnit, cost, maxMP)
    : isMoveAffordable(budgetUnit, cost, maxMP);
  return {
    landHex: { ...target.hex },
    elevation: meleeElevationFor(attacker.elevation ?? 0, target.elevation ?? 0),
    cost,
    maxMP,
    overBudget: !affordable,
  };
}
