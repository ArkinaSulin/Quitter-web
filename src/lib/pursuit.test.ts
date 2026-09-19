import { describe, it, expect } from 'vitest';
import { Unit, Formation, AllianceGroup } from '@/types/gameProtocol';
import { selectPursuer, pursuitScatters, forbiddingHero } from './pursuit';

const h = (q: number, r: number) => ({ q, r, s: -q - r });
const SWORD = 'Sword,3,1d8,false,1,1,0,false,false,false,false,1,true,Dex,circle';

const mk = (id: string, team: string, over: Partial<Unit> = {}): Unit => ({
  id, team, hex: h(0, 0), facing: 0, isHero: false, isDeleted: false, hidden: false,
  attachedToUnitId: null, currentFormation: 'Close Order', organizationLevel: 2,
  movementPoints: 4, movementPointsAvailable: 2, actionsAvailable: 1, aggressiveness: 6,
  weaponString: SWORD, pursuitUsed: false, commandPursuitPermit: false,
  currentUnitHp: 10, maxUnitHp: 10, ...over,
} as unknown as Unit);

const FORMS: Record<string, Formation> = {
  'Close Order': { name: 'Close Order', movement_multiplier: 1 } as Formation,
  Scattered: { name: 'Scattered', movement_multiplier: 1 } as Formation,
};
const GROUPS: Record<string, AllianceGroup> = { blue: 'friendly', red: 'enemy' };

describe('pursuitScatters', () => {
  it('a formed non-hero scatters; loose/hero do not', () => {
    expect(pursuitScatters(mk('a', 'red', { currentFormation: 'Close Order' }))).toBe(true);
    expect(pursuitScatters(mk('a', 'red', { currentFormation: 'Open Order' }))).toBe(true);
    expect(pursuitScatters(mk('a', 'red', { currentFormation: 'Scattered' }))).toBe(false);
    expect(pursuitScatters(mk('a', 'red', { currentFormation: 'Routed' }))).toBe(false);
    expect(pursuitScatters(mk('a', 'red', { isHero: true, currentFormation: 'Hero' }))).toBe(false);
  });
});

describe('forbiddingHero', () => {
  it('a same-alliance hero within 1 hex with permit=false holds the unit', () => {
    const u = mk('u', 'red', { hex: h(0, 0) });
    const hero = mk('h', 'red', { isHero: true, hex: h(1, 0), commandPursuitPermit: false });
    expect(forbiddingHero(u, [u, hero], GROUPS)?.id).toBe('h');
  });
  it('permit=true allows; wrong alliance or distance does not', () => {
    const u = mk('u', 'red', { hex: h(0, 0) });
    expect(forbiddingHero(u, [u, mk('h', 'red', { isHero: true, hex: h(1, 0), commandPursuitPermit: true })], GROUPS)).toBeNull();
    expect(forbiddingHero(u, [u, mk('h', 'blue', { isHero: true, hex: h(1, 0) })], GROUPS)).toBeNull();
    expect(forbiddingHero(u, [u, mk('h', 'red', { isHero: true, hex: h(2, 0) })], GROUPS)).toBeNull();
  });
});

describe('selectPursuer', () => {
  const constRng = (v: number) => () => v;

  it('prefers the attacker (first in order)', () => {
    const attacker = mk('a', 'red', { aggressiveness: 6 });
    const other = mk('o', 'red', { aggressiveness: 6, movementPoints: 6 });
    const sel = selectPursuer([attacker, other], attacker, [attacker, other], GROUPS, FORMS, constRng(0));
    expect(sel.pursuer?.id).toBe('a');
  });

  it('orders by most MaxMP, then most available MP', () => {
    const slow = mk('s', 'red', { movementPoints: 2, movementPointsAvailable: 5 });
    const fast = mk('f', 'red', { movementPoints: 6, movementPointsAvailable: 1 });
    const sel = selectPursuer([slow, fast], null, [slow, fast], GROUPS, FORMS, constRng(0));
    expect(sel.pursuer?.id).toBe('f');
  });

  it('walks the order rolling d10 <= aggressiveness until one passes', () => {
    // a is first by MaxMP but fails AGR (roll 10 > 1); b passes.
    const a = mk('a', 'red', { movementPoints: 6, aggressiveness: 1 });
    const b = mk('b', 'red', { movementPoints: 2, aggressiveness: 10 });
    const sel = selectPursuer([b, a], null, [a, b], GROUPS, FORMS, constRng(0.95));
    expect(sel.pursuer?.id).toBe('b');
  });

  it('a hero Commanding Presence holds a candidate and reports it', () => {
    const u = mk('u', 'red', { hex: h(0, 0) });
    const hero = mk('h', 'red', { isHero: true, hex: h(1, 0), commandPursuitPermit: false });
    const sel = selectPursuer([u], null, [u, hero], GROUPS, FORMS, constRng(0));
    expect(sel.pursuer).toBeNull();
    expect(sel.suppressed).toEqual([{ unit: u, hero }]);
  });

  it('permit=true lets the unit pursue', () => {
    const u = mk('u', 'red', { hex: h(0, 0) });
    const hero = mk('h', 'red', { isHero: true, hex: h(1, 0), commandPursuitPermit: true });
    const sel = selectPursuer([u], null, [u, hero], GROUPS, FORMS, constRng(0));
    expect(sel.pursuer?.id).toBe('u');
    expect(sel.suppressed).toEqual([]);
  });
});
