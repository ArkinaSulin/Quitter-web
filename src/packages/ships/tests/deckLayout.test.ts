import { describe, expect, it } from 'vitest';
import {
  addMiddleRow,
  createDefaultDeckLayout,
  DeckCard,
  deckDirection,
  findCardSlot,
  moveSlotToRegion,
  normalizeDeckLayout,
  syncDeckLayout,
} from '@/packages/ships';

describe('deck layout', () => {
  it('starts with six bow/stern, five port/starboard, and ten body slots', () => {
    const layout = createDefaultDeckLayout();
    expect(layout.bow).toHaveLength(6);
    expect(layout.stern).toHaveLength(6);
    expect(layout.port).toHaveLength(5);
    expect(layout.body).toHaveLength(10);
    expect(layout.starboard).toHaveLength(5);
  });

  it('pads older layouts to the two-column body size', () => {
    const old = createDefaultDeckLayout();
    old.body = old.body.slice(0, 5);
    const layout = normalizeDeckLayout(old);
    expect(layout.body).toHaveLength(10);
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
    expect(full.body).toHaveLength(10);
    addMiddleRow(full);
    expect(full.body).toHaveLength(12);
    expect(full.port).toHaveLength(6);
    expect(full.starboard).toHaveLength(6);
  });

  it('moves a slot and its card to another region', () => {
    const layout = syncDeckLayout(null, [
      { key: 'weapon:ballista', kind: 'weapon' },
    ]);
    const from = findCardSlot(layout, 'weapon:ballista')!;
    const next = moveSlotToRegion(layout, from.region, from.index, 'starboard');
    expect(findCardSlot(next, 'weapon:ballista')?.region).toBe('starboard');
    expect(deckDirection(next, 'weapon:ballista')).toBe('Starboard');
  });
});
