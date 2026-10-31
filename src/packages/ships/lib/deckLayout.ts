// src/packages/ships/lib/deckLayout.ts
// Pure region-container deck layout. Slots are generic; the only special slot is
// the fixed Ram slot in Bow slot 1. Purchases are synced into free slots without
// disturbing manual placements; a full middle row grows Port/Body/Starboard.

import { ShipDeckLayout, ShipDeckRegion, ShipDeckSlot } from '@/types/ship';

export interface DeckCard {
  key: string;
  kind: 'component' | 'weapon';
  ram?: boolean;
}

export const DECK_REGION_LABELS: Record<ShipDeckRegion, string> = {
  bow: 'Bow',
  stern: 'Stern',
  port: 'Port',
  body: 'Body',
  starboard: 'Starboard',
};

export const DECK_REGIONS: ShipDeckRegion[] = ['bow', 'stern', 'port', 'body', 'starboard'];

function slot(ram = false): ShipDeckSlot {
  return ram ? { cardKey: null, ram: true } : { cardKey: null };
}

export function createDefaultDeckLayout(): ShipDeckLayout {
  return {
    bow: [slot(), slot(true), slot(), slot(), slot(), slot()],
    stern: [slot(), slot(), slot(), slot(), slot(), slot()],
    port: [slot(), slot(), slot(), slot(), slot()],
    body: [slot(), slot(), slot(), slot(), slot()],
    starboard: [slot(), slot(), slot(), slot(), slot()],
  };
}

export function cloneDeckLayout(layout: ShipDeckLayout): ShipDeckLayout {
  return {
    bow: layout.bow.map(s => ({ ...s })),
    stern: layout.stern.map(s => ({ ...s })),
    port: layout.port.map(s => ({ ...s })),
    body: layout.body.map(s => ({ ...s })),
    starboard: layout.starboard.map(s => ({ ...s })),
  };
}

/** Restore the fixed Ram slot to Bow index 1 and normalize every region. */
export function normalizeDeckLayout(raw?: Partial<ShipDeckLayout> | null): ShipDeckLayout {
  if (!raw || !Array.isArray(raw.bow) || raw.bow.length === 0) {
    return createDefaultDeckLayout();
  }
  const layout: ShipDeckLayout = {
    bow: (raw.bow || []).map(s => ({ ...s, cardKey: s?.cardKey ?? null, ram: false })),
    stern: (raw.stern || []).map(s => ({ ...s, cardKey: s?.cardKey ?? null, ram: false })),
    port: (raw.port || []).map(s => ({ ...s, cardKey: s?.cardKey ?? null, ram: false })),
    body: (raw.body || []).map(s => ({ ...s, cardKey: s?.cardKey ?? null, ram: false })),
    starboard: (raw.starboard || []).map(s => ({ ...s, cardKey: s?.cardKey ?? null, ram: false })),
  };
  if (layout.bow.length < 2) layout.bow.push(slot());
  layout.bow[1].ram = true;
  return layout;
}

export function findCardSlot(
  layout: ShipDeckLayout,
  cardKey: string,
): { region: ShipDeckRegion; index: number; slot: ShipDeckSlot } | null {
  for (const region of DECK_REGIONS) {
    const index = layout[region].findIndex(s => s.cardKey === cardKey);
    if (index >= 0) return { region, index, slot: layout[region][index] };
  }
  return null;
}

function regionHasCard(layout: ShipDeckLayout, region: ShipDeckRegion, cardKey: string): boolean {
  return layout[region].some(s => s.cardKey === cardKey);
}

function firstFree(
  layout: ShipDeckLayout,
  regions: ShipDeckRegion[],
  allowRam = false,
): { region: ShipDeckRegion; index: number } | null {
  for (const region of regions) {
    for (let index = 0; index < layout[region].length; index += 1) {
      const s = layout[region][index];
      if (!s.cardKey && (allowRam || !s.ram)) return { region, index };
    }
  }
  return null;
}

export function addMiddleRow(layout: ShipDeckLayout): void {
  layout.port.push(slot());
  layout.body.push(slot());
  layout.starboard.push(slot());
}

function placeCard(
  layout: ShipDeckLayout,
  card: DeckCard,
  preferred: ShipDeckRegion[],
): boolean {
  if (card.ram) {
    if (!layout.bow[1].cardKey) {
      layout.bow[1].cardKey = card.key;
      return true;
    }
    return false;
  }
  let empty = firstFree(layout, preferred);
  if (!empty) {
    const all: ShipDeckRegion[] = ['body', 'port', 'starboard', 'bow', 'stern'];
    empty = firstFree(layout, all);
  }
  if (!empty) {
    addMiddleRow(layout);
    empty = firstFree(layout, ['body', 'port', 'starboard']);
  }
  if (!empty) return false;
  layout[empty.region][empty.index].cardKey = card.key;
  return true;
}

/**
 * Preserve manual placements, drop removed cards, enforce the Ram rule, and place
 * every new card. Weapons prefer Bow/Stern; components prefer Body/Port/Starboard.
 */
export function syncDeckLayout(
  raw: Partial<ShipDeckLayout> | null | undefined,
  cards: DeckCard[],
): ShipDeckLayout {
  const layout = normalizeDeckLayout(raw);
  const byKey = new Map(cards.map(c => [c.key, c]));
  const seen = new Set<string>();

  for (const region of DECK_REGIONS) {
    for (const s of layout[region]) {
      if (!s.cardKey) continue;
      if (!byKey.has(s.cardKey) || seen.has(s.cardKey)) {
        s.cardKey = null;
        continue;
      }
      seen.add(s.cardKey);
    }
  }

  // Ram rule: only ram weapons in Bow[1]; every other card must leave it.
  const ramSlot = layout.bow[1];
  if (ramSlot.cardKey && !byKey.get(ramSlot.cardKey)?.ram) {
    ramSlot.cardKey = null;
  }
  for (const region of DECK_REGIONS) {
    for (const s of layout[region]) {
      if (s.ram) continue;
      const card = byKey.get(s.cardKey || '');
      if (card?.ram) s.cardKey = null;
    }
  }

  const placed = new Set<string>();
  for (const region of DECK_REGIONS) {
    for (const s of layout[region]) if (s.cardKey) placed.add(s.cardKey);
  }

  for (const card of cards) {
    if (placed.has(card.key)) continue;
    const preferred: ShipDeckRegion[] = card.kind === 'weapon'
      ? ['bow', 'stern', 'body', 'port', 'starboard']
      : ['body', 'port', 'starboard', 'bow', 'stern'];
    if (placeCard(layout, card, preferred)) placed.add(card.key);
  }

  return layout;
}

/** Swap two slots' cards. The caller enforces the Ram-slot rules. */
export function swapCards(
  layout: ShipDeckLayout,
  from: { region: ShipDeckRegion; index: number },
  to: { region: ShipDeckRegion; index: number },
): ShipDeckLayout {
  const next = cloneDeckLayout(layout);
  const a = next[from.region][from.index];
  const b = next[to.region][to.index];
  if (!a || !b) return next;
  const tmp = a.cardKey;
  a.cardKey = b.cardKey;
  b.cardKey = tmp;
  return next;
}

/**
 * Move a whole slot (and its card) to another region. The fixed Ram slot cannot
 * move. When a Bow slot leaves, the Ram slot is restored to Bow index 1.
 */
export function moveSlotToRegion(
  layout: ShipDeckLayout,
  region: ShipDeckRegion,
  index: number,
  target: ShipDeckRegion,
): ShipDeckLayout {
  const next = cloneDeckLayout(layout);
  const source = next[region][index];
  if (!source || source.ram) return next;
  next[region].splice(index, 1);
  next[target].push(source);
  if (region === 'bow' || target === 'bow') {
    const ramIndex = next.bow.findIndex(s => s.ram);
    if (ramIndex >= 0 && ramIndex !== 1) {
      const [ram] = next.bow.splice(ramIndex, 1);
      next.bow.splice(1, 0, ram);
    }
  }
  return next;
}

/** Direction implied by the slot's region; Ram overrides to the Bow arc. */
export function deckDirection(
  layout: ShipDeckLayout,
  cardKey: string,
): 'Fore' | 'Rear' | 'Left' | 'Right' | '360' | 'Ram' | '—' {
  const found = findCardSlot(layout, cardKey);
  if (!found) return '—';
  if (found.slot.ram) return 'Ram';
  return {
    bow: 'Fore',
    stern: 'Rear',
    port: 'Left',
    starboard: 'Right',
    body: '360',
  }[found.region] as 'Fore' | 'Rear' | 'Left' | 'Right' | '360';
}

/** Render-order card keys for the crew preview. */
export function deckOrderedCardKeys(layout: ShipDeckLayout): string[] {
  const keys: string[] = [];
  for (const s of layout.bow) if (s.cardKey) keys.push(s.cardKey);
  const middle = Math.max(layout.port.length, layout.body.length, layout.starboard.length);
  for (let i = 0; i < middle; i += 1) {
    for (const region of ['port', 'body', 'starboard'] as const) {
      const key = layout[region][i]?.cardKey;
      if (key) keys.push(key);
    }
  }
  for (const s of layout.stern) if (s.cardKey) keys.push(s.cardKey);
  return keys;
}

export function isRamSlot(layout: ShipDeckLayout, region: ShipDeckRegion, index: number): boolean {
  return !!layout[region][index]?.ram;
}

export function hasCard(layout: ShipDeckLayout, cardKey: string): boolean {
  return DECK_REGIONS.some(region => regionHasCard(layout, region, cardKey));
}
