// src/packages/ai/lib/marks.ts
// Target marking for the Basic AI. Counts are independent per archetype:
//   melee  -> cap = free/reachable adjacent hexes around the target (max 6),
//             so several units can surround a battleline-end target
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
  /** Dynamic melee cap: standable adjacent hexes some melee unit can reach. */
  meleeCap?: (target: Unit) => number;
  /** Mounted doctrine: only target units on the hostile formation's outer rim. */
  mountedEligible?: (target: Unit) => boolean;
}

export interface MarkResult {
  marks: AiMark[];
  /** Final marked target per unit (first candidate after the archetype rules). */
  byUnit: Map<string, string>;
}

const ORDER: AiArchetype[] = ['flying', 'ranged', 'melee', 'mounted'];

const moraleOf = (u: Unit) => (u.baseMorale ?? 0) + (u.currentMoraleModifier ?? 0);

export function assignMarks(opts: MarkOptions): MarkResult {
  const { units, enemies, archetypeOf, reachable, distance } = opts;
  const marks: AiMark[] = [];
  const byUnit = new Map<string, string>();
  const count = (targetId: string, kind: AiArchetype) =>
    marks.filter(m => m.targetId === targetId && m.kind === kind).length;
  const nonMountedCount = (targetId: string) =>
    marks.filter(m => m.targetId === targetId && m.kind !== 'mounted').length;

  const queue = [...units].sort((a, b) => {
    const oa = ORDER.indexOf(archetypeOf(a));
    const ob = ORDER.indexOf(archetypeOf(b));
    if (oa !== ob) return oa - ob;
    // Melee assignments go closest-first so front units get the 2 slots.
    if (archetypeOf(a) === 'melee') {
      const nearest = (u: Unit) => enemies.reduce((best, t) => Math.min(best, distance(u, t)), Infinity);
      const d = nearest(a) - nearest(b);
      if (d !== 0) return d;
      const m = moraleOf(a) - moraleOf(b);
      if (m !== 0) return m;
    }
    return a.id.localeCompare(b.id);
  });

  for (const unit of queue) {
    const kind = archetypeOf(unit);
    const basePool = kind === 'ranged' || kind === 'flying'
      ? enemies
      : enemies.filter(t => reachable(unit, t));
    // Mounted doctrine: outer-rim targets only. No fallback to the interior.
    const pool = (kind === 'mounted' && opts.mountedEligible
      ? basePool.filter(t => opts.mountedEligible!(t))
      : basePool)
      .slice()
      .sort((a, b) => distance(unit, a) - distance(unit, b)
        || moraleOf(a) - moraleOf(b)
        || hexDistance(unit.hex, a.hex) - hexDistance(unit.hex, b.hex)
        || a.id.localeCompare(b.id));
    if (pool.length === 0) continue;

    let chosen: Unit | null = null;
    if (kind === 'melee') {
      // No overflow beyond the target's surrounding hex capacity.
      chosen = pool.find(t => count(t.id, 'melee') < (opts.meleeCap?.(t) ?? 2)) ?? null;
    } else if (kind === 'flying') {
      chosen = pool.find(t => count(t.id, 'flying') === 0) ?? pool[0];
    } else if (kind === 'mounted') {
      chosen = pool.find(t => count(t.id, 'mounted') === 0 && nonMountedCount(t.id) > 0)
        ?? pool.find(t => count(t.id, 'mounted') === 0)
        ?? pool[0];
    } else {
      chosen = pool[0];
    }
    if (!chosen) continue;
    marks.push({ targetId: chosen.id, byUnitId: unit.id, kind });
    byUnit.set(unit.id, chosen.id);
  }

  return { marks, byUnit };
}
