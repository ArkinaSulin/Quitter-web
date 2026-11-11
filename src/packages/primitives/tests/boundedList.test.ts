import { describe, it, expect } from 'vitest';
import { appendReplacingOldest } from '@/packages/primitives/lib/boundedList';

describe('appendReplacingOldest', () => {
  it('appends while under the cap', () => {
    expect(appendReplacingOldest(['a'], 'b', 3)).toEqual(['a', 'b']);
  });

  it('drops the oldest entry when full (FIFO replace-first)', () => {
    expect(appendReplacingOldest(['a', 'b', 'c'], 'd', 3)).toEqual(['b', 'c', 'd']);
    expect(appendReplacingOldest(['a', 'b'], 'c', 2)).toEqual(['b', 'c']);
  });

  it('handles a one-slot list and an empty list', () => {
    expect(appendReplacingOldest([], 'a', 1)).toEqual(['a']);
    expect(appendReplacingOldest(['a'], 'b', 1)).toEqual(['b']);
  });

  it('clamps a non-positive cap to one slot', () => {
    expect(appendReplacingOldest(['a'], 'b', 0)).toEqual(['b']);
  });
});
