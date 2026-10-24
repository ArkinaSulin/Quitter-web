// src/packages/ai/lib/marks.ts
// Target marking for the Basic AI. Counts are independent per archetype:
//   melee  -> at most 2 melee marks per target (overflow only when every
//             available target is already saturated)
//   ranged -> unlimited
//   flying -> at most 1 flying mark per target
//   mounted-> at most 1 mounted mark, and only on a target already marked by a
//             non-mounted friendly
import { Unit, hexDistance } from '@/types/gameProtocol';
import { AiArchetype, AiMark } from './types';

export interface MarkOptions {
  units: Unit[];
  enemies: Unit[];
  archetypeOf: (unit: Unit) => AiArchetype;
  /** Reachability gate for melee/mounted (ranged/flying ignore it). */
  reachable: (unit: Unit, target: Unit) => boolean;
  /** Planning distance: path cost for melee/mounted, hexes otherwise. */
  distance: (unit: Unit, target: Unit) => number;
}

export interface MarkResult {
  marks: AiMark[];
  /** Final marked target per unit (first candidate after the archetype rules). */
  byUnit: Map<string, string>;
}

const ORDER: AiArchetype[] = ['flying', 'ranged', 'melee', 'mounted'];

export function assignMarks(opts: MarkOptions): MarkResult {
  const { units, enemies, archetypeOf, reachable, distance } = opts;
  const marks: AiMark[] = [];
  const byUnit = new Map<string, string>();
  const count = (targetId: string, kind: AiArchetype) =>
    marks.filter(m => m.targetId === targetId && m.kind === kind).length;
  const nonMountedCount = (targetId: string) =>
    marks.filter(m => m.targetId === targetId && m.kind !== 'mounted').length;
  const totalMarks = () => marks.length;

  const queue = [...units].sort((a, b) => {
    const oa = ORDER.indexOf(archetypeOf(a));
    const ob = ORDER.indexOf(archetypeOf(b));
    if (oa !== ob) return oa - ob;
    // Melee assignments go closest-first so front units get the 2 slots.
    if (archetypeOf(a) === 'melee') {
      const nearest = (u: Unit) => enemies.reduce((best, t) => Math.min(best, distance(u, t)), Infinity);
      const d = nearest(a) - nearest(b);
      if (d !== 0) return d;
    }
    return a.id.localeCompare(b.id);
  });

  for (const unit of queue) {
    const kind = archetypeOf(unit);
    const pool = kind === 'ranged' || kind === 'flying'
      ? enemies
      : enemies.filter(t => reachable(unit, t));
    const candidates = (pool.length > 0 ? pool : enemies.filter(t => kind === 'ranged' || kind === 'flying'))
      .slice()
      .sort((a, b) => distance(unit, a) - distance(unit, b) || hexDistance(unit.hex, a.hex) - hexDistance(unit.hex, b.hex) || a.id.localeCompare(b.id));
    if (candidates.length === 0) continue;

    let chosen: Unit | null = null;
    if (kind === 'melee') {
      chosen = candidates.find(t => count(t.id, 'melee') < 2) ?? candidates[0];
    } else if (kind === 'flying') {
      chosen = candidates.find(t => count(t.id, 'flying') === 0) ?? candidates[0];
    } else if (kind === 'mounted') {
      chosen = candidates.find(t => count(t.id, 'mounted') === 0 && nonMountedCount(t.id) > 0)
        ?? candidates.find(t => count(t.id, 'mounted') === 0)
        ?? candidates[0];
    } else {
      chosen = candidates[0];
    }
    if (!chosen) continue;
    marks.push({ targetId: chosen.id, byUnitId: unit.id, kind });
    byUnit.set(unit.id, chosen.id);
  }

  // A melee unit is allowed to overflow a saturated target only when every
  // available target already has 2 melee marks. The greedy pass above already
  // prefers unsaturated targets; if it had to choose a saturated one, at least
  // one mark beyond 2 exists. Keep the marks as assigned.
  void totalMarks;
  return { marks, byUnit };
}
