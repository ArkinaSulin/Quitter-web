import { describe, it, expect } from 'vitest';
import { ladderPaths } from './structureDraw';

describe('ladderPaths', () => {
  const a = { x: 0, y: 0 };
  const b = { x: 100, y: 0 };

  it('returns 3 rungs and 2 rails', () => {
    const { rungs, rails } = ladderPaths(a, b, { x: 50, y: -100 });
    // 3 rungs → 3 move/line pairs; 2 rails → 2 pairs.
    expect((rungs.match(/M /g) ?? []).length).toBe(3);
    expect((rails.match(/M /g) ?? []).length).toBe(2);
  });

  it('leans the rungs toward the higher point', () => {
    const up = ladderPaths(a, b, { x: 50, y: -100 });
    const down = ladderPaths(a, b, { x: 50, y: 100 });
    // The rungs path differs when the higher side flips.
    expect(up.rungs).not.toBe(down.rungs);
  });

  it('is degenerate-safe for a zero-length edge', () => {
    const { rungs, rails } = ladderPaths({ x: 5, y: 5 }, { x: 5, y: 5 }, { x: 5, y: 0 });
    expect(rungs).toContain('M');
    expect(rails).toContain('M');
  });
});
