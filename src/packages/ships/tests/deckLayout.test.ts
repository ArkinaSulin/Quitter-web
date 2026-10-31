import { describe, expect, it } from 'vitest';
import {
  addMiddleRow,
  createDefaultDeckLayout,
  DeckCard,
  deckDirection,
  findCardSlot,
  moveSlotToRegion,
  syncDeckLayout,
} from '@/packages/ships';

describe('deck layout', () => {
  it('starts as a 3x9 deck with a fixed Ram slot', () => {
    const layout = createDefaultDeckLayout();
    expect(layout.bow).toHaveLength(6);
    expect(layout.port).toHaveLength(5);
    expect(layout.body).toHaveLength(5);
    expect(layout.starboard).toHaveLength(5);
    expect(layout.stern).toHaveLength(6);
    expect(layout.bow[1].ram).toBe(true);
  });

  it('places weapons Fore/Aft, components amidships, and the ram in the Ram slot', () => {
    const layout = syncDeckLayout(null, [
      { key: 'component:helm', kind: 'component' },
      { key: 'component:hull', kind: 'component' },
      { key: 'weapon:ballista', kind: 'weapon' },
      { key: 'weapon:ram', kind: 'weapon', ram: true },
    ]);
    expect(findCardSlot(layout, 'weapon:ram')?.region).toBe('bow');
    expect(findCardSlot(layout, 'weapon:ram')?.index).toBe(1);
    expect(findCardSlot(layout, 'weapon:ballista')?.region).toBe('bow');
    expect(findCardSlot(layout, 'component:helm')?.region).toBe('body');
    expect(findCardSlot(layout, 'component:hull')?.region).toBe('body');
    expect(deckDirection(layout, 'weapon:ballista')).toBe('Fore');
  });

  it('grows a middle row only when every slot is occupied', () => {
    const base = createDefaultDeckLayout();
    const cards: DeckCard[] = [{ key: 'weapon:ram', kind: 'weapon', ram: true }];
    let n = 0;
    for (const region of ['bow', 'stern', 'port', 'body', 'starboard'] as const) {
      for (const s of base[region]) {
        if (s.ram) continue;
        n += 1;
        cards.push({ key: `component:${n}`, kind: 'component' });
      }
    }
    const full = syncDeckLayout(base, cards);
    expect(full.body).toHaveLength(5);
    addMiddleRow(full);
    expect(full.body).toHaveLength(6);
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
    expect(deckDirection(next, 'weapon:ballista')).toBe('Right');
  });
});
