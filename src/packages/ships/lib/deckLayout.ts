// src/packages/ships/lib/deckLayout.ts
// Pure region-container deck layout. Slots are generic. Purchases are synced
// into free slots without disturbing manual placements; a full middle row grows
// Port/Body/Starboard, with Body keeping its two columns.
//
// Body is stored as an explicit array of rows (each row has 1–2 slots) so a row
// can keep a single centered slot without pulling the next row's slots up. The
// other regions stay flat; `regionSlotAt`/`regionSlotCount` give every caller a
// linear row-major index so drag/drop and the context menu keep one coordinate.

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

/** Maximum slots in one Body row (Body keeps two columns). */
const BODY_ROW_SIZE = 2;

function slot(): ShipDeckSlot {
  return { cardKey: null };
}

function cloneSlot(s: ShipDeckSlot): ShipDeckSlot {
  return { cardKey: s?.cardKey ?? null };
}

export function createDefaultDeckLayout(): ShipDeckLayout {
  return {
    version: 2,
    bow: [slot(), slot(), slot()],
    stern: [slot(), slot(), slot()],
    port: [slot(), slot(), slot(), slot()],
    body: [
      [slot(), slot()],
      [slot(), slot()],
      [slot(), slot()],
      [slot(), slot()],
    ],
    starboard: [slot(), slot(), slot(), slot()],
  };
}

export function cloneDeckLayout(layout: ShipDeckLayout): ShipDeckLayout {
  // Safety net: legacy flat Body arrays are converted before cloning.
  const source = layout.body.every(row => Array.isArray(row)) ? layout : normalizeDeckLayout(layout);
  return {
    version: source.version,
    bow: source.bow.map(cloneSlot),
    stern: source.stern.map(cloneSlot),
    port: source.port.map(cloneSlot),
    body: source.body.map(row => row.map(cloneSlot)),
    starboard: source.starboard.map(cloneSlot),
  };
}

/** Total Body slots (sum of every row). */
export function bodySlotCount(layout: ShipDeckLayout): number {
  let count = 0;
  for (const row of layout.body) count += row.length;
  return count;
}

/** Flattened Body slots in row-major order. */
export function bodySlots(layout: ShipDeckLayout): ShipDeckSlot[] {
  const out: ShipDeckSlot[] = [];
  for (const row of layout.body) for (const s of row) out.push(s);
  return out;
}

/** Number of addressable slots in a region (Body is row-major over its rows). */
export function regionSlotCount(layout: ShipDeckLayout, region: ShipDeckRegion): number {
  return region === 'body' ? bodySlotCount(layout) : layout[region].length;
}

/** Slot at a linear row-major index (Body: over rows; other regions: flat). */
export function regionSlotAt(
  layout: ShipDeckLayout,
  region: ShipDeckRegion,
  index: number,
): ShipDeckSlot | undefined {
  if (region !== 'body') return layout[region][index];
  if (index < 0) return undefined;
  let cursor = 0;
  for (const row of layout.body) {
    if (index < cursor + row.length) return row[index - cursor];
    cursor += row.length;
  }
  return undefined;
}

/**
 * Read `raw.body` into Body rows, converting the legacy flat array (a slot
 * object per entry) by chunking two per row. Returns null when absent.
 */
function toBodyRows(rawBody: unknown): ShipDeckSlot[][] | null {
  if (!Array.isArray(rawBody) || rawBody.length === 0) return null;
  if (rawBody.every(entry => Array.isArray(entry))) {
    return (rawBody as ShipDeckSlot[][]).map(row =>
      (Array.isArray(row) ? row : []).map(s => cloneSlot(s)),
    );
  }
  const flat: ShipDeckSlot[] = [];
  for (const entry of rawBody as ShipDeckSlot[] | ShipDeckSlot[][]) {
    if (Array.isArray(entry)) {
      for (const s of entry) flat.push(cloneSlot(s));
    } else {
      flat.push(cloneSlot(entry));
    }
  }
  const rows: ShipDeckSlot[][] = [];
  for (let i = 0; i < flat.length; i += BODY_ROW_SIZE) {
    rows.push(flat.slice(i, i + BODY_ROW_SIZE));
  }
  return rows;
}

/** Normalize every region and pad to the current minimum shape. */
export function normalizeDeckLayout(raw?: Partial<ShipDeckLayout> | null): ShipDeckLayout {
  if (!raw || !Array.isArray(raw.bow) || raw.bow.length === 0) {
    return createDefaultDeckLayout();
  }
  const fallback = createDefaultDeckLayout();
  const normalize = (arr: ShipDeckSlot[] | undefined, fallbackSlots: ShipDeckSlot[], minimum: number) => {
    const source = Array.isArray(arr) && arr.length > 0 ? arr : fallbackSlots;
    const slots = source.map(s => cloneSlot(s));
    while (slots.length < minimum) slots.push(slot());
    return slots;
  };

  let body = toBodyRows(raw.body) ?? fallback.body.map(row => row.map(cloneSlot));
  // Drop empty rows and keep every row within one Body row's width; Body can
  // shrink to a single slot (one 1-column row), but never disappear.
  const rows: ShipDeckSlot[][] = [];
  for (const row of body) {
    if (row.length === 0) continue;
    if (row.length <= BODY_ROW_SIZE) rows.push(row);
    else {
      for (let i = 0; i < row.length; i += BODY_ROW_SIZE) {
        rows.push(row.slice(i, i + BODY_ROW_SIZE));
      }
    }
  }
  body = rows.length > 0 ? rows : [[slot()]];

  return {
    version: raw.version,
    bow: normalize(raw.bow, fallback.bow, 1),
    stern: normalize(raw.stern, fallback.stern, 1),
    port: normalize(raw.port, fallback.port, 1),
    body,
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
    const key = regionSlotAt(layout, from, fromIndex)?.cardKey;
    const target = regionSlotAt(next, to, toIndex);
    if (key && target) target.cardKey = key;
  };
  copy('bow', 1, 'bow', 0);
  copy('bow', 3, 'bow', 1);
  copy('bow', 4, 'bow', 2);
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
    const count = regionSlotCount(layout, region);
    for (let index = 0; index < count; index += 1) {
      const slot = regionSlotAt(layout, region, index);
      if (slot?.cardKey === cardKey) return { region, index, slot };
    }
  }
  return null;
}

function firstFree(
  layout: ShipDeckLayout,
  regions: ShipDeckRegion[],
): { region: ShipDeckRegion; index: number } | null {
  for (const region of regions) {
    const count = regionSlotCount(layout, region);
    for (let index = 0; index < count; index += 1) {
      if (!regionSlotAt(layout, region, index)?.cardKey) return { region, index };
    }
  }
  return null;
}

/** Append one row across the middle; Body keeps two columns (2 slots). */
export function addMiddleRow(layout: ShipDeckLayout): void {
  layout.port.push(slot());
  layout.body.push([slot(), slot()]);
  layout.starboard.push(slot());
}

/**
 * Append one empty slot to the bottom of a region. A Body half-row is filled
 * back to two columns first; otherwise a new 1-slot Body row is added.
 */
export function addSlotToRegion(layout: ShipDeckLayout, region: ShipDeckRegion): ShipDeckLayout {
  const next = cloneDeckLayout(layout);
  if (region === 'body') {
    const last = next.body[next.body.length - 1];
    if (last && last.length < BODY_ROW_SIZE) last.push(slot());
    else next.body.push([slot()]);
  } else {
    next[region].push(slot());
  }
  return next;
}

const REGION_MIN_SLOTS: Record<ShipDeckRegion, number> = {
  bow: 1,
  stern: 1,
  port: 1,
  starboard: 1,
  body: 1,
};

function lastEmptySlotIndex(layout: ShipDeckLayout, region: ShipDeckRegion): number {
  const count = regionSlotCount(layout, region);
  if (count <= REGION_MIN_SLOTS[region]) return -1;
  for (let i = count - 1; i >= 0; i -= 1) {
    if (!regionSlotAt(layout, region, i)?.cardKey) return i;
  }
  return -1;
}

/** True when the region has a removable empty slot above its minimum. */
export function canRemoveLastEmptySlot(layout: ShipDeckLayout, region: ShipDeckRegion): boolean {
  return lastEmptySlotIndex(layout, region) >= 0;
}

/**
 * Remove one Body slot at a linear row-major index from an already-cloned
 * layout: a 2-slot row becomes a 1-slot row, a 1-slot row disappears and later
 * rows shift up, keeping every other row's 1/2-slot shape.
 */
function removeBodySlotAt(layout: ShipDeckLayout, index: number): ShipDeckLayout {
  let cursor = 0;
  for (let rowIndex = 0; rowIndex < layout.body.length; rowIndex += 1) {
    const row = layout.body[rowIndex];
    if (index < cursor + row.length) {
      if (row.length === BODY_ROW_SIZE) row.splice(index - cursor, 1);
      else layout.body.splice(rowIndex, 1);
      return layout;
    }
    cursor += row.length;
  }
  return layout;
}

/** Remove the bottom-most empty slot in one region. */
export function removeLastEmptySlot(layout: ShipDeckLayout, region: ShipDeckRegion): ShipDeckLayout {
  const next = cloneDeckLayout(layout);
  const index = lastEmptySlotIndex(next, region);
  if (index < 0) return next;
  if (region === 'body') return removeBodySlotAt(next, index);
  next[region].splice(index, 1);
  return next;
}

/**
 * Remove the empty slot at `index` for Body; otherwise trim the bottom-most
 * empty slot like `removeLastEmptySlot` (occupied or other regions).
 */
export function removeEmptySlotAt(
  layout: ShipDeckLayout,
  region: ShipDeckRegion,
  index: number,
): ShipDeckLayout {
  if (regionSlotCount(layout, region) <= REGION_MIN_SLOTS[region]) return layout;
  const target = regionSlotAt(layout, region, index);
  if (region !== 'body' || !target || target.cardKey) {
    return removeLastEmptySlot(layout, region);
  }
  const next = cloneDeckLayout(layout);
  return removeBodySlotAt(next, index);
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
  const slot = regionSlotAt(layout, empty.region, empty.index);
  if (!slot) return false;
  slot.cardKey = card.key;
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
    const count = regionSlotCount(layout, region);
    for (let index = 0; index < count; index += 1) {
      const s = regionSlotAt(layout, region, index);
      if (!s || !s.cardKey) continue;
      if (!byKey.has(s.cardKey) || seen.has(s.cardKey)) {
        s.cardKey = null;
        continue;
      }
      seen.add(s.cardKey);
    }
  }

  const placed = new Set<string>();
  for (const region of DECK_REGIONS) {
    const count = regionSlotCount(layout, region);
    for (let index = 0; index < count; index += 1) {
      const s = regionSlotAt(layout, region, index);
      if (s?.cardKey) placed.add(s.cardKey);
    }
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
  const a = regionSlotAt(next, from.region, from.index);
  const b = regionSlotAt(next, to.region, to.index);
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
  const push = (region: ShipDeckRegion, index: number) => {
    const key = regionSlotAt(layout, region, index)?.cardKey;
    if (key) keys.push(key);
  };
  const bowCount = regionSlotCount(layout, 'bow');
  for (let i = 0; i < bowCount; i += 1) push('bow', i);
  const middle = Math.max(
    regionSlotCount(layout, 'port'),
    regionSlotCount(layout, 'body'),
    regionSlotCount(layout, 'starboard'),
  );
  for (let i = 0; i < middle; i += 1) {
    push('port', i);
    push('body', i);
    push('starboard', i);
  }
  const sternCount = regionSlotCount(layout, 'stern');
  for (let i = 0; i < sternCount; i += 1) push('stern', i);
  return keys;
}

export function hasCard(layout: ShipDeckLayout, cardKey: string): boolean {
  for (const region of DECK_REGIONS) {
    const count = regionSlotCount(layout, region);
    for (let index = 0; index < count; index += 1) {
      if (regionSlotAt(layout, region, index)?.cardKey === cardKey) return true;
    }
  }
  return false;
}

/** Ensure a card is present (Body, first free slot). */
export function ensureCardSlot(layout: ShipDeckLayout, cardKey: string): ShipDeckLayout {
  if (hasCard(layout, cardKey)) return layout;
  const next = cloneDeckLayout(layout);
  const count = bodySlotCount(next);
  let index = -1;
  for (let i = 0; i < count; i += 1) {
    if (!regionSlotAt(next, 'body', i)?.cardKey) {
      index = i;
      break;
    }
  }
  if (index < 0) {
    next.body.push([slot(), slot()]);
    index = count;
  }
  const target = regionSlotAt(next, 'body', index);
  if (target) target.cardKey = cardKey;
  return next;
}

/** Ensure the mandatory Deck card is present. */
export function ensureDeckSlot(layout: ShipDeckLayout, deckKey: string): ShipDeckLayout {
  return ensureCardSlot(layout, deckKey);
}
