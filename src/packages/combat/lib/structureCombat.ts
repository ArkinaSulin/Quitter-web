// src/packages/combat/lib/structureCombat.ts
// Attacking a HEX structure (gate / tower). No to-hit roll (like walls): reaching
// the hex AND facing it within the formation's attack arcs is the hit, then the
// Damage Threshold gates the blow. Durability is two pools damaged
// SIMULTANEOUSLY: `doorHp` gates passage, `maxHp` gates modifiers (<= 0 destroys
// the structure, removing the instance).
import { Unit, Hex, Formation, hexDistance } from '@/types/gameProtocol';
import { StructureTemplate, StructureInstance } from '@/types/structure';
import { determineCombatPosition } from '@/packages/combat/lib/unitCombat';
import { clampDamage, rollDamage } from '@/packages/primitives';
import { arcOfTarget } from '@/packages/primitives';
import { canMeleeTarget, canRangedTarget } from '@/packages/movement';
import { isUnitRouted } from '@/packages/morale';
import { isRangedCapableWeapon } from '@/packages/combat/lib/archerReaction';
import { templateDoorMax } from '@/packages/movement';

export type HexStructureAttackKind = 'melee' | 'ranged' | null;

export interface HexStructureWeapon {
  damageDice: string;
  range?: number;
  maxRange?: number;
}

/**
 * How (if at all) `attacker` can strike the structure on `target`. Melee is
 * gated by the universal attack-arc rule: same hex (dist 0, resolved to 'front')
 * or an adjacent hex the attacker faces within its formation's melee arcs
 * (normal = front only; Scattered/Hero = all around). Ranged is gated by the
 * formation's ranged arcs.
 */
export function hexStructureAttackKind(
  attacker: Pick<Unit, 'hex' | 'facing' | 'currentFormation' | 'isHero'>,
  target: Hex,
  weapon: HexStructureWeapon | null | undefined,
  form?: Formation | null,
): HexStructureAttackKind {
  if (!weapon) return null;
  const dist = hexDistance(attacker.hex, target);
  if (dist <= 1) {
    if (isUnitRouted(attacker)) return null;
    const arc = determineCombatPosition(target, attacker.hex, attacker.facing);
    if (!canMeleeTarget(form, arc)) return null;
    return 'melee';
  }
  const range = weapon.range ?? 1;
  const maxRange = Math.max(range, weapon.maxRange ?? range);
  if (!isRangedCapableWeapon({ range, maxRange })) return null;
  if (!canRangedTarget(form, arcOfTarget(attacker.hex, attacker.facing, target))) return null;
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
  /** Each attack's raw damage roll (before the DT gate), in engine order. */
  rolls: number[];
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

/**
 * Roll `attacks` damage rolls against a hex structure (the unit-combat attack
 * count: row capacity × capacity multiplier × weapon attacks, plus a hero volley)
 * and apply DT + simultaneous door/HP damage. DT gates EACH hit (a hit BELOW DT
 * is shrugged; at/above DT deals full); the surviving hits are summed and applied once.
 */
export function resolveHexStructureAttack(
  template: StructureTemplate,
  instance: StructureInstance,
  weapon: HexStructureWeapon,
  rng: () => number,
  attacks = 1,
): HexStructureAttackResult {
  const doorCur = structureDoorCurrent(template, instance);
  const doorStanding = !instance.open && doorCur > 0;
  const maxHp = template.maxHp;
  const hp = instance.hp ?? maxHp;
  const dt = template.dt ?? 0;
  let damage = 0;
  let applied = 0;
  const rolls: number[] = [];
  for (let i = 0; i < Math.max(1, attacks); i++) {
    const r = clampDamage(rollDamage(weapon.damageDice, rng));
    rolls.push(r);
    damage += r;
    if (r >= dt) applied += r;
  }

  if (applied <= 0) {
    return { damage, applied: 0, rolls, deflected: true, hitDoor: doorStanding, doorHpAfter: doorCur, hpAfter: hp, destroyed: false };
  }
  const hpAfter = Math.max(0, hp - applied);
  const doorHpAfter = instance.open ? 0 : Math.max(0, doorCur - applied);
  return {
    damage,
    applied,
    rolls,
    deflected: false,
    hitDoor: doorStanding,
    doorHpAfter,
    hpAfter,
    destroyed: hpAfter <= 0,
  };
}
