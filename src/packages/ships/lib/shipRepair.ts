// src/packages/ships/lib/shipRepair.ts
// Repair helpers: damaged deck cards, hull-destruction HP clamp, and the
// combined hull-HP / one-box repair outcome. Pure math; the engine slice in
// ScenarioMap wires these into a SHIP command.

import { ShipBuild } from './shipStats';
import { ShipHitCard, shipHitCards } from './shipCombat';
import { ShipSnapshot, shipHullDestroyed } from './shipRuntime';

/**
 * Every card that currently has at least one destroyed box. Hull is included:
 * a partially damaged hull can have one box restored, but a fully destroyed
 * hull has no repair station (see `shipHullDestroyed`).
 */
export function shipDamagedCards(
  build: ShipBuild,
  boxState: Record<string, unknown> | null | undefined,
): ShipHitCard[] {
  return shipHitCards(build).filter(card => Number(boxState?.[card.key] ?? 0) > 0);
}

/** Restore one box on a card (never below 0). Returns a new box-state map. */
export function repairOneBox(
  boxState: Record<string, unknown>,
  cardKey: string,
): Record<string, unknown> {
  const next = { ...boxState };
  const destroyed = Math.max(0, Number(next[cardKey] ?? 0));
  if (destroyed <= 0) return next;
  if (destroyed === 1) delete next[cardKey];
  else next[cardKey] = destroyed - 1;
  return next;
}

/** Hull HP repair cap: 80% of max. */
export function repairHpCap(shipHpMax: number): number {
  return Math.floor(Math.max(0, shipHpMax) * 0.8);
}

/**
 * Lowest HP the ship has reached. Field repair kits raise current HP but never
 * this value; only a dry-dock Save resets it to the new maximum.
 */
export function minHpAfterDamage(
  previousMin: number | null | undefined,
  newHp: number,
): number {
  const hp = Math.max(0, Math.round(Number(newHp) || 0));
  const min = previousMin == null ? hp : Math.max(0, Math.round(Number(previousMin) || 0));
  return Math.min(min, hp);
}

export interface ShipPatchDamage {
  /** HP currently covered by an emergency field patch. */
  patchedHp: number;
  /** Underlying damage from the worst point to full HP. */
  damageHp: number;
  currentHp: number;
  minHp: number;
  maxHp: number;
}

/**
 * Dry-dock repair amounts. The crew patched the ship up with repair kits, so the
 * dock must strip the patch (current above the worst point) and then repair the
 * real damage (worst point to max).
 */
export function computeShipPatchDamage(args: {
  currentHp: number;
  minHp: number | null | undefined;
  maxHp: number;
}): ShipPatchDamage {
  const maxHp = Math.max(0, Math.round(Number(args.maxHp) || 0));
  const currentHp = Math.max(0, Math.min(maxHp, Math.round(Number(args.currentHp) || 0)));
  const minHp = args.minHp == null
    ? currentHp
    : Math.max(0, Math.min(maxHp, Math.round(Number(args.minHp) || 0)));
  return {
    currentHp,
    minHp,
    maxHp,
    patchedHp: Math.max(0, currentHp - minHp),
    damageHp: Math.max(0, maxHp - minHp),
  };
}

/**
 * Whether a repair would change anything: HP below the 80% cap, or at least one
 * destroyed box on a card. A fully destroyed hull cannot be repaired.
 */
export function shipHasRepairableDamage(
  snapshot: ShipSnapshot | null | undefined,
  boxState: Record<string, unknown> | null | undefined,
  shipHp: number,
  shipHpMax: number,
): boolean {
  const build = snapshot?.build;
  if (!build) return false;
  if (shipHullDestroyed(snapshot, boxState)) return false;
  if (shipHp < repairHpCap(shipHpMax)) return true;
  return shipDamagedCards(build, boxState).length > 0;
}
