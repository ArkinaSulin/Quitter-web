// src/packages/ships/lib/shipCombat.ts
// Pure ship combat math: range bands, firing arcs, attack mode, mass-scaled
// damage, ram/collision, weighted component selection, and reload progression.
// The UI/engine slice wires these into commands later.

import { Hex } from '@/types/gameProtocol';
import { HEX_DIRS } from '@/packages/primitives';
import { ShipAreaShape, ShipDeckRegion, ShipSaveChoice, ShipWeapon, WeaponArc } from '@/types/ship';
import { ShipBuild } from './shipStats';
import { deckOrderedCardKeys, findCardSlot } from './deckLayout';
import { effectiveWeaponArcs } from './weaponArcs';
import { weaponById, weaponTons } from './shipStats';

export type ShipRangeBand = 'tooClose' | 'normal' | 'disadvantage' | 'outOfRange' | 'invalid';

export interface ShipAttackMode {
  mode: 'none' | 'normal' | 'disadvantage';
  reason: string;
}

/** Range band for a ship weapon: <=min no shot, >max no shot, >range disadvantage. */
export function shipRangeBand(distance: number, weapon: Pick<ShipWeapon, 'minRange' | 'range' | 'maxRange'>): ShipRangeBand {
  const d = Math.max(0, Math.floor(distance));
  if (!Number.isFinite(d)) return 'invalid';
  if (weapon.minRange > 0 && d <= weapon.minRange) return 'tooClose';
  if (weapon.maxRange > 0 && d > weapon.maxRange) return 'outOfRange';
  if (weapon.range > 0 && d > weapon.range) return 'disadvantage';
  return 'normal';
}

/**
 * Relative sector of a target: bow (4,5), stern (1,2), port (3), starboard (0)
 * around the ship's facing. `arcsEnabled` false = 360°.
 */
export function shipTargetArc(origin: Hex, facing: number, target: Hex): WeaponArc | null {
  const dq = target.q - origin.q;
  const dr = target.r - origin.r;
  if (dq === 0 && dr === 0) return null;
  const idx = HEX_DIRS.findIndex(d => d.q === dq && d.r === dr);
  if (idx < 0) return null;
  const rel = ((idx - facing) % 6 + 6) % 6;
  if (rel === 4 || rel === 5) return 'bow';
  if (rel === 1 || rel === 2) return 'stern';
  if (rel === 3) return 'port';
  return 'starboard';
}

export function shipArcAllowed(
  arcs: WeaponArc[],
  targetArc: WeaponArc | null,
  arcsEnabled = true,
): boolean {
  if (!arcsEnabled) return true;
  if (!targetArc) return false;
  return arcs.includes(targetArc);
}

/** Combine range + arc into the attack mode. */
export function shipAttackMode(
  distance: number,
  weapon: Pick<ShipWeapon, 'minRange' | 'range' | 'maxRange'>,
  arcs: WeaponArc[],
  origin: Hex,
  facing: number,
  target: Hex,
  arcsEnabled = true,
): ShipAttackMode {
  const band = shipRangeBand(distance, weapon);
  if (band === 'tooClose') return { mode: 'none', reason: 'Too close (inside minimum range).' };
  if (band === 'outOfRange') return { mode: 'none', reason: 'Out of range.' };
  const arc = shipTargetArc(origin, facing, target);
  if (!shipArcAllowed(arcs, arc, arcsEnabled)) {
    return { mode: 'none', reason: 'Target is outside this weapon’s firing arc.' };
  }
  return band === 'disadvantage'
    ? { mode: 'disadvantage', reason: 'Beyond normal range (disadvantage).' }
    : { mode: 'normal', reason: '' };
}

/** Ram/collision damage dice: min(floor(ton/10), 16)d(speed), die faces >= 1. */
export function shipRamDamage(ton: number, speed: number): { count: number; faces: number } {
  const count = Math.max(1, Math.min(16, Math.floor(Math.max(0, ton) / 10)));
  const faces = Math.max(1, Math.floor(speed));
  return { count, faces };
}

/** Collision without a ram: half the ram damage (rounded down). */
export function shipCollisionDamage(ton: number, speed: number): { count: number; faces: number } {
  const ram = shipRamDamage(ton, speed);
  return { count: Math.max(1, Math.floor(ram.count / 2)), faces: ram.faces };
}

export function rollShipDamage(count: number, faces: number, rng: () => number = Math.random): number {
  let total = 0;
  for (let i = 0; i < Math.max(0, count); i += 1) {
    total += 1 + Math.floor(rng() * Math.max(1, faces));
  }
  return total;
}

export interface ShipHitCard {
  key: string;
  name: string;
  tons: number;
  safe?: boolean;
  kind?: 'component' | 'weapon';
}

/**
 * Pick an eligible card weighted by tonnage. Weapons are always eligible;
 * safe/armour cards are excluded.
 */
export function pickShipComponent(cards: ShipHitCard[], rng: () => number = Math.random): ShipHitCard | null {
  const eligible = cards.filter(c => !c.safe && c.tons > 0);
  const total = eligible.reduce((sum, c) => sum + c.tons, 0);
  if (total <= 0) return null;
  let roll = rng() * total;
  for (const card of eligible) {
    roll -= card.tons;
    if (roll < 0) return card;
  }
  return eligible[eligible.length - 1] ?? null;
}

export interface ShipWeaponReloadState {
  progress: number;
  armed: boolean;
}

/** Advance one step of loading. `reloadSteps = 0` is armed immediately. */
export function advanceShipReload(state: ShipWeaponReloadState, reloadSteps: number): ShipWeaponReloadState {
  if (state.armed) return state;
  const needed = Math.max(0, Math.floor(reloadSteps));
  if (needed === 0) return { progress: 0, armed: true };
  const progress = Math.max(0, Math.floor(state.progress)) + 1;
  return { progress, armed: progress >= needed };
}

/** Firing consumes the loaded state. */
export function fireShipWeapon(): ShipWeaponReloadState {
  return { progress: 0, armed: false };
}

export interface ShipWeaponCard {
  key: string;
  weapon: ShipWeapon;
  region: ShipDeckRegion | null;
  arcs: WeaponArc[];
  crew: number;
  tons: number;
}

/** Every placed weapon card, with its deck region and effective firing arcs. */
export function shipWeaponCards(build: ShipBuild): ShipWeaponCard[] {
  const cards: ShipWeaponCard[] = [];
  if (!build.deckLayout) return cards;
  for (const key of deckOrderedCardKeys(build.deckLayout)) {
    if (!key.startsWith('weapon:')) continue;
    const rowId = key.slice('weapon:'.length).replace(/:\d+$/, '');
    const row = build.templateWeapons.find(w => w.id === rowId);
    const weapon = row ? weaponById(build.weaponsCatalog, row.weaponId) : undefined;
    if (!weapon) continue;
    const slot = findCardSlot(build.deckLayout, key);
    cards.push({
      key,
      weapon,
      region: slot?.region ?? null,
      arcs: slot ? effectiveWeaponArcs(slot.region, build.weaponArcs?.[key]) : [],
      crew: weapon.crew,
      tons: weaponTons(weapon),
    });
  }
  return cards;
}

export function weaponArea(weapon: Pick<ShipWeapon, 'magicDimension' | 'shape' | 'savingThrow' | 'saveDC' | 'onSaveHalfOrNeg'>): {
  dimension: number;
  shape: ShipAreaShape;
  savingThrow: ShipSaveChoice;
  saveDC: number;
  halfOnSave: boolean;
} {
  return {
    dimension: Math.max(0, Math.floor(weapon.magicDimension)),
    shape: weapon.shape,
    savingThrow: weapon.savingThrow,
    saveDC: Math.max(0, Math.floor(weapon.saveDC)),
    halfOnSave: weapon.onSaveHalfOrNeg,
  };
}
