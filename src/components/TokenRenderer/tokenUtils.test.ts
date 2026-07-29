import { describe, it, expect } from 'vitest';
import {
  getFormationConfig,
  getDotColor,
  seededRandom,
  generateDotPositions,
} from './tokenUtils';

describe('getFormationConfig', () => {
  it('returns default config for Open Order foot formation', () => {
    const config = getFormationConfig('Open Order', false);

    expect(config.dotsPerRow).toBe(10);
    expect(config.rowSpacing).toBe(2.0);
    expect(config.isMounted).toBe(false);
    expect(config.scatteredLayout).toBe('random');
  });

  it('doubles dotsPerRow for Close Order formation', () => {
    const config = getFormationConfig('Close Order', false);
    expect(config.dotsPerRow).toBe(20);
  });

  it('sets rowSpacing to 1.0 for Phalanx', () => {
    const config = getFormationConfig('Phalanx', false);
    expect(config.dotsPerRow).toBe(20);
    expect(config.rowSpacing).toBe(1.0);
  });

  it('sets rowSpacing to 1.0 for Shield Wall', () => {
    const config = getFormationConfig('Shield Wall', false);
    expect(config.dotsPerRow).toBe(20);
    expect(config.rowSpacing).toBe(1.0);
  });

  it('reduces rows for Large size (200)', () => {
    const config = getFormationConfig('Open Order', false, 200);
    expect(config.dotsPerRow).toBe(5);
  });

  it('reduces rows for Huge size (300)', () => {
    const config = getFormationConfig('Open Order', false, 300);
    expect(config.dotsPerRow).toBe(3);
  });

  it('sets rows to 1 for Gargantuan size (400)', () => {
    const config = getFormationConfig('Open Order', false, 400);
    expect(config.dotsPerRow).toBe(1);
  });

  it('falls back mounted Phalanx to Routed', () => {
    const config = getFormationConfig('Phalanx', true);
    expect(config.isMounted).toBe(true);
    expect(config.dotsPerRow).toBeLessThanOrEqual(5);
  });

  it('uses circle layout for mounted Scattered', () => {
    const config = getFormationConfig('Scattered', true);
    expect(config.scatteredLayout).toBe('circle');
  });

  it('clamps dotsPerRow to at least 1', () => {
    const config = getFormationConfig('Open Order', false, 999);
    expect(config.dotsPerRow).toBe(1);
  });
});

describe('getDotColor', () => {
  it('returns white for dark teams', () => {
    expect(getDotColor('blue')).toBe('#FFFFFF');
    expect(getDotColor('green')).toBe('#FFFFFF');
  });

  it('returns black for light teams', () => {
    expect(getDotColor('yellow')).toBe('#000000');
    expect(getDotColor('violet')).toBe('#000000');
    expect(getDotColor('orange')).toBe('#000000');
  });

  it('returns black for undefined or unknown team', () => {
    expect(getDotColor(undefined)).toBe('#000000');
    expect(getDotColor('unknown')).toBe('#000000');
  });
});

describe('seededRandom', () => {
  it('produces deterministic results', () => {
    const rng1 = seededRandom(42);
    const rng2 = seededRandom(42);

    const seq1 = [rng1(), rng1(), rng1()];
    const seq2 = [rng2(), rng2(), rng2()];

    expect(seq1).toEqual(seq2);
  });

  it('produces values between 0 and 1', () => {
    const rng = seededRandom(123);
    for (let i = 0; i < 100; i++) {
      const val = rng();
      expect(val).toBeGreaterThanOrEqual(0);
      expect(val).toBeLessThan(1);
    }
  });
});

describe('generateDotPositions', () => {
  const tokenWidth = 160;
  const tokenHeight = 120;
  const dotRadius = 4;

  it('generates correct number of positions for full health unit', () => {
    const positions = generateDotPositions(10, 10, 'Open Order', false, tokenWidth, tokenHeight, dotRadius, 100);

    expect(positions).toHaveLength(10);
    expect(positions.every(p => !p.isDead)).toBe(true);
  });

  it('marks excess positions as dead for damaged units', () => {
    const positions = generateDotPositions(7, 10, 'Open Order', false, tokenWidth, tokenHeight, dotRadius, 100);

    expect(positions).toHaveLength(10);
    const alive = positions.filter(p => !p.isDead).length;
    const dead = positions.filter(p => p.isDead).length;

    expect(alive).toBe(7);
    expect(dead).toBe(3);
  });

  it('uses row-by-row centering for Close Order formation', () => {
    const positions = generateDotPositions(20, 20, 'Close Order', false, 160, 120, 4, 100);

    // All positions should be within token bounds
    for (const pos of positions) {
      expect(pos.x).toBeGreaterThanOrEqual(0);
      expect(pos.x).toBeLessThanOrEqual(160);
      expect(pos.y).toBeGreaterThanOrEqual(0);
      expect(pos.y).toBeLessThanOrEqual(120);
    }
  });

  it('uses 2 rings (12+8) for mounted Scattered ≤ 20 troops', () => {
    const positions = generateDotPositions(20, 20, 'Scattered', true, 160, 120, 4, 100);

    expect(positions).toHaveLength(20);
    expect(positions.every(p => !p.isDead)).toBe(true);
    expect(positions.every(p => typeof p.direction === 'number')).toBe(true);
  });

  it('uses 3 rings (21+13+6) for mounted Scattered > 20 troops up to 40', () => {
    const positions = generateDotPositions(40, 40, 'Scattered', true, 160, 120, 4, 100);

    expect(positions).toHaveLength(40);
    expect(positions.every(p => !p.isDead)).toBe(true);
    expect(positions.every(p => typeof p.direction === 'number')).toBe(true);
  });

  it('caps mounted Scattered at 40 and marks excess as dead', () => {
    const positions = generateDotPositions(25, 80, 'Scattered', true, 160, 120, 4, 100);

    expect(positions).toHaveLength(40);
    const alive = positions.filter(p => !p.isDead).length;
    expect(alive).toBe(25);
  });

  it('switches to 2-ring mode when count drops to 20', () => {
    const positions = generateDotPositions(12, 12, 'Scattered', true, 160, 120, 4, 100);

    expect(positions).toHaveLength(12);
    expect(positions.every(p => !p.isDead)).toBe(true);
  });

  it('uses 2 rings (12+8) for mounted Scattered at Large size (200)', () => {
    const positions = generateDotPositions(20, 20, 'Scattered', true, 160, 120, 4, 200);

    expect(positions).toHaveLength(20);
    const dead = positions.filter(p => p.isDead).length;
    expect(dead).toBe(0);
    expect(positions.every(p => typeof p.direction === 'number')).toBe(true);
  });

  it('uses 2 rings (12+8) for mounted Scattered at Small size (75)', () => {
    const positions = generateDotPositions(20, 20, 'Scattered', true, 160, 120, 4, 75);

    expect(positions).toHaveLength(20);
    expect(positions.every(p => !p.isDead)).toBe(true);
  });

  it('uses 3 rings for mounted Scattered >20 troops at Small size (75)', () => {
    const positions = generateDotPositions(35, 35, 'Scattered', true, 160, 120, 4, 75);

    expect(positions).toHaveLength(35);
    expect(positions.every(p => !p.isDead)).toBe(true);
  });

  it('returns positions for empty unit', () => {
    const positions = generateDotPositions(0, 0, 'Open Order', false, 160, 120, 4, 100);

    expect(positions).toHaveLength(0);
  });
});
