import { describe, it, expect } from 'vitest';
import { attackDirection } from './attackDirection';
import { Hex } from '@/types/gameProtocol';

const h = (q: number, r: number): Hex => ({ q, r, s: -q - r });

describe('attackDirection', () => {
  it('classifies the 6 adjacent hexes for facing 0', () => {
    const d = h(0, 0);
    // front = dirs 4,5 ; right = dir 0 ; left = dir 3 ; rear = dirs 1,2
    expect(attackDirection(h(0, -1), d, 0)).toBe('front');
    expect(attackDirection(h(1, -1), d, 0)).toBe('front');
    expect(attackDirection(h(1, 0), d, 0)).toBe('flank');
    expect(attackDirection(h(-1, 0), d, 0)).toBe('flank');
    expect(attackDirection(h(0, 1), d, 0)).toBe('rear');
    expect(attackDirection(h(-1, 1), d, 0)).toBe('rear');
  });

  it('rotates with the facing', () => {
    const d = h(0, 0);
    // Facing 2: the old front hexes should no longer be front/rear as before.
    // A hex directly opposite the new front normal is a rear attack.
    const dirs = [h(0, -1), h(1, -1), h(1, 0), h(0, 1), h(-1, 1), h(-1, 0)];
    const frontish = dirs.filter(x => attackDirection(x, d, 2) === 'front');
    expect(frontish.length).toBe(2);
    const rearish = dirs.filter(x => attackDirection(x, d, 2) === 'rear');
    expect(rearish.length).toBe(2);
    const flank = dirs.filter(x => attackDirection(x, d, 2) === 'flank');
    expect(flank.length).toBe(2);
  });

  it('works at range (bearing-based)', () => {
    const d = h(0, 0);
    expect(attackDirection(h(0, -3), d, 0)).toBe('front'); // far ahead
    expect(attackDirection(h(0, 3), d, 0)).toBe('rear');   // far behind
    expect(attackDirection(h(3, 0), d, 0)).toBe('flank');  // far right
    expect(attackDirection(h(-3, 0), d, 0)).toBe('flank'); // far left
  });

  it('same hex = front', () => {
    expect(attackDirection(h(2, 1), h(2, 1), 0)).toBe('front');
  });
});
