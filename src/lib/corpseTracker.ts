// src/lib/corpseTracker.ts
// Decorative per-hex "fallen" piles derived deterministically from the command
// log (same principle as replay). A corpse marker is pure scenery: it never
// occupies a hex, never interacts with rules, and is not part of statistics.
// Whenever a command (that is not a GM editor command) reduces a unit's troop
// count by k, those k troops are considered to have died on the hex the unit
// stood on at that moment -> fallen[q,r] gains k in that unit's group.
//
// Each death records enough of the dead unit to render the dot like its token:
// team (colour), mounted (triangle vs circle), and sizeCategory/visualScale
// (radius) — all taken from the PLACE sub-step payload (the full unit snapshot).
import { CommandLogRow, parseSubSteps } from '@/lib/commandLog';

/** One kind of death on a hex (same team + mounted + size on that hex). */
export interface FallenGroup {
  count: number;
  mounted: boolean;
  sizeCategory: number;
  visualScale: number;
  team: string;
}

export type FallenMap = Record<string, FallenGroup[]>;

const hexKey = (q: number, r: number) => `${q},${r}`;

interface UnitState {
  q: number;
  r: number;
  troops: number;
  mounted: boolean;
  sizeCategory: number;
  visualScale: number;
  team: string;
}

const EDITOR_COMMANDS = new Set(['EDIT_UNIT', 'DELETE', 'PLACE', 'TEAM', 'ALLIANCE', 'SCENARIO']);

/** Deterministic seeded positions for a hex (stable as the pile grows).
 *  Positions are returned in hex-local offsets; draw the first `count`.
 *  An annulus (0.20–0.44 of HEX_SIZE) with sqrt area bias keeps dots off the
 *  exact centre so piles never over-clump in the middle.
 *  Cached per (q,r,count) — the layout is deterministic, so the per-frame cost
 *  is just drawing, not regenerating. */
const scatterCache = new Map<string, { dx: number; dy: number }[]>();
const SCATTER_CACHE_MAX = 5000;

export function corpseScatterPositions(q: number, r: number, count: number): { dx: number; dy: number }[] {
  const cacheKey = `${q},${r},${count}`;
  const cached = scatterCache.get(cacheKey);
  if (cached) return cached;

  let seed = (q * 73856093) ^ (r * 19349663);
  const rand = () => {
    // xorshift32-ish deterministic generator
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return ((seed >>> 0) % 100000) / 100000;
  };
  const out: { dx: number; dy: number }[] = [];
  for (let i = 0; i < count; i++) {
    const a = rand() * Math.PI * 2;
    const r2 = 0.20 + Math.sqrt(rand()) * 0.24;
    out.push({ dx: Math.cos(a) * r2, dy: Math.sin(a) * r2 });
  }
  if (scatterCache.size >= SCATTER_CACHE_MAX) scatterCache.clear();
  scatterCache.set(cacheKey, out);
  return out;
}

/** Flatten a hex's groups into one entry per dead troop (for position assignment). */
export function flattenFallen(groups: FallenGroup[]): Omit<FallenGroup, 'count'>[] {
  const out: Omit<FallenGroup, 'count'>[] = [];
  for (const g of groups) {
    const spec = { mounted: g.mounted, sizeCategory: g.sizeCategory, visualScale: g.visualScale, team: g.team };
    for (let i = 0; i < g.count; i++) out.push(spec);
  }
  return out;
}

/** One drawable corpse dot: its unit spec plus its hex-local offset. */
export interface CorpseDot extends Omit<FallenGroup, 'count'> {
  dx: number;
  dy: number;
}

// The per-hex dot list (specs + positions) is deterministic given the groups, so
// cache it too — `useCanvasDraw` calls this every redraw.
const dotCache = new Map<string, CorpseDot[]>();
const DOT_CACHE_MAX = 5000;

export function corpseDots(q: number, r: number, groups: FallenGroup[]): CorpseDot[] {
  const cacheKey = `${q},${r}|${groups.map(g => `${g.mounted}${g.sizeCategory}${g.visualScale}${g.team}${g.count}`).join(';')}`;
  const cached = dotCache.get(cacheKey);
  if (cached) return cached;

  const specs = flattenFallen(groups);
  const positions = corpseScatterPositions(q, r, specs.length);
  const dots = specs.map((s, i) => ({ ...s, dx: positions[i].dx, dy: positions[i].dy }));
  if (dotCache.size >= DOT_CACHE_MAX) dotCache.clear();
  dotCache.set(cacheKey, dots);
  return dots;
}

function groupKey(g: Pick<FallenGroup, 'mounted' | 'sizeCategory' | 'visualScale' | 'team'>): string {
  return `${g.mounted}|${g.sizeCategory}|${g.visualScale}|${g.team}`;
}

/**
 * Fold the command log into per-hex fallen piles. Rows that were undone
 * (`deleted_at` set) are skipped, so undoing a kill reduces the pile again.
 */
export function buildFallen(rows: CommandLogRow[]): FallenMap {
  const fallen: FallenMap = {};
  const state = new Map<string, UnitState>();

  const sorted = [...rows].filter(r => r.deleted_at == null).sort((a, b) => a.seq - b.seq);
  for (const row of sorted) {
    const steps = parseSubSteps(row.sub_steps);
    for (const step of steps) {
      // A PLACE seeds the full unit snapshot (team / mount / size included).
      if (step.type === 'PLACE' && step.payload && typeof step.payload === 'object') {
        const p = step.payload as {
          id?: string; hex?: { q: number; r: number }; currentTroopCount?: number;
          mountId?: string | null; sizeCategory?: number; visualScale?: number; team?: string;
        };
        if (p.id && p.hex) {
          state.set(p.id, {
            q: p.hex.q,
            r: p.hex.r,
            troops: p.currentTroopCount ?? 0,
            mounted: !!p.mountId,
            sizeCategory: p.sizeCategory ?? 100,
            visualScale: p.visualScale ?? 100,
            team: p.team ?? '',
          });
        }
        continue;
      }
      const unit = state.get(step.unitId);
      if (!unit) continue;
      let troops = unit.troops;
      for (const change of step.changes) {
        if (change.field === 'hex' && change.to && typeof change.to === 'object') {
          const h = change.to as { q: number; r: number };
          unit.q = h.q;
          unit.r = h.r;
        } else if (change.field === 'mountId') {
          unit.mounted = !!change.to;
        } else if (change.field === 'sizeCategory' && typeof change.to === 'number') {
          unit.sizeCategory = change.to;
        } else if (change.field === 'visualScale' && typeof change.to === 'number') {
          unit.visualScale = change.to;
        } else if (change.field === 'team' && typeof change.to === 'string') {
          unit.team = change.to;
        } else if (change.field === 'currentTroopCount') {
          const from = typeof change.from === 'number' ? change.from : troops;
          const to = typeof change.to === 'number' ? change.to : troops;
          troops = to;
          if (!EDITOR_COMMANDS.has(row.action_type) && to < from) {
            const key = hexKey(unit.q, unit.r);
            const spec = { mounted: unit.mounted, sizeCategory: unit.sizeCategory, visualScale: unit.visualScale, team: unit.team };
            const groups = fallen[key] ?? (fallen[key] = []);
            const gk = groupKey(spec);
            const existing = groups.find(g => groupKey(g) === gk);
            if (existing) existing.count += from - to;
            else groups.push({ ...spec, count: from - to });
          }
        }
      }
      unit.troops = troops;
    }
  }
  return fallen;
}
