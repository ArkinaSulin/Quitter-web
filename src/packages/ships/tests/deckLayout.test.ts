import { describe, expect, it } from 'vitest';
import {
  addMiddleRow,
  addSlotToRegion,
  canRemoveLastEmptySlot,
  createDefaultDeckLayout,
  DeckCard,
  deckDirection,
  findCardSlot,
  normalizeDeckLayout,
  removeLastEmptySlot,
  syncDeckLayout,
} from '@/packages/ships';

describe('deck layout', () => {
  it('starts with Bow 4, Stern 3, Port/Starboard 4, and Body 8', () => {
    const layout = createDefaultDeckLayout();
    expect(layout.bow).toHaveLength(4);
    expect(layout.stern).toHaveLength(3);
    expect(layout.port).toHaveLength(4);
    expect(layout.body).toHaveLength(8);
    expect(layout.starboard).toHaveLength(4);
  });

  it('pads version 2 layouts only to the one-row minimum', () => {
    const layout = createDefaultDeckLayout();
    layout.body = layout.body.slice(0, 5);
    expect(normalizeDeckLayout(layout).body).toHaveLength(5);
    layout.body = layout.body.slice(0, 1);
    expect(normalizeDeckLayout(layout).body).toHaveLength(2);
    layout.stern = layout.stern.slice(0, 1);
    expect(normalizeDeckLayout(layout).stern).toHaveLength(1);
  });

  it('reshapes a legacy 6/5/10/5/6 layout and re-places removed cards', () => {
    const legacy = createDefaultDeckLayout();
    legacy.version = undefined;
    legacy.bow = Array.from({ length: 6 }, () => ({ cardKey: null }));
    legacy.stern = Array.from({ length: 6 }, () => ({ cardKey: null }));
    legacy.port = Array.from({ length: 5 }, () => ({ cardKey: null }));
    legacy.body = Array.from({ length: 10 }, () => ({ cardKey: null }));
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
    expect(layout.bow).toHaveLength(4);
    expect(layout.stern).toHaveLength(3);
    expect(layout.body).toHaveLength(8);
    expect(findCardSlot(layout, 'component:bow-top')?.region).toBe('bow');
    expect(findCardSlot(layout, 'component:bow-top')?.index).toBe(0);
    expect(findCardSlot(layout, 'component:bow-bottom')?.index).toBe(1);
    expect(findCardSlot(layout, 'component:removed-port')).not.toBeNull();
  });

  it('removes the bottom-most empty slot down to the one-row minimum', () => {
    let layout = createDefaultDeckLayout();
    expect(canRemoveLastEmptySlot(layout, 'bow')).toBe(true);
    expect(canRemoveLastEmptySlot(layout, 'stern')).toBe(true);
    layout = removeLastEmptySlot(layout, 'stern');
    layout = removeLastEmptySlot(layout, 'stern');
    expect(layout.stern).toHaveLength(1);
    expect(canRemoveLastEmptySlot(layout, 'stern')).toBe(false);
    layout = removeLastEmptySlot(layout, 'bow');
    expect(layout.bow).toHaveLength(3);
    layout = removeLastEmptySlot(layout, 'bow');
    layout = removeLastEmptySlot(layout, 'bow');
    expect(layout.bow).toHaveLength(1);
    expect(canRemoveLastEmptySlot(layout, 'bow')).toBe(false);
    layout = removeLastEmptySlot(layout, 'port');
    expect(layout.port).toHaveLength(3);
    layout = removeLastEmptySlot(layout, 'body');
    expect(layout.body).toHaveLength(7);
  });

  it('does not re-add a removed slot during sync', () => {
    const layout = removeLastEmptySlot(createDefaultDeckLayout(), 'bow');
    const synced = syncDeckLayout(layout, []);
    expect(synced.bow).toHaveLength(3);
  });

  it('skips occupied slots and removes the last empty one', () => {
    const layout = createDefaultDeckLayout();
    layout.body[7].cardKey = 'component:bottom';
    expect(canRemoveLastEmptySlot(layout, 'body')).toBe(true);
    const next = removeLastEmptySlot(layout, 'body');
    expect(next.body).toHaveLength(7);
    expect(next.body[6].cardKey).toBe('component:bottom');
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
      for (const _ of base[region]) {
        n += 1;
        cards.push({ key: `component:${n}`, kind: 'component' });
      }
    }
    const full = syncDeckLayout(base, cards);
    expect(full.body).toHaveLength(8);
    addMiddleRow(full);
    expect(full.body).toHaveLength(10);
    expect(full.port).toHaveLength(5);
    expect(full.starboard).toHaveLength(5);
  });

  it('adds an empty slot to the bottom of a region', () => {
    const layout = createDefaultDeckLayout();
    const next = addSlotToRegion(layout, 'body');
    expect(next.body).toHaveLength(9);
    expect(next.body[8].cardKey).toBeNull();
  });
});
