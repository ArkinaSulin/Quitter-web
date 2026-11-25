// src/packages/ships/lib/shipManning.ts
// Runtime sail/rudder manning. The design snapshot keeps the designed counts;
// this module derives the surviving counts (box damage), the living crew on the
// Sail/Rudder cards, the effective counts, and runtime stats for movement.
import type { Unit } from '@/types/gameProtocol';
import type { ShipRuntime } from './shipRuntime';
import { shipStationCards } from './shipStations';
import { survivingSailRudder } from './shipCombat';
import {
  effectiveSailRudderCounts,
  withEffectiveSailsRudders,
  type ShipDerivedStats,
} from './shipStats';

export interface ShipSailRudderManning {
  /** Physical sails/rudders still standing after box damage. */
  survivingSails: number;
  survivingRudders: number;
  /** Living crew (NPC + heroes) on the Sail/Rudder cards. */
  sailCrew: number;
  rudderCrew: number;
  /** What that crew can actually man (capacity + spare split). */
  effectiveSails: number;
  effectiveRudders: number;
  /** True when crew capacity is below the surviving physical count. */
  undermanned: boolean;
}

const EMPTY: ShipSailRudderManning = {
  survivingSails: 0,
  survivingRudders: 0,
  sailCrew: 0,
  rudderCrew: 0,
  effectiveSails: 0,
  effectiveRudders: 0,
  undermanned: false,
};

/** Living crew + heroes stationed on the surviving Sail/Rudder cards. */
export function shipSailRudderManning(ship: ShipRuntime, units: Unit[]): ShipSailRudderManning {
  const build = ship.snapshot?.build;
  if (!build) return { ...EMPTY };

  const surviving = survivingSailRudder(build, ship.boxState);
  const cards = shipStationCards(build, { boxState: ship.boxState })
    .filter(card => (card.kind === 'sail' || card.kind === 'rudder') && card.crewRequired > 0);

  const counted = new Set<string>();
  let sailCrew = 0;
  let rudderCrew = 0;

  const addCrew = (kind: 'sail' | 'rudder') => {
    if (kind === 'sail') sailCrew += 1;
    else rudderCrew += 1;
  };

  for (const card of cards) {
    const station = ship.stations?.[card.key];
    if (!station) continue;
    const kind = card.kind as 'sail' | 'rudder';

    for (const heroId of [...(station.heroIds ?? []), station.heroId ?? '']) {
      if (!heroId || counted.has(heroId)) continue;
      const hero = units.find(u =>
        u.id === heroId && !u.isDeleted && u.isHero
        && u.attachedToShipId === ship.id && (u.currentUnitHp ?? 1) > 0);
      if (!hero) continue;
      counted.add(heroId);
      addCrew(kind);
    }

    for (const crewId of station.crewIds ?? []) {
      if (counted.has(crewId)) continue;
      if (ship.crewState?.[crewId]?.dead) continue;
      counted.add(crewId);
      addCrew(kind);
    }

    // Legacy rows may store the station on crewState only.
    for (const [crewId, state] of Object.entries(ship.crewState ?? {})) {
      if (state.station !== card.key || state.dead || counted.has(crewId)) continue;
      counted.add(crewId);
      addCrew(kind);
    }
  }

  const effective = effectiveSailRudderCounts(
    surviving.sails,
    surviving.rudders,
    sailCrew,
    rudderCrew,
  );

  return {
    survivingSails: surviving.sails,
    survivingRudders: surviving.rudders,
    sailCrew,
    rudderCrew,
    effectiveSails: effective.sails,
    effectiveRudders: effective.rudders,
    undermanned: effective.sails < surviving.sails || effective.rudders < surviving.rudders,
  };
}

/** Design stats with acceleration/MC recalculated for the current manning. */
export function effectiveShipStats(
  ship: ShipRuntime,
  units: Unit[],
): ShipDerivedStats | null {
  const stats = ship.snapshot?.stats;
  if (!stats) return null;
  const manning = shipSailRudderManning(ship, units);
  return withEffectiveSailsRudders(stats, manning.effectiveSails, manning.effectiveRudders);
}
