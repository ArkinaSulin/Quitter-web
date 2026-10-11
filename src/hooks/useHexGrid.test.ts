import { describe, it, expect } from 'vitest';
import { unitMatchesFilter } from '@/hooks/useHexGrid';

describe('unitMatchesFilter', () => {
  it('null passes every unit; structure passes no unit', () => {
    expect(unitMatchesFilter({ elevation: 0 }, null)).toBe(true);
    expect(unitMatchesFilter({ elevation: 20 }, null)).toBe(true);
    expect(unitMatchesFilter({ elevation: 0 }, 'structure')).toBe(false);
    expect(unitMatchesFilter({ elevation: 20 }, 'structure')).toBe(false);
  });

  it('ground keeps elevation 0 only; air keeps elevation > 0 only', () => {
    expect(unitMatchesFilter({ elevation: 0 }, 'ground')).toBe(true);
    expect(unitMatchesFilter({ elevation: 10 }, 'ground')).toBe(false);
    expect(unitMatchesFilter({ elevation: 10 }, 'air')).toBe(true);
    expect(unitMatchesFilter({ elevation: 0 }, 'air')).toBe(false);
  });

  it('treats a missing elevation as ground (0)', () => {
    expect(unitMatchesFilter({}, 'ground')).toBe(true);
    expect(unitMatchesFilter({}, 'air')).toBe(false);
  });
});
