// src/packages/combat/lib/protectedHero.ts
// A back-attached ("Protected") hero sits behind its host unit. It has no line
// of sight forward, so it may only attack or reaction-fire into the HOST's REAR
// cone — the exposed side. These pure helpers define that cone once, shared by
// the active-attack gate and the archer-reaction logic.
import { Unit, Hex } from '@/types/gameProtocol';
import { arcOf, arcOfTarget } from '@/packages/primitives';

/** The live host a hero is attached to, or null (unknown/deleted host). */
export function protectedHeroHost(hero: Pick<Unit, 'attachedToUnitId'>, units: Unit[]): Unit | null {
  if (!hero.attachedToUnitId) return null;
  return units.find(u => u.id === hero.attachedToUnitId && !u.isDeleted) ?? null;
}

/**
 * Is `targetHex` inside the host's REAR cone — the only direction a back-attached
 * (Protected) hero may attack into? Ranged uses the 120° rear bearing sector
 * (`arcOfTarget`); melee uses the host's two rear-adjacent hexes (`arcOf`).
 */
export function inHostRearCone(host: Pick<Unit, 'hex' | 'facing'>, targetHex: Hex, isRanged: boolean): boolean {
  return isRanged
    ? arcOfTarget(host.hex, host.facing, targetHex) === 'rear'
    : arcOf(host.hex, host.facing, targetHex) === 'rear';
}
