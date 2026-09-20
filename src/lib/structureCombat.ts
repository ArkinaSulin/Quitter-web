// src/lib/structureCombat.ts
// Attacking a HEX structure (gate / tower). No to-hit roll (like walls): reaching
// the hex is the hit, then the Damage Threshold gates the blow. A structure with a
// door resolves DOOR-FIRST — the door takes damage until it is destroyed, then the
// structure HP is exposed.
import { Unit, Hex, hexDistance } from '@/types/gameProtocol';
import { StructureTemplate, StructureInstance } from '@/types/structure';
import { rollDamage } from './unitCombat';
import { isRangedCapableWeapon } from './archerReaction';

export type HexStructureAttackKind = 'melee' | 'ranged' | null;

export interface HexStructureWeapon {
  damageDice: string;
  range?: number;
  maxRange?: number;
}

/** How (if at all) `attacker` can strike the structure on `target`. */
export function hexStructureAttackKind(
  attacker: Pick<Unit, 'hex'>,
  target: Hex,
  weapon: HexStructureWeapon | null | undefined,
): HexStructureAttackKind {
  if (!weapon) return null;
  const dist = hexDistance(attacker.hex, target);
  if (dist <= 1) return 'melee';
  const range = weapon.range ?? 1;
  const maxRange = Math.max(range, weapon.maxRange ?? range);
  if (!isRangedCapableWeapon({ range, maxRange })) return null;
  return dist <= maxRange ? 'ranged' : null;
}

/** Max door HP of a template (null = no door). */
export function structureDoorMax(t: StructureTemplate): number | null {
  return t.doorHp ?? null;
}

/** A hex structure is attackable while a door stands or its HP is destructible. */
export function isAttackableHexStructure(t: StructureTemplate, inst: StructureInstance): boolean {
  const doorMax = t.doorHp ?? null;
  const doorCur = inst.doorHp ?? t.doorHp ?? 0;
  const maxHp = inst.maxHp ?? t.maxHp;
  return (doorMax !== null && doorCur > 0) || maxHp > 0;
}

export interface HexStructureAttackResult {
  /** Rolled weapon damage (before the DT gate). */
  damage: number;
  /** Damage actually applied (0 when deflected). */
  applied: number;
  deflected: boolean;
  /** The blow landed on the door (rather than the structure). */
  hitDoor: boolean;
  /** Door HP after the blow (null when the structure has no door). */
  doorHpAfter: number | null;
  /** Structure HP after the blow. */
  hpAfter: number;
  /** The structure was destroyed (remove the instance). */
  destroyed: boolean;
}

/** Roll one attack against a hex structure and apply DT + door-first damage. */
export function resolveHexStructureAttack(
  template: StructureTemplate,
  instance: StructureInstance,
  weapon: HexStructureWeapon,
  rng: () => number,
): HexStructureAttackResult {
  const doorMax = template.doorHp ?? null;
  const doorCur = instance.doorHp ?? template.doorHp ?? 0;
  const doorAlive = doorMax !== null && doorCur > 0;
  const maxHp = instance.maxHp ?? template.maxHp;
  const hp = instance.hp ?? maxHp;
  const dt = instance.dt ?? template.dt ?? 0;
  const damage = Math.max(0, rollDamage(weapon.damageDice, rng));

  if (damage <= dt) {
    return { damage, applied: 0, deflected: true, hitDoor: doorAlive, doorHpAfter: doorMax !== null ? doorCur : null, hpAfter: hp, destroyed: false };
  }
  if (doorAlive) {
    return { damage, applied: damage, deflected: false, hitDoor: true, doorHpAfter: Math.max(0, doorCur - damage), hpAfter: hp, destroyed: false };
  }
  if (maxHp <= 0) {
    // No door left and the structure is indestructible scenery.
    return { damage, applied: 0, deflected: true, hitDoor: false, doorHpAfter: doorMax !== null ? 0 : null, hpAfter: hp, destroyed: false };
  }
  const hpAfter = Math.max(0, hp - damage);
  return { damage, applied: damage, deflected: false, hitDoor: false, doorHpAfter: doorMax !== null ? 0 : null, hpAfter, destroyed: hpAfter <= 0 };
}
