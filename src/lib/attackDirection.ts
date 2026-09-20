// src/lib/attackDirection.ts
// Which side of a defender an attack comes from, at any range. Used for the
// directional AC rules (formation AC never applies from the REAR).
//
// Facing is a vertex direction (0-5) drawn facing north at 0 and rotated clockwise
// 60° per step, so the front normal is -90° + facing·60° in screen coords (y down).
// For adjacent attackers this matches determineCombatPosition exactly; for ranged
// attackers it gives a coarse bearing (front/flank/rear).
import { Hex } from '@/types/gameProtocol';

export type AttackDirection = 'front' | 'flank' | 'rear';

/** Axial hex -> unit-scale pixel position (same layout as the map). */
function axisToPixel(q: number, r: number): { x: number; y: number } {
  return { x: Math.sqrt(3) * (q + r / 2), y: 1.5 * r };
}

export function attackDirection(attackerHex: Hex, defenderHex: Hex, defenderFacing: number): AttackDirection {
  const a = axisToPixel(attackerHex.q, attackerHex.r);
  const d = axisToPixel(defenderHex.q, defenderHex.r);
  const dx = a.x - d.x;
  const dy = a.y - d.y;
  if (dx === 0 && dy === 0) return 'front';
  const bearing = (Math.atan2(dy, dx) * 180) / Math.PI; // -180..180
  const frontNormal = -90 + defenderFacing * 60;
  const diff = ((bearing - frontNormal + 540) % 360) - 180; // -180..180
  const abs = Math.abs(diff);
  if (abs <= 60) return 'front';
  if (abs <= 120) return 'flank';
  return 'rear';
}

/**
 * Which arc a TARGET lies in relative to the shooter's own facing, at any range
 * (bearing-based). This is the ranged counterpart to `determineCombatPosition`,
 * which only resolves the 6 adjacent hexes and returns 'front' for everything
 * farther away. `arcOfTarget(o, facing, t) === attackDirection(t, o, facing)`.
 */
export function arcOfTarget(originHex: Hex, facing: number, targetHex: Hex): AttackDirection {
  return attackDirection(targetHex, originHex, facing);
}
