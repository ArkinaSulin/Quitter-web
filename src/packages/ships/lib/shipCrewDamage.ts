// src/packages/ships/lib/shipCrewDamage.ts
// Runtime crew targets for penetrating ship-weapon hits. The number of crew hit
// is independent of the component tons destroyed: one roll of 1..maxTargets,
// capped by the living occupants on the struck card.

import type { Unit } from '@/types/gameProtocol';
import type { ShipRuntime } from './shipRuntime';

export interface ShipCrewTarget {
  id: string;
  kind: 'crew' | 'hero';
  name: string;
  hp: number;
}

/** Roll 1..maxTargets; a value of 1 or less always yields one target. */
export function rollMaxTargets(maxTargets: number, rng: () => number = Math.random): number {
  const max = Math.max(1, Math.floor(maxTargets) || 1);
  return 1 + Math.floor(rng() * max);
}

/** Pick `count` distinct entries without replacement. */
export function pickDistinct<T>(items: T[], count: number, rng: () => number = Math.random): T[] {
  const pool = [...items];
  const out: T[] = [];
  const take = Math.max(0, Math.min(Math.floor(count), pool.length));
  for (let i = 0; i < take; i += 1) {
    const index = Math.floor(rng() * pool.length);
    out.push(pool.splice(Math.max(0, Math.min(pool.length - 1, index)), 1)[0]);
  }
  return out;
}

/** Living NPC crew + heroes on one station card. */
export function shipCardCrewTargets(
  ship: ShipRuntime,
  units: Unit[],
  cardKey: string,
): ShipCrewTarget[] {
  const station = ship.stations?.[cardKey];
  if (!station) return [];
  const crews = ship.snapshot?.template?.crews ?? [];
  const out: ShipCrewTarget[] = [];

  for (const crewId of station.crewIds ?? []) {
    const state = ship.crewState?.[crewId];
    if (state?.dead) continue;
    const hp = Math.max(0, Number(state?.hp ?? crews.find(c => c.id === crewId)?.hp ?? 1));
    if (hp <= 0) continue;
    const crew = crews.find(c => c.id === crewId);
    out.push({
      id: crewId,
      kind: 'crew',
      name: crew?.name?.trim() || 'Crew',
      hp,
    });
  }

  const heroIds = new Set([
    ...(station.heroIds ?? []),
    ...(station.heroId ? [station.heroId] : []),
  ]);
  for (const heroId of Array.from(heroIds)) {
    const hero = units.find(u =>
      u.id === heroId
      && !u.isDeleted
      && u.isHero
      && u.attachedToShipId === ship.id
      && (u.currentUnitHp ?? 1) > 0,
    );
    if (!hero) continue;
    out.push({
      id: hero.id,
      kind: 'hero',
      name: hero.unitName,
      hp: hero.currentUnitHp ?? 1,
    });
  }

  return out;
}

/** Number of crew actually hit: min(1..maxTargets roll, living occupants). */
export function shipCrewHitCount(
  maxTargets: number,
  available: number,
  rng: () => number = Math.random,
): number {
  if (available <= 0) return 0;
  return Math.min(rollMaxTargets(maxTargets, rng), available);
}
