// src/packages/ships/lib/shipDamage.ts
// Ship weapons may define an optional mass-scaled damage formula. The only
// supported form is `{mass/divisor}dDie`; it resolves against the carrying
// ship's designated total mass and rounds the die count up.

import { ShipWeapon } from '@/types/ship';

const MASS_FORMULA = /^\{\s*mass\s*\/\s*(\d+)\s*\}\s*d\s*(\d+)$/i;

export function isValidShipDamageFormula(formula: string): boolean {
  const value = (formula || '').trim();
  return value === '' || MASS_FORMULA.test(value);
}

export function resolveShipWeaponDamage(
  weapon: Pick<ShipWeapon, 'damage' | 'damageFormula'>,
  totalMass: number,
): string {
  const formula = (weapon.damageFormula || '').trim();
  const match = formula.match(MASS_FORMULA);
  if (!match) return weapon.damage || '—';
  const divisor = Math.max(1, Number(match[1]) || 1);
  const die = Math.max(1, Number(match[2]) || 1);
  const mass = Number.isFinite(totalMass) ? Math.max(0, totalMass) : 0;
  const count = Math.max(1, Math.ceil(mass / divisor));
  return `${count}d${die}`;
}
