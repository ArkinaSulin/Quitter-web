// src/packages/ships/lib/shipStations.ts
// Canonical crew-station cards for the deck. Mirrors the card capacities that
// ShipLayout renders (combined Sail/Rudder cards use the aggregate crew), so the
// roster, auto-assign and card toggles all agree on who can stand where.

import { ShipBuild } from './shipStats';
import {
  COMPONENT_NAMES,
  componentByName,
  weaponById,
  type CheckStat,
} from './shipStats';
import { findCardKeysForComponent } from './shipRuntime';
import { deckOrderedCardKeys, findCardSlot } from './deckLayout';
import { ShipDeckRegion } from '@/types/ship';
import { survivingSailRudder, shipHitCards } from './shipCombat';

export type ShipStationKind = 'helm' | 'bridge' | 'rudder' | 'sail' | 'weapon';

export interface ShipStationCard {
  key: string;
  name: string;
  crewRequired: number;
  kind: ShipStationKind;
  region?: ShipDeckRegion;
}

export interface ShipStationOptions {
  /** Runtime box damage; omitted = design capacities. */
  boxState?: Record<string, unknown> | null;
}

/**
 * Every stat a station check may use. The Helmsman check uses the higher of
 * Wisdom or Intelligence (docs/dev/21); the other stations have one stat.
 */
export function shipStationStats(kind: ShipStationKind): CheckStat[] {
  switch (kind) {
    case 'helm': return ['wis', 'int'];
    case 'bridge':
    case 'rudder': return ['int'];
    case 'sail': return ['con'];
    case 'weapon': return ['dex'];
  }
}

/** Primary station stat (single-stat shorthand for labels and defaults). */
export function shipStationStat(kind: ShipStationKind): CheckStat {
  return shipStationStats(kind)[0];
}

export function shipStationCheckLabel(kind: ShipStationKind): string {
  switch (kind) {
    case 'helm': return 'Helm';
    case 'bridge': return 'Bridge';
    case 'rudder': return 'Rudder';
    case 'sail': return 'Sail';
    case 'weapon': return 'Weapon';
  }
}

/**
 * Every card that can hold crew for a ship action, in deck render order.
 * Hull/Deck/Cargo are deliberately excluded. Pass `options.boxState` at runtime
 * so destroyed Sail/Rudder boxes shrink the card's crew requirement.
 */
export function shipStationCards(build: ShipBuild, options: ShipStationOptions = {}): ShipStationCard[] {
  const byKey = new Map<string, ShipStationCard>();
  const surviving = survivingSailRudder(build, options.boxState);
  const hitTons = new Map(shipHitCards(build).map(card => [card.key, card.tons]));
  const zeroIfDestroyed = (card: ShipStationCard): ShipStationCard => {
    const tons = hitTons.get(card.key) ?? 0;
    const destroyed = tons > 0 && Number(options.boxState?.[card.key] ?? 0) >= tons;
    return destroyed ? { ...card, crewRequired: 0 } : card;
  };

  const addComponents = (name: string, kind: ShipStationKind, capacity: number) => {
    for (const key of findCardKeysForComponent(build, name)) {
      byKey.set(key, { key, name, crewRequired: Math.max(0, Math.ceil(capacity)), kind });
    }
  };

  if (build.helm > 0) {
    const comp = componentByName(build.components, COMPONENT_NAMES.helm);
    addComponents('Helm', 'helm', Math.ceil(comp.crew));
  }
  if (build.commandBridge > 0) {
    const comp = componentByName(build.components, COMPONENT_NAMES.commandBridge);
    addComponents(COMPONENT_NAMES.commandBridge, 'bridge', Math.ceil(comp.crew));
    for (const card of Array.from(byKey.values())) {
      if (card.kind === 'bridge') card.name = 'Bridge';
    }
  }
  if (build.sails > 0) {
    const sail = componentByName(build.components, COMPONENT_NAMES.sail);
    const sailTons = Math.max(1, Math.round(sail.mass || 1));
    const aggregateCrew = surviving.sails > 0
      ? Math.max(1, Math.ceil(surviving.sails / 4))
      : 0;
    for (const key of findCardKeysForComponent(build, 'Sail')) {
      const perUnit = /:\d+$/.test(key.slice('component:'.length));
      const destroyed = Math.max(0, Number(options.boxState?.[key] ?? 0));
      byKey.set(key, {
        key,
        name: 'Sail',
        crewRequired: perUnit ? (destroyed < sailTons ? 1 : 0) : aggregateCrew,
        kind: 'sail',
      });
    }
  }
  if (build.rudders > 0) {
    const comp = componentByName(build.components, COMPONENT_NAMES.rudder);
    const rudderTons = Math.max(1, Math.round(comp.mass || 1.5));
    const aggregateCrew = surviving.rudders > 0
      ? Math.max(1, Math.ceil(surviving.rudders / 2))
      : 0;
    for (const key of findCardKeysForComponent(build, 'Rudder')) {
      const perUnit = /:\d+$/.test(key.slice('component:'.length));
      const destroyed = Math.max(0, Number(options.boxState?.[key] ?? 0));
      byKey.set(key, {
        key,
        name: 'Rudder',
        crewRequired: perUnit
          ? (destroyed < rudderTons ? Math.max(1, Math.ceil(comp.crew)) : 0)
          : aggregateCrew,
        kind: 'rudder',
      });
    }
  }

  for (const row of build.templateWeapons) {
    const weapon = weaponById(build.weaponsCatalog, row.weaponId);
    if (!weapon) continue;
    for (let i = 0; i < row.count; i += 1) {
      const key = `weapon:${row.id}:${i}`;
      byKey.set(key, {
        key,
        name: weapon.name || 'Weapon',
        crewRequired: Math.max(0, Math.ceil(weapon.crew)),
        kind: 'weapon',
      });
    }
  }

  if (!build.deckLayout) return Array.from(byKey.values()).map(zeroIfDestroyed);
  const layout = build.deckLayout;
  const ordered = deckOrderedCardKeys(layout)
    .map(key => byKey.get(key))
    .filter((card): card is ShipStationCard => !!card)
    .map(card => ({
      ...zeroIfDestroyed(card),
      region: findCardSlot(layout, card.key)?.region,
    }));
  const seen = new Set(ordered.map(card => card.key));
  for (const card of Array.from(byKey.values())) {
    if (!seen.has(card.key)) ordered.push({ ...zeroIfDestroyed(card), region: findCardSlot(layout, card.key)?.region });
  }
  return ordered;
}

/**
 * A vacated station pulls exactly one reserve crew only when exactly one slot is
 * free. Zero free slots (full) and two or more free slots (a partial or empty
 * multi-slot card) never auto-pull. Hull/Deck/Cargo use infinite/zero capacities
 * and therefore never qualify.
 */
export function needsStationReplacement(capacity: number, occupants: number): boolean {
  if (!Number.isFinite(capacity) || capacity <= 0) return false;
  const empty = capacity - Math.max(0, occupants);
  return empty === 1;
}
