import { describe, it, expect } from 'vitest';
import { isAttackAllowed } from './attackCap';

describe('isAttackAllowed — 5-attack+retaliation cap', () => {
  it('allows attacks while below the cap', () => {
    expect(isAttackAllowed(0, 5)).toBe(true);
    expect(isAttackAllowed(4, 5)).toBe(true);
  });

  it('blocks at the cap and beyond', () => {
    expect(isAttackAllowed(5, 5)).toBe(false);
    expect(isAttackAllowed(6, 5)).toBe(false);
  });

  it('respects a custom cap', () => {
    expect(isAttackAllowed(2, 3)).toBe(true);
    expect(isAttackAllowed(3, 3)).toBe(false);
  });
});
