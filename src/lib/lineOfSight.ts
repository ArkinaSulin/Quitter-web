// src/lib/lineOfSight.ts
// Hex-centre line of sight between a shooter and its target. Any other unit on
// the line (friendly or hostile) blocks the shot, turning it into an "indirect
// shot" resolved at disadvantage. Concealed (hidden), destroyed and dead units
// exert no presence and never block — a hidden unit must not reveal itself by
// imposing a penalty.
import { Hex, Unit } from '@/types/gameProtocol';
import { hexLine } from './hexLine';

const hexKey = (h: { q: number; r: number }): string => `${h.q},${h.r}`;

/**
 * Units standing strictly BETWEEN `from` and `to` (endpoints excluded). Hidden,
 * deleted and dead units are ignored, as are the ids in `excludeIds` (normally
 * the attacker and defender).
 */
export function unitsBlockingLine(
  from: Hex,
  to: Hex,
  units: Unit[],
  excludeIds: ReadonlySet<string> = new Set(),
): Unit[] {
  const line = hexLine(from, to);
  if (line.length <= 2) return [];
  const between = new Set(line.slice(1, -1).map(hexKey));
  if (between.size === 0) return [];
  return units.filter(u =>
    !u.isDeleted &&
    !u.hidden &&
    (u.currentUnitHp ?? 0) > 0 &&
    !excludeIds.has(u.id) &&
    between.has(hexKey(u.hex)),
  );
}

/** True when nothing stands between `from` and `to` (clear line of sight). */
export function hasLineOfSight(
  from: Hex,
  to: Hex,
  units: Unit[],
  excludeIds: ReadonlySet<string> = new Set(),
): boolean {
  return unitsBlockingLine(from, to, units, excludeIds).length === 0;
}
