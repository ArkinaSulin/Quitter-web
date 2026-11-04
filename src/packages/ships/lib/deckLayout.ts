// src/packages/ships/lib/deckLayout.ts
// Pure region-container deck layout. Slots are generic. Purchases are synced
// into free slots without disturbing manual placements; a full middle row grows
// Port/Body/Starboard, with Body keeping its two columns.

import { ShipDeckLayout, ShipDeckRegion, ShipDeckSlot } from '@/types/ship';

export interface DeckCard {
  key: string;
  kind: 'component' | 'weapon';
}

export const DECK_REGION_LABELS: Record<ShipDeckRegion, string> = {
  bow: 'Bow',
  stern: 'Stern',
  port: 'Port',
  body: 'Body',
  starboard: 'Starboard',
};

export const DECK_REGIONS: ShipDeckRegion[] = ['bow', 'stern', 'port', 'body', 'starboard'];

function slot(): ShipDeckSlot {
  return { cardKey: null };
}

export function createDefaultDeckLayout(): ShipDeckLayout {
  return {
    version: 2,
    bow: [slot(), slot(), slot(), slot()],
    stern: [slot(), slot(), slot()],
    port: [slot(), slot(), slot(), slot()],
    body: [slot(), slot(), slot(), slot(), slot(), slot(), slot(), slot()],
    starboard: [slot(), slot(), slot(), slot()],
  };
}

export function cloneDeckLayout(layout: ShipDeckLayout): ShipDeckLayout {
  return {
    version: layout.version,
    bow: layout.bow.map(s => ({ ...s })),
    stern: layout.stern.map(s => ({ ...s })),
    port: layout.port.map(s => ({ ...s })),
    body: layout.body.map(s => ({ ...s })),
    starboard: layout.starboard.map(s => ({ ...s })),
  };
}

/** Normalize every region and pad to the current minimum shape. */
export function normalizeDeckLayout(raw?: Partial<ShipDeckLayout> | null): ShipDeckLayout {
  if (!raw || !Array.isArray(raw.bow) || raw.bow.length === 0) {
    return createDefaultDeckLayout();
  }
  const fallback = createDefaultDeckLayout();
  const normalize = (arr: ShipDeckSlot[] | undefined, fallbackSlots: ShipDeckSlot[], minimum: number) => {
    const source = Array.isArray(arr) && arr.length > 0 ? arr : fallbackSlots;
    const slots = source.map(s => ({ cardKey: s?.cardKey ?? null }));
    while (slots.length < minimum) slots.push(slot());
    return slots;
  };
  return {
    version: raw.version,
    bow: normalize(raw.bow, fallback.bow, 1),
    stern: normalize(raw.stern, fallback.stern, 1),
    port: normalize(raw.port, fallback.port, 1),
    body: normalize(raw.body, fallback.body, 2),
    starboard: normalize(raw.starboard, fallback.starboard, 1),
  };
}

/**
 * One-time conversion from the old Bow6/Port5/Body10/Starboard5/Stern6 shape.
 * Cards in slots that no longer exist are omitted here and re-placed by
 * syncDeckLayout.
 */
function reshapeLegacyLayout(layout: ShipDeckLayout): ShipDeckLayout {
  const next = createDefaultDeckLayout();
  const copy = (from: ShipDeckRegion, fromIndex: number, to: ShipDeckRegion, toIndex: number) => {
    const key = layout[from][fromIndex]?.cardKey;
    if (key) next[to][toIndex].cardKey = key;
  };
  copy('bow', 1, 'bow', 0);
  copy('bow', 3, 'bow', 1);
  copy('bow', 4, 'bow', 2);
  copy('bow', 5, 'bow', 3);
  for (let i = 0; i < 3; i += 1) copy('stern', i, 'stern', i);
  for (let i = 0; i < 4; i += 1) {
    copy('port', i, 'port', i);
    copy('starboard', i, 'starboard', i);
  }
  for (let i = 0; i < 8; i += 1) copy('body', i, 'body', i);
  return next;
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

function firstFree(
  layout: ShipDeckLayout,
  regions: ShipDeckRegion[],
): { region: ShipDeckRegion; index: number } | null {
  for (const region of regions) {
    for (let index = 0; index < layout[region].length; index += 1) {
      if (!layout[region][index].cardKey) return { region, index };
    }
  }
  return null;
}

/** Append one row across the middle; Body keeps two columns (2 slots). */
export function addMiddleRow(layout: ShipDeckLayout): void {
  layout.port.push(slot());
  layout.body.push(slot(), slot());
  layout.starboard.push(slot());
}

/** Append one empty slot to the bottom of a region. */
export function addSlotToRegion(layout: ShipDeckLayout, region: ShipDeckRegion): ShipDeckLayout {
  const next = cloneDeckLayout(layout);
  next[region].push(slot());
  return next;
}

const REGION_MIN_SLOTS: Record<ShipDeckRegion, number> = {
  bow: 1,
  stern: 1,
  port: 1,
  starboard: 1,
  body: 2,
};

function lastEmptySlotIndex(layout: ShipDeckLayout, region: ShipDeckRegion): number {
  if (layout[region].length <= REGION_MIN_SLOTS[region]) return -1;
  for (let i = layout[region].length - 1; i >= 0; i -= 1) {
    if (!layout[region][i].cardKey) return i;
  }
  return -1;
}

/** True when the region has a removable empty slot above its minimum. */
export function canRemoveLastEmptySlot(layout: ShipDeckLayout, region: ShipDeckRegion): boolean {
  return lastEmptySlotIndex(layout, region) >= 0;
}

/** Remove the bottom-most empty slot in one region. */
export function removeLastEmptySlot(layout: ShipDeckLayout, region: ShipDeckRegion): ShipDeckLayout {
  const next = cloneDeckLayout(layout);
  const index = lastEmptySlotIndex(next, region);
  if (index >= 0) next[region].splice(index, 1);
  return next;
}

function placeCard(layout: ShipDeckLayout, card: DeckCard, preferred: ShipDeckRegion[]): boolean {
  let empty = firstFree(layout, preferred);
  if (!empty) {
    empty = firstFree(layout, ['body', 'port', 'starboard', 'bow', 'stern']);
  }
  if (!empty) {
    addMiddleRow(layout);
    empty = firstFree(layout, ['body', 'port', 'starboard']);
  }
  if (!empty) return false;
  layout[empty.region][empty.index].cardKey = card.key;
  return true;
}

/** Preserve manual placements, drop removed cards, and place every new card. */
export function syncDeckLayout(
  raw: Partial<ShipDeckLayout> | null | undefined,
  cards: DeckCard[],
): ShipDeckLayout {
  const normalized = normalizeDeckLayout(raw);
  const layout = normalized.version === 2 ? normalized : reshapeLegacyLayout(normalized);
  layout.version = 2;
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

/** Swap two slots' cards. */
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

/** Direction implied by the slot's region, using deck terminology. */
export function deckDirection(
  layout: ShipDeckLayout,
  cardKey: string,
): 'Bow' | 'Body' | 'Port' | 'Starboard' | 'Stern' | '—' {
  const found = findCardSlot(layout, cardKey);
  if (!found) return '—';
  return DECK_REGION_LABELS[found.region] as 'Bow' | 'Body' | 'Port' | 'Starboard' | 'Stern';
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

export function hasCard(layout: ShipDeckLayout, cardKey: string): boolean {
  return DECK_REGIONS.some(region => layout[region].some(s => s.cardKey === cardKey));
}
