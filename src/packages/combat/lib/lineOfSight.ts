// src/packages/combat/lib/lineOfSight.ts
// Hex-centre line of sight between a shooter and its target. Any other unit on
// the line (friendly or hostile), or any non-decorative structure the line
// crosses, blocks the shot, turning it into an "indirect shot" resolved at
// disadvantage. Concealed (hidden), destroyed and dead units exert no presence
// and never block — a hidden unit must not reveal itself by imposing a penalty.
import { Hex, Unit } from '@/types/gameProtocol';
import { hexLine } from '@/packages/primitives';
import { MapStructures, structureElevation, edgeStructureElevation } from '@/packages/movement';
import { StructureTemplate } from '@/types/structure';
import { edgeRef, directionBetween } from '@/packages/movement';

/** The only unit fields LoS cares about — callers may pass partial units. */
export type LosUnit = Pick<Unit, 'id' | 'hex' | 'isDeleted' | 'hidden' | 'currentUnitHp'>;

const hexKey = (h: { q: number; r: number }): string => `${h.q},${h.r}`;

/**
 * Units standing strictly BETWEEN `from` and `to` (endpoints excluded). Hidden,
 * deleted and dead units are ignored, as are the ids in `excludeIds` (normally
 * the attacker and defender).
 */
export function unitsBlockingLine(
  from: Hex,
  to: Hex,
  units: LosUnit[],
  excludeIds: ReadonlySet<string> = new Set(),
): LosUnit[] {
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
  units: LosUnit[],
  excludeIds: ReadonlySet<string> = new Set(),
  structures?: MapStructures | null,
  templates?: Record<string, StructureTemplate> | null,
  opts?: { fromElevation?: number; toElevation?: number },
): boolean {
  return unitsBlockingLine(from, to, units, excludeIds).length === 0
    && !structuresBlockingLine(from, to, structures, templates, opts);
}

/**
 * True when an intervening structure blocks the shot — i.e. the shot's side-view
 * LINE (from `fromElevation` to `toElevation`) passes **below the structure's
 * top** at the structure's horizontal position.
 *
 * Only structures **strictly between** the endpoints count:
 * - a **hex structure** on a hex strictly between A and B, or
 * - an **edge structure** on an edge between two strictly-between hexes.
 * A structure on A's or B's own hex, and the edges immediately in front of A or B,
 * are handled by other mechanics (cover) and never block LoS. Decorative
 * structures (top ≤ 0) never block. At exactly the top height the line CLEARS.
 */
export function structuresBlockingLine(
  from: Hex,
  to: Hex,
  structures: MapStructures | null | undefined,
  templates: Record<string, StructureTemplate> | null | undefined,
  opts?: { fromElevation?: number; toElevation?: number },
): boolean {
  if (!structures) return false;
  const line = hexLine(from, to);
  const n = line.length - 1;
  if (n <= 0) return false;
  const fromElev = opts?.fromElevation ?? 0;
  const toElev = opts?.toElevation ?? 0;
  const lineElev = (t: number): number => fromElev + (toElev - fromElev) * t;
  /** A structure with top `top` blocks when the shot's line at `t` is below it. */
  const blocks = (top: number, t: number): boolean => top > 0 && lineElev(t) < top;
  // Edge structures on edges between two STRICTLY-BETWEEN hexes: i in [1, n-2]
  // (the first edge, in front of A, and the last, in front of B, never block).
  // An edge wall's height is derived (max of the two adjacent hex surfaces, min 10).
  for (let i = 1; i <= n - 2; i++) {
    const dir = directionBetween(line[i], line[i + 1]);
    if (dir < 0) continue;
    const ref = edgeRef(line[i].q, line[i].r, dir);
    if (!structures[ref.key]) continue;
    const top = edgeStructureElevation(line[i], line[i + 1], structures, templates);
    if (blocks(top, (i + 0.5) / n)) return true;
  }
  // Hex structures strictly between the endpoints.
  for (let i = 1; i <= n - 1; i++) {
    const inst = structures[`${line[i].q},${line[i].r}`];
    if (!inst) continue;
    const top = structureElevation(templates?.[inst.templateId], inst);
    if (blocks(top, i / n)) return true;
  }
  return false;
}
