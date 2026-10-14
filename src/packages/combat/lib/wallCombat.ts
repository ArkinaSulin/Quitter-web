// src/packages/combat/lib/wallCombat.ts
// Attacking a destructible wall segment (Phase 2). There is no to-hit roll: a
// unit that can REACH the edge hits it, then the wall's Damage Threshold decides
// whether the blow lands. Reach is melee when the attacker stands on one of the
// edge's two hexes AND faces the wall within its formation's attack arcs, else
// ranged when its weapon's max range covers the nearer of the two (ranged arcs
// apply). No AGR, no retaliation, no crit/charge doubling.
import { Unit, Hex, Formation, hexDistance } from '@/types/gameProtocol';
import { Wall, EdgeRef, applyWallDamage, isDestructibleWall, WallDamageResult } from '@/packages/movement';
import { determineCombatPosition } from '@/packages/combat/lib/unitCombat';
import { clampDamage, rollDamage, rollD20 } from '@/packages/primitives';
import { arcOfTarget } from '@/packages/primitives';
import { canMeleeTarget, canRangedTarget } from '@/packages/movement';
import { isUnitRouted } from '@/packages/morale';
import { isRangedCapableWeapon } from '@/packages/combat/lib/archerReaction';

export type WallAttackKind = 'melee' | 'ranged' | null;

export interface WallWeapon {
  damageDice: string;
  range?: number;
  maxRange?: number;
}

const hexAt = (q: number, r: number): Hex => ({ q, r, s: -q - r });

/** The two hexes sharing the edge (canonical hex + its neighbour). */
export function edgeHexes(ref: EdgeRef): [Hex, Hex] {
  return [hexAt(ref.aq, ref.ar), hexAt(ref.bq, ref.br)];
}

/** The endpoint hex of the edge nearest the attacker (used for range). */
function nearerHex(attackerHex: Hex, ref: EdgeRef): Hex {
  const [a, b] = edgeHexes(ref);
  return hexDistance(attackerHex, a) <= hexDistance(attackerHex, b) ? a : b;
}

/**
 * How (if at all) `attacker` can strike the wall edge `ref`. Melee is gated by
 * the universal attack-arc rule: the attacker must stand on one of the edge's
 * two hexes AND face the wall (toward the opposite hex) within its formation's
 * melee arcs (normal = front only; Scattered/Hero = all around). A unit on
 * either side of the wall may strike it. Ranged is gated by the formation's
 * ranged arcs.
 */
export function wallAttackKind(
  attacker: Pick<Unit, 'hex' | 'facing' | 'currentFormation' | 'isHero'>,
  ref: EdgeRef,
  weapon: WallWeapon | null | undefined,
  form?: Formation | null,
): WallAttackKind {
  if (!weapon) return null;
  const onEdge =
    (attacker.hex.q === ref.aq && attacker.hex.r === ref.ar) ||
    (attacker.hex.q === ref.bq && attacker.hex.r === ref.br);
  if (onEdge) {
    if (isUnitRouted(attacker)) return null;
    const [a, b] = edgeHexes(ref);
    // The wall lies toward the edge's OTHER hex — face it to strike.
    const far = attacker.hex.q === a.q && attacker.hex.r === a.r ? b : a;
    const arc = determineCombatPosition(far, attacker.hex, attacker.facing);
    if (!canMeleeTarget(form, arc)) return null;
    return 'melee';
  }
  const range = weapon.range ?? 1;
  const maxRange = Math.max(range, weapon.maxRange ?? range);
  if (!isRangedCapableWeapon({ range, maxRange })) return null;
  const nearer = nearerHex(attacker.hex, ref);
  if (!canRangedTarget(form, arcOfTarget(attacker.hex, attacker.facing, nearer))) return null;
  return hexDistance(attacker.hex, nearer) <= maxRange ? 'ranged' : null;
}

export interface WallAttackResult extends WallDamageResult {
  /** The rolled weapon damage (before the DT gate). */
  damage: number;
  /** Each attack's raw damage roll (before the DT gate), in engine order (hits only). */
  rolls: number[];
  /** Each attack's d20 to-hit face, in engine order. */
  toHit: number[];
  /** Attacks that beat the wall's AC. */
  hits: number;
}

/**
 * Resolve `attacks` attacks against a wall. Each attack first rolls to-hit
 * (`d20 + attackBonus >= wall.ac`, default AC 10; nat 1 misses, nat 20 hits) —
 * a miss deals nothing. Each HIT rolls weapon damage, gated by the wall's Damage
 * Threshold (a blow BELOW DT is shrugged; at/above DT deals full); surviving hits
 * are summed and applied once.
 */
export function resolveWallAttack(
  wall: Wall,
  weapon: WallWeapon,
  rng: () => number,
  attacks = 1,
  attackBonus = 0,
): WallAttackResult {
  if (!isDestructibleWall(wall)) {
    return { wall, applied: 0, destroyed: false, deflected: true, damage: 0, rolls: [], toHit: [], hits: 0 };
  }
  const ac = wall.ac ?? 10;
  const dt = Math.max(0, wall.dt ?? 0);
  let damage = 0;
  let surmount = 0;
  let hits = 0;
  const rolls: number[] = [];
  const toHit: number[] = [];
  for (let i = 0; i < Math.max(1, attacks); i++) {
    const roll = rollD20(rng);
    toHit.push(roll);
    const hit = roll === 1 ? false : roll === 20 ? true : roll + attackBonus >= ac;
    if (!hit) continue;
    hits += 1;
    const r = clampDamage(rollDamage(weapon.damageDice, rng));
    rolls.push(r);
    damage += r;
    if (r >= dt) surmount += r;
  }
  return { ...applyWallDamage(wall, surmount), damage, rolls, toHit, hits };
}
