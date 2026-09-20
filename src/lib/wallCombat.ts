// src/lib/wallCombat.ts
// Attacking a destructible wall segment (Phase 2). There is no to-hit roll: a
// unit that can REACH the edge hits it, then the wall's Damage Threshold decides
// whether the blow lands. Reach is melee when the attacker stands on one of the
// edge's two hexes, else ranged when its weapon's max range covers the nearer
// of the two. No AGR, no retaliation, no crit/charge doubling.
import { Unit, Hex, hexDistance } from '@/types/gameProtocol';
import { Wall, EdgeRef, applyWallDamage, isDestructibleWall, WallDamageResult } from './walls';
import { rollDamage } from './unitCombat';
import { isRangedCapableWeapon } from './archerReaction';

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

/** How (if at all) `attacker` can strike the wall edge `ref`. */
export function wallAttackKind(
  attacker: Pick<Unit, 'hex'>,
  ref: EdgeRef,
  weapon: WallWeapon | null | undefined,
): WallAttackKind {
  if (!weapon) return null;
  const onEdge =
    (attacker.hex.q === ref.aq && attacker.hex.r === ref.ar) ||
    (attacker.hex.q === ref.bq && attacker.hex.r === ref.br);
  if (onEdge) return 'melee';
  const range = weapon.range ?? 1;
  const maxRange = Math.max(range, weapon.maxRange ?? range);
  if (!isRangedCapableWeapon({ range, maxRange })) return null;
  return hexDistance(attacker.hex, nearerHex(attacker.hex, ref)) <= maxRange ? 'ranged' : null;
}

export interface WallAttackResult extends WallDamageResult {
  /** The rolled weapon damage (before the DT gate). */
  damage: number;
}

/** Roll one attack's damage against a wall and apply HP/DT. */
export function resolveWallAttack(
  wall: Wall,
  weapon: WallWeapon,
  rng: () => number,
): WallAttackResult {
  if (!isDestructibleWall(wall)) {
    return { wall, applied: 0, destroyed: false, deflected: true, damage: 0 };
  }
  const damage = Math.max(0, rollDamage(weapon.damageDice, rng));
  return { ...applyWallDamage(wall, damage), damage };
}
