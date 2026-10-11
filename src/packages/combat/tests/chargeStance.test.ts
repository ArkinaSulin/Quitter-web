import { describe, it, expect } from 'vitest';
import { chargeStanceFor, isSwooping, ChargeStanceInput } from '@/packages/combat/lib/chargeStance';
import { Formation } from '@/types/gameProtocol';

const form = (canCharge: boolean): Formation => ({ can_charge: canCharge } as unknown as Formation);

const unit = (over: Partial<ChargeStanceInput['unit']> = {}): ChargeStanceInput['unit'] => ({
  isHero: false,
  canCharge: true,
  currentFormation: 'Open Order',
  isCharging: false,
  actionsAvailable: 2,
  flySpeed: 0,
  flySpeedAvailable: 0,
  elevation: 0,
  ...over,
});

const base = (over: Partial<ChargeStanceInput> = {}): ChargeStanceInput => ({
  unit: unit(),
  airborne: false,
  form: form(true),
  chargeEnabled: true,
  ...over,
});

describe('chargeStanceFor', () => {
  it('grounded, charge-capable formation → charge', () => {
    expect(chargeStanceFor(base())).toBe('charge');
  });

  it('airborne flyer with >2 available FP → swoop (unit or hero)', () => {
    expect(chargeStanceFor(base({ unit: unit({ flySpeed: 4, flySpeedAvailable: 4, elevation: 20 }), airborne: true }))).toBe('swoop');
    expect(chargeStanceFor(base({ unit: unit({ isHero: true, flySpeed: 4, flySpeedAvailable: 4, elevation: 20 }), airborne: true }))).toBe('swoop');
  });

  it('airborne flyer with ≤2 available FP → none (needs >2 FP)', () => {
    expect(chargeStanceFor(base({ unit: unit({ flySpeed: 4, flySpeedAvailable: 2, elevation: 20 }), airborne: true }))).toBeNull();
    expect(chargeStanceFor(base({ unit: unit({ flySpeed: 4, flySpeedAvailable: 0, elevation: 20 }), airborne: true }))).toBeNull();
  });

  it('airborne non-flyer (a hanging climber) → none', () => {
    expect(chargeStanceFor(base({ unit: unit({ flySpeed: 0, flySpeedAvailable: 0, elevation: 10 }), airborne: true }))).toBeNull();
  });

  it('grounded hero charges via canCharge alone (no formation arc)', () => {
    // The Hero formation row's can_charge is irrelevant — a hero is loose.
    expect(chargeStanceFor(base({ unit: unit({ isHero: true, canCharge: true }), form: form(false) }))).toBe('charge');
    expect(chargeStanceFor(base({ unit: unit({ isHero: true, canCharge: false }) }))).toBeNull();
  });

  it('grounded but not charge-capable → none', () => {
    expect(chargeStanceFor(base({ unit: unit({ canCharge: false }) }))).toBeNull();
    expect(chargeStanceFor(base({ form: form(false) }))).toBeNull();
    expect(chargeStanceFor(base({ form: null }))).toBeNull();
  });

  it('none when disabled, already charging, routed, or out of actions', () => {
    expect(chargeStanceFor(base({ chargeEnabled: false }))).toBeNull();
    expect(chargeStanceFor(base({ unit: unit({ isCharging: true }) }))).toBeNull();
    expect(chargeStanceFor(base({ unit: unit({ currentFormation: 'Routed' }) }))).toBeNull();
    expect(chargeStanceFor(base({ unit: unit({ actionsAvailable: 0 }) }))).toBeNull();
  });

  it('needs MORE than 1 action (entry costs one) — for BOTH charge and swoop', () => {
    expect(chargeStanceFor(base({ unit: unit({ actionsAvailable: 1 }) }))).toBeNull(); // ground
    expect(chargeStanceFor(base({ unit: unit({ actionsAvailable: 1, flySpeed: 4, flySpeedAvailable: 4, elevation: 20 }), airborne: true }))).toBeNull(); // swoop
  });
});

describe('isSwooping (already-declared)', () => {
  it('charging + actually airborne (own surface) only', () => {
    expect(isSwooping({ flySpeed: 4, elevation: 20, isCharging: true })).toBe(true);
    expect(isSwooping({ flySpeed: 4, elevation: 20, isCharging: false })).toBe(false);
    expect(isSwooping({ flySpeed: 4, elevation: 0, isCharging: true })).toBe(false);
    expect(isSwooping({ flySpeed: 0, elevation: 20, isCharging: true })).toBe(false);
    // Grounded on a 10-ft structure (elevation == surface) → not swooping.
    expect(isSwooping({ flySpeed: 4, elevation: 10, isCharging: true }, 10)).toBe(false);
    expect(isSwooping({ flySpeed: 4, elevation: 20, isCharging: true }, 10)).toBe(true);
  });
});
