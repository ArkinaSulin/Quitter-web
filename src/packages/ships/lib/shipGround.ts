// src/packages/ships/lib/shipGround.ts
// Ground movement and atmosphere pools for ships. Every ship has a ground MP
// pool: 0 unless it has surviving sails (MP = FP) or terrain legs (authored MP,
// MC 0). MP and FP share depletion at a configurable ratio; grounded moves cost
// MP, takeoff/landing and airborne moves cost FP.
import type { ShipRuntime } from './shipRuntime';
import type { ShipDerivedStats } from './shipStats';
import { componentById } from './shipStats';
import { shipWeaponCards, survivingSailRudder } from './shipCombat';

export interface ShipGroundCapability {
  /** Ground MP (0 = cannot move on the ground). */
  mp: number;
  /** Terrain legs remove the MC facing gate while grounded. */
  mcZero: boolean;
}

/** Ground MP + MC-0 capability from surviving terrain legs / sails. */
export function shipGroundCapability(ship: ShipRuntime): ShipGroundCapability {
  const build = ship.snapshot?.build;
  if (!build) return { mp: 0, mcZero: false };
  let legsMp = 0;
  let legs = false;
  const counts = new Map<string, number>();
  for (const c of build.components ?? []) {
    if (c.terrainLegs && c.builtIn) counts.set(c.id, (counts.get(c.id) ?? 0) + 1);
  }
  for (const row of build.templateComponents ?? []) {
    const c = componentById(build.components, row.componentId);
    if (c.terrainLegs) counts.set(c.id, (counts.get(c.id) ?? 0) + Math.max(1, row.count));
  }
  for (const [id, count] of Array.from(counts.entries())) {
    const c = componentById(build.components, id);
    if (!c.terrainLegs) continue;
    legs = true;
    legsMp += Math.max(0, c.groundMp ?? 0) * count;
  }
  if (legs) return { mp: Math.max(0, legsMp), mcZero: true };
  const sails = survivingSailRudder(build, ship.boxState).sails;
  return { mp: sails > 0 ? Number.POSITIVE_INFINITY : 0, mcZero: false };
}

export interface ShipAtmospherePools {
  mpMax: number;
  fpMax: number;
  mpSpent: number;
  fpSpent: number;
  mpRemaining: number;
  fpRemaining: number;
  mcZero: boolean;
}

/** MP/FP capacities and remaining pools for an atmosphere ship. */
export function shipAtmospherePools(
  ship: ShipRuntime,
  stats: ShipDerivedStats | null | undefined,
): ShipAtmospherePools {
  const fpMax = Math.max(0, stats?.atmosphericSpeed ?? 0);
  const cap = shipGroundCapability(ship);
  const mpMax = Number.isFinite(cap.mp)
    ? cap.mp > 0 ? cap.mp : (cap.mcZero ? 0 : 0)
    : fpMax;
  // Infinity is the sail marker: sails use MP = FP.
  const resolvedMpMax = cap.mp === Number.POSITIVE_INFINITY ? fpMax : mpMax;
  const mpSpent = Math.max(0, ship.mpSpent ?? 0);
  const fpSpent = Math.max(0, ship.fpSpent ?? 0);
  return {
    mpMax: resolvedMpMax,
    fpMax,
    mpSpent,
    fpSpent,
    mpRemaining: Math.max(0, resolvedMpMax - mpSpent),
    fpRemaining: Math.max(0, fpMax - fpSpent),
    mcZero: cap.mcZero,
  };
}

/** The two pools drain together; the passive pool loses floor(active × ratio). */
export function shipAtmosphereSpend(
  pools: Pick<ShipAtmospherePools, 'mpSpent' | 'fpSpent' | 'mpMax' | 'fpMax'>,
  mode: 'mp' | 'fp',
  amount: number,
  ratio = 1,
): { mpSpent: number; fpSpent: number } {
  const cost = Math.max(0, amount);
  const passive = Math.floor(cost * Math.max(0, ratio));
  const mpSpent = mode === 'mp' ? pools.mpSpent + cost : pools.mpSpent + passive;
  const fpSpent = mode === 'fp' ? pools.fpSpent + cost : pools.fpSpent + passive;
  return {
    mpSpent: Math.min(Math.max(0, pools.mpMax), mpSpent),
    fpSpent: Math.min(Math.max(0, pools.fpMax), fpSpent),
  };
}

/** Grounded when the ship sits on the hex surface (ground or structure top). */
export function shipIsGrounded(elevation: number | null | undefined, surface: number | null | undefined): boolean {
  return Math.max(0, Math.round(Number(elevation) || 0)) <= Math.max(0, Math.round(Number(surface) || 0));
}

/** Melee threat from surviving weapon cards (claws use 10 each; 0 = none). */
export function shipMeleeThreat(ship: ShipRuntime): number {
  const build = ship.snapshot?.build;
  if (!build) return 0;
  return shipWeaponCards(build).reduce((sum, card) => {
    const total = Math.max(0, Number(card.tons) || 0);
    const destroyed = Number(ship.boxState?.[card.key] ?? 0);
    if (destroyed >= total && total > 0) return sum;
    return sum + Math.max(0, Math.floor(card.weapon.threat ?? 0));
  }, 0);
}
