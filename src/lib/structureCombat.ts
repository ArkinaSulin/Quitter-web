// src/lib/structureCombat.ts
// Attacking a HEX structure (gate / tower). No to-hit roll (like walls): reaching
// the hex is the hit, then the Damage Threshold gates the blow. Durability is two
// pools damaged SIMULTANEOUSLY: `doorHp` gates passage, `maxHp` gates modifiers
// (<= 0 destroys the structure, removing the instance).
import { Unit, Hex, hexDistance } from '@/types/gameProtocol';
import { StructureTemplate, StructureInstance } from '@/types/structure';
import { rollDamage } from './unitCombat';
import { isRangedCapableWeapon } from './archerReaction';
import { templateDoorMax } from './structureTemplates';

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

/** Max door HP of a template (null door defaults to maxHp). */
export function structureDoorMax(t: StructureTemplate): number {
  return templateDoorMax(t);
}

/** Current door HP of a placed instance. */
export function structureDoorCurrent(t: StructureTemplate, inst: StructureInstance): number {
  return inst.doorHp ?? templateDoorMax(t);
}

/** A hex structure is attackable while a door stands or its HP is destructible. */
export function isAttackableHexStructure(t: StructureTemplate, inst: StructureInstance): boolean {
  const doorStanding = !inst.open && structureDoorCurrent(t, inst) > 0;
  const maxHp = t.maxHp;
  const hp = inst.hp ?? maxHp;
  return doorStanding || hp > 0;
}

export interface HexStructureAttackResult {
  /** Rolled weapon damage (before the DT gate). */
  damage: number;
  /** Damage actually applied (0 when deflected). */
  applied: number;
  deflected: boolean;
  /** The blow landed while a door still stood. */
  hitDoor: boolean;
  /** Door HP after the blow. */
  doorHpAfter: number;
  /** Structure HP after the blow. */
  hpAfter: number;
  /** The structure was destroyed (remove the instance). */
  destroyed: boolean;
}

/** Roll one attack against a hex structure and apply DT + simultaneous door/HP damage. */
export function resolveHexStructureAttack(
  template: StructureTemplate,
  instance: StructureInstance,
  weapon: HexStructureWeapon,
  rng: () => number,
): HexStructureAttackResult {
  const doorCur = structureDoorCurrent(template, instance);
  const doorStanding = !instance.open && doorCur > 0;
  const maxHp = template.maxHp;
  const hp = instance.hp ?? maxHp;
  const dt = template.dt ?? 0;
  const damage = Math.max(0, rollDamage(weapon.damageDice, rng));

  if (damage <= dt) {
    return { damage, applied: 0, deflected: true, hitDoor: doorStanding, doorHpAfter: doorCur, hpAfter: hp, destroyed: false };
  }
  const hpAfter = Math.max(0, hp - damage);
  const doorHpAfter = instance.open ? 0 : Math.max(0, doorCur - damage);
  return {
    damage,
    applied: damage,
    deflected: false,
    hitDoor: doorStanding,
    doorHpAfter,
    hpAfter,
    destroyed: hpAfter <= 0,
  };
}
