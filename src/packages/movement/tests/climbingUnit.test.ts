import { describe, it, expect } from 'vitest';
import { isClimbingUnit, isHorizontalClimbMove } from '@/packages/movement';
import { Unit, Hex } from '@/types/gameProtocol';

const hex = (q: number, r: number): Hex => ({ q, r, s: -q - r });
const unit = (over: Partial<Unit> = {}): Unit => ({
  hex: hex(0, 0),
  elevation: 0,
  flySpeed: 0,
  climbTo: null,
  ...over,
} as Unit);

const structures = { '0,0': { templateId: 'tower' } } as unknown as Parameters<typeof isClimbingUnit>[1];
const templates = {
  tower: { id: 'tower', name: 'Tower', anchor: 'hex', elevation: 10 },
} as unknown as Parameters<typeof isClimbingUnit>[2];

describe('climbing movement guard', () => {
  it('allows up/down but blocks horizontal while climbing', () => {
    const climber = unit({ climbTo: '0,1', elevation: 5 });
    expect(isClimbingUnit(climber, structures, templates)).toBe(true);
    expect(isHorizontalClimbMove(climber, hex(0, 1), structures, templates)).toBe(false); // up
    expect(isHorizontalClimbMove(climber, hex(0, 0), structures, templates)).toBe(false); // down
    expect(isHorizontalClimbMove(climber, hex(1, 0), structures, templates)).toBe(true); // side
  });

  it('allows normal movement on a finished structure top', () => {
    const onTop = unit({ elevation: 10 });
    expect(isClimbingUnit(onTop, structures, templates)).toBe(false);
    expect(isHorizontalClimbMove(onTop, hex(1, 0), structures, templates)).toBe(false);
  });

  it('treats a hanging non-flyer as climbing even without climbTo', () => {
    const hanging = unit({ elevation: 10 });
    expect(isClimbingUnit(hanging, undefined, undefined)).toBe(true);
    expect(isHorizontalClimbMove(hanging, hex(1, 0), undefined, undefined)).toBe(true);
  });

  it('does not treat flyers as climbers', () => {
    const flyer = unit({ elevation: 20, flySpeed: 5 });
    expect(isClimbingUnit(flyer, undefined, undefined)).toBe(false);
    expect(isHorizontalClimbMove(flyer, hex(1, 0), undefined, undefined)).toBe(false);
  });
});
