// src/packages/ships/lib/shipAccess.ts
// Station-role access for the scenario ship window. Units carry no per-player
// owner, so "my hero" is a hero with the same team as the viewer. The Bridge
// captain (a hero on a full bridge) sees and manages every card; a Helmsman (a
// hero on a Helm) always sees every card, and may manage every card only while
// no captain exists. Any other stationed hero sees/manages only their own card.

import type { Unit } from '@/types/gameProtocol';
import { ShipRuntime } from './shipRuntime';
import { shipStationCards } from './shipStations';
import { shipHitCards } from './shipCombat';

export interface ShipViewerAccess {
  /** DM, captain, or helmsman: every card shows full detail. */
  revealAllCards: boolean;
  /** DM or captain, or a helmsman when no captain exists: manage every card. */
  manageAllCards: boolean;
  /** Card keys the viewer's heroes occupy (used when not reveal-all). */
  visibleCardKeys: string[];
  /** Card keys the viewer may manage (used when not manage-all). */
  manageableCardKeys: string[];
  /** Every bridge card has crew + heroes >= its crew requirement. */
  bridgeFull: boolean;
  /** A hero (any team) sits on a Bridge while every bridge card is full. */
  captainExists: boolean;
}

const EMPTY_ACCESS: ShipViewerAccess = {
  revealAllCards: false,
  manageAllCards: false,
  visibleCardKeys: [],
  manageableCardKeys: [],
  bridgeFull: false,
  captainExists: false,
};

/** Present occupants (crew + heroes) per station card key. */
export function shipPresentByCard(ship: ShipRuntime): Record<string, number> {
  const present: Record<string, number> = {};
  for (const [key, entry] of Object.entries(ship.stations ?? {})) {
    const heroes = new Set([...(entry.heroIds ?? []), ...(entry.heroId ? [entry.heroId] : [])]);
    present[key] = (entry.crewIds?.length ?? 0) + heroes.size;
  }
  return present;
}

export interface ShipHelmOwner {
  hero: Unit | null;
  crewCount: number;
  team: string | null;
}

/** True when the card still has at least one box; missing hit-card data is functional. */
function functionalStationCards(
  ship: ShipRuntime,
  cards: ReturnType<typeof shipStationCards>,
): ReturnType<typeof shipStationCards> {
  const build = ship.snapshot?.build;
  if (!build) return cards;
  const hits = new Map(shipHitCards(build).map(card => [card.key, card.tons]));
  return cards.filter(card => {
    const tons = hits.get(card.key) ?? 0;
    if (tons <= 0) return true;
    return Number(ship.boxState?.[card.key] ?? 0) < tons;
  });
}

/**
 * Canonical helm ownership (docs/dev/21 §7): the first functional helm card with
 * a hero wins; otherwise the first functional helm card with crew uses the ship's
 * crew team; otherwise the ship has no owner. Functional = at least one box left.
 */
export function shipHelmOwner(ship: ShipRuntime, units: Unit[]): ShipHelmOwner {
  const build = ship.snapshot?.build;
  if (!build) return { hero: null, crewCount: 0, team: null };
  const helmCards = functionalStationCards(
    ship,
    shipStationCards(build, { boxState: ship.boxState }).filter(card => card.kind === 'helm'),
  );
  const read = (key: string) => {
    const station = ship.stations?.[key];
    const heroId = station?.heroIds?.[0] ?? station?.heroId;
    const hero = heroId ? units.find(u => u.id === heroId && !u.isDeleted) ?? null : null;
    return { hero, crewCount: station?.crewIds?.length ?? 0 };
  };
  const crewed = helmCards.map(card => ({ key: card.key, ...read(card.key) }));
  const chosen = crewed.find(c => !!c.hero) ?? crewed.find(c => c.crewCount > 0) ?? null;
  if (!chosen) return { hero: null, crewCount: 0, team: null };
  return {
    hero: chosen.hero,
    crewCount: chosen.crewCount,
    team: chosen.hero?.team ?? (chosen.crewCount > 0 ? ship.crewTeam : null),
  };
}

/** The captain: a hero on a Bridge while every functional bridge card is fully crewed. */
export function shipCaptainHero(ship: ShipRuntime, units: Unit[]): Unit | null {
  const build = ship.snapshot?.build;
  if (!build) return null;
  const bridgeCards = functionalStationCards(
    ship,
    shipStationCards(build, { boxState: ship.boxState }).filter(card => card.kind === 'bridge'),
  );
  if (bridgeCards.length === 0) return null;
  const present = shipPresentByCard(ship);
  const bridgeFull = bridgeCards.every(card => (present[card.key] ?? 0) >= card.crewRequired);
  if (!bridgeFull) return null;
  const bridgeKeys = new Set(bridgeCards.map(card => card.key));
  return units.find(u =>
    !u.isDeleted && u.isHero && u.attachedToShipId === ship.id
    && !!u.shipStationKey && bridgeKeys.has(u.shipStationKey),
  ) ?? null;
}

/** The helmsman: a hero on a Helm card. */
export function shipHelmsmanHero(ship: ShipRuntime, units: Unit[]): Unit | null {
  const build = ship.snapshot?.build;
  if (!build) return null;
  const helmKeys = new Set(
    functionalStationCards(
      ship,
      shipStationCards(build, { boxState: ship.boxState }).filter(card => card.kind === 'helm'),
    ).map(card => card.key),
  );
  if (helmKeys.size === 0) return null;
  return units.find(u =>
    !u.isDeleted && u.isHero && u.attachedToShipId === ship.id
    && !!u.shipStationKey && helmKeys.has(u.shipStationKey),
  ) ?? null;
}

/** Captain, else helmsman (the "helmsman as captain backup" rule). */
export function shipCommandHero(ship: ShipRuntime, units: Unit[]): Unit | null {
  return shipCaptainHero(ship, units) ?? shipHelmsmanHero(ship, units);
}

/** Living heroes stationed on a card (no captain/helmsman fallback). */
export function shipHeroesOnCard(ship: ShipRuntime, units: Unit[], cardKey: string): Unit[] {
  return units.filter(u =>
    !u.isDeleted && u.isHero && u.attachedToShipId === ship.id
    && u.shipStationKey === cardKey
    && (u.currentUnitHp ?? 1) > 0,
  );
}

/** Living NPC crew assigned to a card (dead crew do not operate it). */
export function shipCardLivingCrew(ship: ShipRuntime, cardKey: string): number {
  const station = ship.stations?.[cardKey];
  return (station?.crewIds ?? []).filter(id => !ship.crewState?.[id]?.dead).length;
}

/** Operating crew on a card: living NPC crew + living heroes. */
export function shipCardCrewCount(ship: ShipRuntime, units: Unit[], cardKey: string): number {
  return shipCardLivingCrew(ship, cardKey) + shipHeroesOnCard(ship, units, cardKey).length;
}

/** A ship is piloted when at least one functional helm card has a living occupant. */
export function shipHasPilot(ship: ShipRuntime, units: Unit[]): boolean {
  const build = ship.snapshot?.build;
  if (!build) return false;
  const hits = new Map(shipHitCards(build).map(card => [card.key, card.tons]));
  const helmCards = shipStationCards(build, { boxState: ship.boxState }).filter(card => card.kind === 'helm');
  return helmCards.some(card => {
    const tons = hits.get(card.key) ?? 0;
    const destroyed = tons > 0 && Number(ship.boxState?.[card.key] ?? 0) >= tons;
    return !destroyed && shipCardCrewCount(ship, units, card.key) > 0;
  });
}

/**
 * Heroes who pay an action for a card action: every living hero on the card.
 * With no hero on the card, the captain (or helmsman when no captain exists)
 * pays instead. Empty = nobody can afford the action.
 */
export function shipCardFunctionHeroes(ship: ShipRuntime, units: Unit[], cardKey: string): Unit[] {
  const onCard = shipHeroesOnCard(ship, units, cardKey);
  if (onCard.length > 0) return onCard;
  const commandHero = shipCommandHero(ship, units);
  return commandHero ? [commandHero] : [];
}

/**
 * The card leader: the highest-level living hero on the card, else null (the
 * card's NPC crew lead it). Card leader is independent of ship control.
 */
export function shipCardLeaderHero(ship: ShipRuntime, units: Unit[], cardKey: string): Unit | null {
  const heroes = shipHeroesOnCard(ship, units, cardKey);
  if (heroes.length === 0) return null;
  return [...heroes].sort((a, b) => (b.level ?? 0) - (a.level ?? 0))[0] ?? null;
}

/**
 * The side that clocks a card's crew auto-load: the card leader's team, else
 * the NPC crew team. A hero on the card still suppresses auto-load; the team is
 * only the timing source.
 */
export function shipCardLeaderTeam(ship: ShipRuntime, units: Unit[], cardKey: string): string | null {
  const leader = shipCardLeaderHero(ship, units, cardKey);
  return leader?.team ?? ship.crewTeam ?? null;
}

export function shipViewerAccess(
  ship: ShipRuntime,
  units: Unit[],
  myTeam: string | null,
  isGM: boolean,
): ShipViewerAccess {
  const build = ship.snapshot?.build;
  if (!build) {
    return isGM ? { ...EMPTY_ACCESS, revealAllCards: true, manageAllCards: true } : EMPTY_ACCESS;
  }

  const stationCards = shipStationCards(build, { boxState: ship.boxState });
  const present = shipPresentByCard(ship);
  const bridgeCards = functionalStationCards(
    ship,
    stationCards.filter(card => card.kind === 'bridge'),
  );
  const bridgeFull = bridgeCards.length > 0
    && bridgeCards.every(card => (present[card.key] ?? 0) >= card.crewRequired);

  const heroes = units.filter(u => !u.isDeleted && u.isHero && u.attachedToShipId === ship.id);
  const myHeroes = myTeam ? heroes.filter(u => u.team === myTeam) : [];
  const myStationKeys = Array.from(new Set(
    myHeroes.map(u => u.shipStationKey).filter((key): key is string => !!key),
  ));

  const bridgeKeys = new Set(bridgeCards.map(card => card.key));
  const helmKeys = new Set(
    functionalStationCards(
      ship,
      stationCards.filter(card => card.kind === 'helm'),
    ).map(card => card.key),
  );
  const myCaptain = bridgeFull && myHeroes.some(u => u.shipStationKey && bridgeKeys.has(u.shipStationKey));
  const myHelmsman = myHeroes.some(u => u.shipStationKey && helmKeys.has(u.shipStationKey));
  const captainExists = bridgeFull && heroes.some(u => u.shipStationKey && bridgeKeys.has(u.shipStationKey));

  const revealAllCards = isGM || myCaptain || myHelmsman;
  const manageAllCards = isGM || myCaptain || (!captainExists && myHelmsman);

  return {
    revealAllCards,
    manageAllCards,
    visibleCardKeys: revealAllCards ? [] : myStationKeys,
    manageableCardKeys: manageAllCards ? [] : myStationKeys,
    bridgeFull,
    captainExists,
  };
}
