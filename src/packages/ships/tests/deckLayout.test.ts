import { describe, expect, it } from 'vitest';
import {
  addMiddleRow,
  addSlotToRegion,
  bodySlotCount,
  canRemoveLastEmptySlot,
  createDefaultDeckLayout,
  DeckCard,
  deckDirection,
  findCardSlot,
  normalizeDeckLayout,
  regionSlotAt,
  removeEmptySlotAt,
  removeLastEmptySlot,
  syncDeckLayout,
} from '@/packages/ships';

const rowLengths = (layout: ReturnType<typeof createDefaultDeckLayout>) =>
  layout.body.map(row => row.length);

describe('deck layout', () => {
  it('starts with Bow 3, Stern 3, Port/Starboard 4, and Body 8 (four 2-slot rows)', () => {
    const layout = createDefaultDeckLayout();
    expect(layout.bow).toHaveLength(3);
    expect(layout.stern).toHaveLength(3);
    expect(layout.port).toHaveLength(4);
    expect(bodySlotCount(layout)).toBe(8);
    expect(rowLengths(layout)).toEqual([2, 2, 2, 2]);
    expect(layout.starboard).toHaveLength(4);
  });

  it('pads flat regions to the one-row minimum and keeps Body at one slot', () => {
    const layout = createDefaultDeckLayout();
    layout.stern = layout.stern.slice(0, 1);
    expect(normalizeDeckLayout(layout).stern).toHaveLength(1);
    layout.body = [[{ cardKey: null }]];
    expect(bodySlotCount(normalizeDeckLayout(layout))).toBe(1);
  });

  it('converts a legacy flat Body to rows', () => {
    const legacy = createDefaultDeckLayout();
    legacy.version = undefined;
    legacy.body = Array.from({ length: 10 }, () => ({ cardKey: null })) as any;
    const layout = normalizeDeckLayout(legacy);
    expect(rowLengths(layout)).toEqual([2, 2, 2, 2, 2]);
  });

  it('reshapes a legacy 6/5/10/5/6 layout and re-places removed cards', () => {
    const legacy = createDefaultDeckLayout();
    legacy.version = undefined;
    legacy.bow = Array.from({ length: 6 }, () => ({ cardKey: null }));
    legacy.stern = Array.from({ length: 6 }, () => ({ cardKey: null }));
    legacy.port = Array.from({ length: 5 }, () => ({ cardKey: null }));
    legacy.body = Array.from({ length: 10 }, () => ({ cardKey: null })) as any;
    legacy.starboard = Array.from({ length: 5 }, () => ({ cardKey: null }));
    legacy.bow[1].cardKey = 'component:bow-top';
    legacy.bow[3].cardKey = 'component:bow-bottom';
    legacy.port[4].cardKey = 'component:removed-port';
    const layout = syncDeckLayout(legacy, [
      { key: 'component:bow-top', kind: 'component' },
      { key: 'component:bow-bottom', kind: 'component' },
      { key: 'component:removed-port', kind: 'component' },
    ]);
    expect(layout.version).toBe(2);
    expect(layout.bow).toHaveLength(3);
    expect(layout.stern).toHaveLength(3);
    expect(bodySlotCount(layout)).toBe(8);
    expect(findCardSlot(layout, 'component:bow-top')?.region).toBe('bow');
    expect(findCardSlot(layout, 'component:bow-top')?.index).toBe(0);
    expect(findCardSlot(layout, 'component:bow-bottom')?.index).toBe(1);
    expect(findCardSlot(layout, 'component:removed-port')).not.toBeNull();
  });

  it('removes the bottom-most empty slot down to the one-slot minimum', () => {
    let layout = createDefaultDeckLayout();
    expect(canRemoveLastEmptySlot(layout, 'bow')).toBe(true);
    expect(canRemoveLastEmptySlot(layout, 'stern')).toBe(true);
    layout = removeLastEmptySlot(layout, 'stern');
    layout = removeLastEmptySlot(layout, 'stern');
    expect(layout.stern).toHaveLength(1);
    expect(canRemoveLastEmptySlot(layout, 'stern')).toBe(false);
    layout = removeLastEmptySlot(layout, 'bow');
    expect(layout.bow).toHaveLength(2);
    layout = removeLastEmptySlot(layout, 'bow');
    expect(layout.bow).toHaveLength(1);
    expect(canRemoveLastEmptySlot(layout, 'bow')).toBe(false);
    layout = removeLastEmptySlot(layout, 'port');
    expect(layout.port).toHaveLength(3);
    expect(canRemoveLastEmptySlot(layout, 'body')).toBe(true);
    for (let i = 0; i < 7; i += 1) layout = removeLastEmptySlot(layout, 'body');
    expect(bodySlotCount(layout)).toBe(1);
    expect(canRemoveLastEmptySlot(layout, 'body')).toBe(false);
  });

  it('does not re-add a removed slot during sync', () => {
    const layout = removeLastEmptySlot(createDefaultDeckLayout(), 'bow');
    const synced = syncDeckLayout(layout, []);
    expect(synced.bow).toHaveLength(2);
  });

  it('skips occupied slots and removes the last empty one', () => {
    const layout = createDefaultDeckLayout();
    regionSlotAt(layout, 'body', 7)!.cardKey = 'component:bottom';
    expect(canRemoveLastEmptySlot(layout, 'body')).toBe(true);
    const next = removeLastEmptySlot(layout, 'body');
    expect(bodySlotCount(next)).toBe(7);
    // The occupied last slot moved up into the freed column of its row.
    expect(regionSlotAt(next, 'body', 6)?.cardKey).toBe('component:bottom');
  });

  it('places weapons at the Bow/Stern and components amidships', () => {
    const layout = syncDeckLayout(null, [
      { key: 'component:helm', kind: 'component' },
      { key: 'component:hull', kind: 'component' },
      { key: 'weapon:ballista', kind: 'weapon' },
    ]);
    expect(findCardSlot(layout, 'weapon:ballista')?.region).toBe('bow');
    expect(findCardSlot(layout, 'component:helm')?.region).toBe('body');
    expect(findCardSlot(layout, 'component:hull')?.region).toBe('body');
    expect(deckDirection(layout, 'weapon:ballista')).toBe('Bow');
  });

  it('grows a full middle row with two body slots', () => {
    const base = createDefaultDeckLayout();
    const cards: DeckCard[] = [];
    let n = 0;
    for (const region of ['bow', 'stern', 'port', 'body', 'starboard'] as const) {
      const count = region === 'body' ? bodySlotCount(base) : base[region].length;
      for (let i = 0; i < count; i += 1) {
        n += 1;
        cards.push({ key: `component:${n}`, kind: 'component' });
      }
    }
    const full = syncDeckLayout(base, cards);
    expect(bodySlotCount(full)).toBe(8);
    addMiddleRow(full);
    expect(bodySlotCount(full)).toBe(10);
    expect(full.port).toHaveLength(5);
    expect(full.starboard).toHaveLength(5);
  });

  it('adds an empty slot to the bottom of a region', () => {
    const layout = createDefaultDeckLayout();
    const next = addSlotToRegion(layout, 'body');
    expect(bodySlotCount(next)).toBe(9);
    expect(regionSlotAt(next, 'body', 8)?.cardKey).toBeNull();
    expect(rowLengths(next)).toEqual([2, 2, 2, 2, 1]);
  });

  it('fills a Body half-row before adding a new row', () => {
    const layout = createDefaultDeckLayout();
    layout.body = [layout.body[0], layout.body[1], layout.body[2], [layout.body[3][0]]];
    expect(bodySlotCount(layout)).toBe(7);
    const next = addSlotToRegion(layout, 'body');
    expect(bodySlotCount(next)).toBe(8);
    expect(rowLengths(next)).toEqual([2, 2, 2, 2]);
  });

  it('removes the exact empty Body slot under the cursor without shifting later rows', () => {
    const layout = createDefaultDeckLayout();
    const next = removeEmptySlotAt(layout, 'body', 4);
    expect(bodySlotCount(next)).toBe(7);
    expect(rowLengths(next)).toEqual([2, 2, 1, 2]);
  });

  it('keeps later Body rows in place when an empty slot is removed by index', () => {
    const layout = createDefaultDeckLayout();
    regionSlotAt(layout, 'body', 5)!.cardKey = 'component:after';
    const next = removeEmptySlotAt(layout, 'body', 4);
    expect(bodySlotCount(next)).toBe(7);
    expect(rowLengths(next)).toEqual([2, 2, 1, 2]);
    expect(regionSlotAt(next, 'body', 4)?.cardKey).toBe('component:after');
  });

  it('collapses a lone Body row and shifts later rows up', () => {
    const layout = createDefaultDeckLayout();
    layout.body = [layout.body[0], [layout.body[1][0]], layout.body[2], layout.body[3]];
    expect(rowLengths(layout)).toEqual([2, 1, 2, 2]);
    const next = removeEmptySlotAt(layout, 'body', 2);
    expect(rowLengths(next)).toEqual([2, 2, 2]);
    expect(bodySlotCount(next)).toBe(6);
  });

  it('falls back to the last empty slot when the Body target is occupied', () => {
    const layout = createDefaultDeckLayout();
    regionSlotAt(layout, 'body', 3)!.cardKey = 'component:occupied';
    const next = removeEmptySlotAt(layout, 'body', 3);
    expect(bodySlotCount(next)).toBe(7);
    expect(regionSlotAt(next, 'body', 7)).toBeUndefined();
    expect(regionSlotAt(next, 'body', 3)?.cardKey).toBe('component:occupied');
  });

  it('falls back to the last empty slot for non-Body regions', () => {
    const layout = createDefaultDeckLayout();
    layout.port[1].cardKey = 'component:port';
    const next = removeEmptySlotAt(layout, 'port', 0);
    expect(next.port).toHaveLength(3);
    expect(next.port[3]).toBeUndefined();
    expect(next.port[1].cardKey).toBe('component:port');
  });

  it('does not remove Body slots below the one-slot minimum', () => {
    const layout = createDefaultDeckLayout();
    layout.body = [[layout.body[0][0]]];
    expect(removeEmptySlotAt(layout, 'body', 0)).toBe(layout);
  });
});
