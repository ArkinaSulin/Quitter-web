import { describe, it, expect, afterEach } from 'vitest';
import { getShieldPenalty, effectiveAc, heroAuraBonus, acVsWarMachine } from '@/packages/units/lib/unitStats';
import { setHeroMoraleBoostEnabled } from '@/packages/morale';
import { Formation } from '@/types/gameProtocol';

describe('getShieldPenalty', () => {
  it('returns 0 for a unit without a shield', () => {
    expect(getShieldPenalty({ isShielded: false, weaponString: 'Greatsword,5,2d6,false,1,0,0,false,false,false,true,1,true,Dex', activeWeaponIndex: 0, currentFormation: 'Open Order' })).toEqual({ penalty: 0 });
  });

  it('returns 0 for a shielded unit using a one-handed weapon', () => {
    expect(getShieldPenalty({ isShielded: true, weaponString: 'Longsword,5,1d8,false,1,0,0,false,false,false,false,1,true,Dex', activeWeaponIndex: 0, currentFormation: 'Open Order' })).toEqual({ penalty: 0 });
  });

  it('returns 2 (two-handed) for a shielded unit using a two-handed weapon', () => {
    expect(getShieldPenalty({ isShielded: true, weaponString: 'Greatsword,5,2d6,false,1,0,0,false,false,false,true,1,true,Dex', activeWeaponIndex: 0, currentFormation: 'Open Order' })).toEqual({ penalty: 2, reason: 'two-handed' });
  });

  it('uses the active weapon index, not the first weapon', () => {
    const string = 'Longsword,5,1d8,false,1,0,0,false,false,false,false,1,true,Dex;Greatsword,5,2d6,false,1,0,0,false,false,false,true,1,true,Dex';
    expect(getShieldPenalty({ isShielded: true, weaponString: string, activeWeaponIndex: 0, currentFormation: 'Open Order' })).toEqual({ penalty: 0 });
    expect(getShieldPenalty({ isShielded: true, weaponString: string, activeWeaponIndex: 1, currentFormation: 'Open Order' })).toEqual({ penalty: 2, reason: 'two-handed' });
  });

  it('returns 2 (routing) for a shielded unit that is routing regardless of weapon', () => {
    expect(getShieldPenalty({ isShielded: true, weaponString: 'Longsword,5,1d8,false,1,0,0,false,false,false,false,1,true,Dex', activeWeaponIndex: 0, currentFormation: 'Routed' })).toEqual({ penalty: 2, reason: 'routing' });
  });

  it('returns 0 for a routing unit without a shield', () => {
    expect(getShieldPenalty({ isShielded: false, weaponString: 'Longsword,5,1d8,false,1,0,0,false,false,false,false,1,true,Dex', activeWeaponIndex: 0, currentFormation: 'Routed' })).toEqual({ penalty: 0 });
  });

  it('defaults to the first weapon when activeWeaponIndex is missing', () => {
    expect(getShieldPenalty({ isShielded: true, weaponString: 'Greatsword,5,2d6,false,1,0,0,false,false,false,true,1,true,Dex', activeWeaponIndex: undefined as any, currentFormation: 'Open Order' })).toEqual({ penalty: 2, reason: 'two-handed' });
  });
});

describe('effectiveAc', () => {
  const oneHand = 'Longsword,5,1d8,false,1,0,0,false,false,false,false,1,true,Dex';
  const f = (melee_ac_modifier: number, range_ac_modifier = 0) => ({ name: 'X', melee_ac_modifier, range_ac_modifier } as unknown as Formation);
  const unit = (over: Partial<Parameters<typeof effectiveAc>[0]> = {}) => ({
    baselineAc: 16, isShielded: true, weaponString: oneHand, activeWeaponIndex: 0, currentFormation: 'Close Order', isHero: false, effects: [], ...over,
  });

  it('applies formation AC from the front/flank', () => {
    expect(effectiveAc(unit(), f(2), 'front')).toBe(18);
    expect(effectiveAc(unit(), f(2), 'flank')).toBe(18);
  });

  it('gives NO formation AC from the rear (uniform rule)', () => {
    expect(effectiveAc(unit(), f(2), 'rear')).toBe(16);
  });

  it('keeps the 360 shield at the rear', () => {
    // baseline includes the shield; rear only loses the formation term.
    expect(effectiveAc(unit({ isShielded: true }), f(2), 'rear')).toBe(16);
  });

  it('drops the shield for a two-handed active weapon (every direction)', () => {
    const twoHand = { ...unit(), weaponString: 'Greatsword,5,2d6,false,1,0,0,false,false,false,true,1,true,Dex' };
    expect(effectiveAc(twoHand, f(1), 'front')).toBe(15); // 16 + 1 - 2
    expect(effectiveAc(twoHand, f(1), 'rear')).toBe(14);  // 16 + 0 - 2
  });

  it('treats heroes as all-front (no rear penalty)', () => {
    expect(effectiveAc(unit({ isHero: true }), f(2), 'rear')).toBe(18);
  });

  it('uses range_ac_modifier for ranged attacks (melee vs ranged split)', () => {
    expect(effectiveAc(unit(), f(2, 4), 'front', true)).toBe(20); // 16 + 4
    expect(effectiveAc(unit(), f(2, 4), 'flank', true)).toBe(20);
    expect(effectiveAc(unit(), f(2, 4), 'rear', true)).toBe(16);  // rear loses it
    expect(effectiveAc(unit(), f(2, 4), 'front', false)).toBe(18); // melee uses the melee term
    // range defaults to 0 (data-driven) → no formation term vs ranged
    expect(effectiveAc(unit(), f(2), 'front', true)).toBe(16);
  });

  it('adds ac-effect bonuses, mode-scoped and applied at the rear', () => {
    const flat = unit({ effects: [{ kind: 'ac', dice: '2' }] as any });
    expect(effectiveAc(flat, f(0), 'front', false)).toBe(18); // 16 + 2
    expect(effectiveAc(flat, f(0), 'front', true)).toBe(18);
    expect(effectiveAc(flat, f(0), 'rear', false)).toBe(18);  // aura applies at the rear too
    const meleeOnly = unit({ effects: [{ kind: 'ac', dice: '1', mode: 'melee' }] as any });
    expect(effectiveAc(meleeOnly, f(0), 'front', false)).toBe(17);
    expect(effectiveAc(meleeOnly, f(0), 'front', true)).toBe(16); // ranged ignores melee-only
  });

  it('cover (zone ac) maxes with formation cover, never stacks, and stays 360°', () => {
    const zoned = unit({ effects: [{ kind: 'ac', dice: '5', zoneHex: { q: 0, r: 0, s: 0 } }] as any });
    expect(effectiveAc(zoned, f(2), 'front', false)).toBe(21); // max(2, 5) = 5 → 16 + 5
    expect(effectiveAc(zoned, f(2), 'rear', false)).toBe(21);  // zone cover is 360°, formation rear = 0
  });

  it('direct unit ac (buff) stacks on top of cover', () => {
    const buffed = unit({ effects: [
      { kind: 'ac', dice: '5', zoneHex: { q: 0, r: 0, s: 0 } },
      { kind: 'ac', dice: '2' },
    ] as any });
    expect(effectiveAc(buffed, f(2), 'front', false)).toBe(23); // cover max(2,5)=5 + buff 2 = 7
  });

  it('wall cover maxes with formation/zone cover instead of stacking', () => {
    const zoned = unit({ effects: [{ kind: 'ac', dice: '5', zoneHex: { q: 0, r: 0, s: 0 } }] as any });
    expect(effectiveAc(zoned, f(2), 'front', false, 3)).toBe(21); // max(2, 5, 3) = 5
    expect(effectiveAc(unit(), f(2), 'front', false, 3)).toBe(19); // max(2, 0, 3) = 3
    expect(effectiveAc(unit(), f(2), 'rear', false, 3)).toBe(19);  // max(0, 0, 3) = 3 (wall directional)
  });
});

describe('heroAuraBonus', () => {
  const alliances = { blue: 'friendly' as const, red: 'enemy' as const };
  const auraMod = (kind: string, dice: string, radius = 1, mode?: 'melee' | 'ranged') =>
    ({ key: 'a', name: kind, color: '#fff', kind, dice, aura: true, radius, duration: 1, turnsLeft: 1, ...(mode ? { mode } : {}) }) as any;
  const hero = (over: Record<string, unknown> = {}) => ({
    id: 'h', isHero: true, isDeleted: false, hidden: false, currentUnitHp: 10,
    attachedToUnitId: null, attachedPosition: null, heroicInspirationActive: false,
    hex: { q: 0, r: 0, s: 0 }, elevation: 0, team: 'blue', effects: [], ...over,
  }) as any;
  const ally = (over: Record<string, unknown> = {}) => ({
    id: 'u', isHero: false, hex: { q: 1, r: 0, s: -1 }, elevation: 0, team: 'blue', ...over,
  }) as any;

  afterEach(() => setHeroMoraleBoostEnabled(false));

  it('is all-zero when the scenario toggle is off', () => {
    setHeroMoraleBoostEnabled(false);
    const h = hero({ attachedToUnitId: 'u', attachedPosition: 'front', effects: [auraMod('attack', '1')] });
    expect(heroAuraBonus(ally(), [h, ally()], alliances)).toEqual({ attack: 0, ac: 0, damage: 0, save: 0 });
  });

  it('radiates an attack/AC/damage/save aura from a leading hero to a nearby ally', () => {
    setHeroMoraleBoostEnabled(true);
    const h = hero({ attachedToUnitId: 'u', attachedPosition: 'front', effects: [auraMod('attack', '1'), auraMod('ac', '1'), auraMod('damage', '1'), auraMod('save_bonus', '1')] });
    expect(heroAuraBonus(ally(), [h, ally()], alliances)).toEqual({ attack: 1, ac: 1, damage: 1, save: 1 });
  });

  it('radiates for an inspired hero even when protected/moved to the back', () => {
    setHeroMoraleBoostEnabled(true);
    const h = hero({ attachedToUnitId: 'u', attachedPosition: 'back', heroicInspirationActive: true, effects: [auraMod('attack', '1')] });
    expect(heroAuraBonus(ally(), [h, ally()], alliances).attack).toBe(1);
  });

  it('is zero for a protected, non-inspired hero', () => {
    setHeroMoraleBoostEnabled(true);
    const h = hero({ attachedToUnitId: 'u', attachedPosition: 'back', effects: [auraMod('attack', '1')] });
    expect(heroAuraBonus(ally(), [h, ally()], alliances).attack).toBe(0);
  });

  it('never applies to a hero recipient', () => {
    setHeroMoraleBoostEnabled(true);
    const h = hero({ attachedToUnitId: 'x', attachedPosition: 'front', effects: [auraMod('attack', '1')] });
    expect(heroAuraBonus(hero({ hex: { q: 1, r: 0, s: -1 } }), [h], alliances).attack).toBe(0);
  });

  it('honours the radius (0 = own hex only)', () => {
    setHeroMoraleBoostEnabled(true);
    const inspired = (over: Record<string, unknown> = {}) => hero({ heroicInspirationActive: true, ...over });
    // radius 0 → only the hero's own hex.
    expect(heroAuraBonus(ally(), [inspired({ effects: [auraMod('attack', '1', 0)] })], alliances).attack).toBe(0);
    // radius 1 → the adjacent ally is covered.
    expect(heroAuraBonus(ally(), [inspired({ effects: [auraMod('attack', '1', 1)] })], alliances).attack).toBe(1);
  });

  it('uses the elevation band: not a 10-ft-higher adjacent hex, but the same hex ±10 ft', () => {
    setHeroMoraleBoostEnabled(true);
    const inspired = (over: Record<string, unknown> = {}) => hero({ heroicInspirationActive: true, effects: [auraMod('attack', '1')], ...over });
    expect(heroAuraBonus(ally({ elevation: 0 }), [inspired({ hex: { q: 0, r: 0, s: 0 }, elevation: 10 })], alliances).attack).toBe(0);
    expect(heroAuraBonus(ally({ hex: { q: 0, r: 0, s: 0 }, elevation: 0 }), [inspired({ hex: { q: 0, r: 0, s: 0 }, elevation: 10 })], alliances).attack).toBe(1);
  });

  it('scopes attack/AC/damage auras by melee/ranged and takes the best hero per channel', () => {
    setHeroMoraleBoostEnabled(true);
    const meleeOnly = hero({ id: 'h1', attachedToUnitId: 'u', attachedPosition: 'front', effects: [auraMod('attack', '1', 1, 'melee')] });
    const ranged = hero({ id: 'h2', attachedToUnitId: 'u', attachedPosition: 'front', effects: [auraMod('attack', '2', 1, 'ranged')] });
    const both = [meleeOnly, ranged, ally()];
    expect(heroAuraBonus(ally(), both, alliances, false).attack).toBe(1); // melee only
    expect(heroAuraBonus(ally(), both, alliances, true).attack).toBe(2);  // ranged only
  });
});

describe('acVsWarMachine', () => {
  const u = (over: Record<string, unknown> = {}) => ({ baseAc: 10, effects: [], ...over }) as any;

  it('uses the UNARMOURED base AC (armour/formation ignored)', () => {
    // baselineAc (armour) is irrelevant; only baseAc matters.
    expect(acVsWarMachine(u({ baseAc: 14, baselineAc: 20 }), false)).toBe(14);
  });

  it('adds wall cover', () => {
    expect(acVsWarMachine(u({ baseAc: 14 }), false, 3)).toBe(17);
  });

  it('takes the best of wall vs hex-structure/zone cover (cover never stacks)', () => {
    const zoned = u({ baseAc: 10, effects: [{ kind: 'ac', dice: '5', zoneHex: { q: 0, r: 0, s: 0 } }] });
    expect(acVsWarMachine(zoned, false, 3)).toBe(15); // max(3, 5) = 5 → 10 + 5
  });

  it('adds direct `ac` effects (buffs), ignores the hero aura', () => {
    const buffed = u({ baseAc: 10, effects: [{ kind: 'ac', dice: '2' }] });
    expect(acVsWarMachine(buffed, false)).toBe(12);
  });
});
