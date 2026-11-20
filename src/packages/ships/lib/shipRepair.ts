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
