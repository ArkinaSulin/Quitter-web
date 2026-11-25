// src/packages/ships/lib/shipDamage.ts
// Ship weapon damage is the authored `damage` string. Ram damage is the special
// case: floor(effective mass / 10) dice, each with faces equal to the hexes
// travelled without turning (docs/dev/21).

import { ShipWeapon } from '@/types/ship';

/** Dice expression for a normal ship weapon (its authored Damage field). */
export function resolveShipWeaponDamage(
  weapon: Pick<ShipWeapon, 'damage'>,
): string {
  return weapon.damage || '—';
}

export const RAM_DICE_MIN = 1;
export const RAM_DICE_MAX = 16;
export const RAM_FACES_MIN = 1;
export const RAM_FACES_MAX = 12;

export interface RamDamageDice {
  /** Number of dice: floor(effective mass / 10), clamped 1–16. */
  count: number;
  /** Die faces: hexes travelled without turning, clamped 1–12. */
  faces: number;
  /** `NdF` expression. */
  dice: string;
}

/** Ram damage dice: `[effective mass / 10] d [traveled distance without turning]`. */
export function ramDamageDice(effectiveMass: number, distance: number): RamDamageDice {
  const mass = Number.isFinite(effectiveMass) ? Math.max(0, effectiveMass) : 0;
  const travelled = Number.isFinite(distance) ? Math.max(0, distance) : 0;
  const count = Math.max(RAM_DICE_MIN, Math.min(RAM_DICE_MAX, Math.floor(mass / 10)));
  const faces = Math.max(RAM_FACES_MIN, Math.min(RAM_FACES_MAX, Math.floor(travelled)));
  return { count, faces, dice: `${count}d${faces}` };
}
