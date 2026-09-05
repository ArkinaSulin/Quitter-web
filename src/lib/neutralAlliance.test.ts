import { describe, it, expect } from 'vitest';
import { Unit, AllianceGroup, Formation } from '@/types/gameProtocol';
import { computeThreatHexes } from '@/components/ScenarioMap/mapGeometry';

// Verifies item 7: a neutral team behaves like a full third alliance — it exerts
// zone-of-control threat against friendly AND enemy, receives threat from them,
// and does not threaten its own neutral allies. (Pure functions only.)

const h = (q: number, r: number) => ({ q, r, s: -q - r });

const unit = (id: string, team: string, hex: { q: number; r: number; s: number }, overrides: Partial<Unit> = {}): Unit => ({
  id, team, hex, isDeleted: false, hidden: false, isHero: false, attachedToUnitId: null,
  currentFormation: 'Open Order', facing: 0, currentUnitHp: 10, maxUnitHp: 10,
  isShielded: false, canCharge: false, isCharging: false, chargeDistance: 0,
  ignoreMoraleChecks: false, currentTroopCount: 1, maxTroopCount: 1, ...overrides,
} as unknown as Unit);

const form = (name: string): Formation => ({
  name,
  movement_multiplier: 1,
  morale_modifier: 0,
  stop_enemy_movement_arcs: ['front'],
} as unknown as Formation);

const groups: Record<string, AllianceGroup> = { blue: 'friendly', red: 'enemy', green: 'neutral' };
const forms: Record<string, Formation> = { 'Open Order': form('Open Order') };

describe('neutral acts as a third alliance', () => {
  // Facing 0: front arc hexes are (0,-1) and (1,-1) from the unit's hex.
  it('a neutral unit exerts threat against a friendly drag (enemy-like)', () => {
    const friendly = unit('f', 'blue', h(0, 0));
    const neutral = unit('n', 'green', h(3, 0)); // front hexes (3,-1),(4,-1)
    const threats = computeThreatHexes([friendly, neutral], 'f', groups, forms);
    expect(threats.has('3,-1')).toBe(true);
    expect(threats.has('4,-1')).toBe(true);
  });

  it('friendly and enemy units exert threat against a neutral drag (symmetric)', () => {
    const friendly = unit('f', 'blue', h(0, 0));
    const enemy = unit('e', 'red', h(-3, 0));
    const neutral = unit('n', 'green', h(5, 0));
    const threats = computeThreatHexes([friendly, enemy, neutral], 'n', groups, forms);
    expect(threats.has('0,-1')).toBe(true);  // friendly fronts
    expect(threats.has('1,-1')).toBe(true);
    expect(threats.has('-3,-1')).toBe(true); // enemy fronts
    expect(threats.has('-2,-1')).toBe(true);
  });

  it('neutral does not threaten its own neutral allies', () => {
    const neutralA = unit('na', 'green', h(0, 0));
    const neutralB = unit('nb', 'green', h(3, 0));
    const threats = computeThreatHexes([neutralA, neutralB], 'na', groups, forms);
    expect(threats.has('3,-1')).toBe(false); // neutralB's front is skipped (same group)
    expect(threats.has('4,-1')).toBe(false);
  });
});
