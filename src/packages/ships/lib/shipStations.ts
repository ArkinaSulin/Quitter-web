// src/packages/ships/lib/shipStations.ts
// Canonical crew-station cards for the deck. Mirrors the card capacities that
// ShipLayout renders (combined Sail/Rudder cards use the aggregate crew), so the
// roster, auto-assign and card toggles all agree on who can stand where.

import { ShipBuild } from './shipStats';
import { COMPONENT_NAMES, componentByName, weaponById } from './shipStats';
import { findCardKeysForComponent } from './shipRuntime';
import { deckOrderedCardKeys, findCardSlot } from './deckLayout';
import { ShipDeckRegion } from '@/types/ship';

export type ShipStationKind = 'helm' | 'bridge' | 'rudder' | 'sail' | 'weapon';

export interface ShipStationCard {
  key: string;
  name: string;
  crewRequired: number;
  kind: ShipStationKind;
  region?: ShipDeckRegion;
}

export function shipStationStat(kind: ShipStationKind): 'dex' | 'int' | 'wis' | 'con' {
  switch (kind) {
    case 'helm': return 'wis';
    case 'bridge':
    case 'rudder': return 'int';
    case 'sail': return 'con';
    case 'weapon': return 'dex';
  }
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
 * Hull/Deck/Cargo are deliberately excluded.
 */
export function shipStationCards(build: ShipBuild): ShipStationCard[] {
  const byKey = new Map<string, ShipStationCard>();

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
    // ShipLayout gives every Sail card the same aggregate crew (combined or not).
    const aggregate = Math.max(1, Math.floor(build.sails / 4));
    addComponents('Sail', 'sail', aggregate);
  }
  if (build.rudders > 0) {
    const comp = componentByName(build.components, COMPONENT_NAMES.rudder);
    const aggregate = Math.max(1, Math.ceil(build.rudders / 2));
    addComponents('Rudder', 'rudder', comp.canCombine ? aggregate : Math.ceil(comp.crew));
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

  if (!build.deckLayout) return Array.from(byKey.values());
  const layout = build.deckLayout;
  const ordered = deckOrderedCardKeys(layout)
    .map(key => byKey.get(key))
    .filter((card): card is ShipStationCard => !!card)
    .map(card => ({
      ...card,
      region: findCardSlot(layout, card.key)?.region,
    }));
  const seen = new Set(ordered.map(card => card.key));
  for (const card of Array.from(byKey.values())) {
    if (!seen.has(card.key)) ordered.push({ ...card, region: findCardSlot(layout, card.key)?.region });
  }
  return ordered;
}
