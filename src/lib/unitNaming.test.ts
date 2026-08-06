import { describe, it, expect } from 'vitest';
import { alphaLabel } from './unitNaming';

describe('alphaLabel', () => {
  it('maps the first 26 instances to A–Z', () => {
    expect(alphaLabel(1)).toBe('A');
    expect(alphaLabel(2)).toBe('B');
    expect(alphaLabel(3)).toBe('C');
    expect(alphaLabel(13)).toBe('M');
    expect(alphaLabel(25)).toBe('Y');
    expect(alphaLabel(26)).toBe('Z');
  });

  it('rolls over to AA–AZ', () => {
    expect(alphaLabel(27)).toBe('AA');
    expect(alphaLabel(28)).toBe('AB');
    expect(alphaLabel(52)).toBe('AZ');
  });

  it('continues through ZZ and beyond', () => {
    expect(alphaLabel(53)).toBe('BA');
    expect(alphaLabel(78)).toBe('BZ');
    expect(alphaLabel(702)).toBe('ZZ');
    expect(alphaLabel(703)).toBe('AAA');
  });

  it('clamps non-positive input to A', () => {
    expect(alphaLabel(0)).toBe('A');
    expect(alphaLabel(-3)).toBe('A');
  });
});
