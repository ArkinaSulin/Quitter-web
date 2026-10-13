// src/packages/combat/tests/warMachine.test.ts
import { describe, it, expect } from 'vitest';
import { rollWarMachineHits } from '@/packages/combat/lib/warMachine';

/** rng that yields exact d20 faces in order (rollD20 = floor(rng*20)+1). */
function rngFor(faces: number[]): () => number {
  let i = 0;
  return () => (faces[i++ % faces.length] - 0.5) / 20;
}

describe('rollWarMachineHits', () => {
  it('counts hits: nat 20 hits, nat 1 misses, else d20 + bonus >= AC', () => {
    const { hits, rolls } = rollWarMachineHits(3, 0, 15, rngFor([20, 1, 15]));
    expect(rolls).toEqual([20, 1, 15]);
    expect(hits).toBe(2); // 20 hit, 1 miss, 15 >= 15 hit
  });

  it('applies the attack bonus to the threshold', () => {
    expect(rollWarMachineHits(2, 5, 15, rngFor([10, 9])).hits).toBe(1); // 15 hit, 14 miss
  });

  it('honours advantage (take the higher) and disadvantage (lower)', () => {
    expect(rollWarMachineHits(1, 0, 15, rngFor([3, 16]), 'advantage').hits).toBe(1);   // max(3,16)=16
    expect(rollWarMachineHits(1, 0, 15, rngFor([3, 16]), 'disadvantage').hits).toBe(0); // min(3,16)=3
  });

  it('returns zero hits when every shot misses', () => {
    expect(rollWarMachineHits(4, 0, 30, rngFor([2, 3, 4, 5])).hits).toBe(0);
  });
});
