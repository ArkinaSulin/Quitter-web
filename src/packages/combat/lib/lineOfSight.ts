// src/lib/lineOfSight.ts
// Hex-centre line of sight between a shooter and its target. Any other unit on
// the line (friendly or hostile), or any non-decorative structure the line
// crosses, blocks the shot, turning it into an "indirect shot" resolved at
// disadvantage. Concealed (hidden), destroyed and dead units exert no presence
// and never block — a hidden unit must not reveal itself by imposing a penalty.
import { Hex, Unit } from '@/types/gameProtocol';
import { hexLine } from '@/packages/primitives';
import { MapStructures } from '@/packages/movement';
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
): boolean {
  return unitsBlockingLine(from, to, units, excludeIds).length === 0
    && !structuresBlockingLine(from, to, structures, templates);
}

/**
 * True when a non-decorative structure (maxHp > 0) sits on the shot line: an
 * edge structure on any edge the line crosses, or a hex structure on any hex
 * strictly between the endpoints. Decorative structures (maxHp = 0) are ignored.
 */
export function structuresBlockingLine(
  from: Hex,
  to: Hex,
  structures: MapStructures | null | undefined,
  templates: Record<string, StructureTemplate> | null | undefined,
): boolean {
  if (!structures) return false;
  const blocks = (inst: { templateId: string } | undefined): boolean =>
    !!inst && (templates?.[inst.templateId]?.maxHp ?? 0) > 0;
  const line = hexLine(from, to);
  // Edge structures crossed by the line (between consecutive hexes).
  for (let i = 0; i < line.length - 1; i++) {
    const dir = directionBetween(line[i], line[i + 1]);
    if (dir < 0) continue;
    const ref = edgeRef(line[i].q, line[i].r, dir);
    if (blocks(structures[ref.key])) return true;
  }
  // Hex structures strictly between the endpoints.
  for (let i = 1; i < line.length - 1; i++) {
    if (blocks(structures[`${line[i].q},${line[i].r}`])) return true;
  }
  return false;
}
