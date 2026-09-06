// src/lib/corpseTracker.ts
// Decorative per-hex "fallen" counts derived deterministically from the command
// log (same principle as replay). A corpse marker is pure scenery: it never
// occupies a hex, never interacts with rules, and is not part of statistics.
// Whenever a command (that is not a GM editor command) reduces a unit's troop
// count by k, those k troops are considered to have died on the hex the unit
// stood on at that moment -> fallen[q,r] += k.
import { CommandLogRow, parseSubSteps } from '@/lib/commandLog';

export type FallenMap = Record<string, number>;

const hexKey = (q: number, r: number) => `${q},${r}`;

interface UnitState {
  q: number;
  r: number;
  troops: number;
}

const EDITOR_COMMANDS = new Set(['EDIT_UNIT', 'DELETE', 'PLACE', 'TEAM', 'ALLIANCE', 'SCENARIO']);

/** Deterministic seeded positions for a hex (kept stable as the pile grows).
 *  Returns positions in hex-local offsets; draw the first `count`. */
export function corpseScatterPositions(q: number, r: number, count: number, max: number): { dx: number; dy: number }[] {
  let seed = (q * 73856093) ^ (r * 19349663);
  const rand = () => {
    // xorshift32-ish deterministic generator
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return ((seed >>> 0) % 100000) / 100000;
  };
  const n = Math.min(count, max);
  const out: { dx: number; dy: number }[] = [];
  for (let i = 0; i < n; i++) {
    const a = rand() * Math.PI * 2;
    const r2 = 0.12 + rand() * 0.34; // within the hex interior
    out.push({ dx: Math.cos(a) * r2, dy: Math.sin(a) * r2 });
  }
  return out;
}

/**
 * Fold the command log into per-hex fallen counts. Rows that were undone
 * (`deleted_at` set) are skipped, so undoing a kill reduces the pile again.
 */
export function buildFallen(rows: CommandLogRow[]): FallenMap {
  const fallen: FallenMap = {};
  const state = new Map<string, UnitState>();

  const sorted = [...rows].filter(r => r.deleted_at == null).sort((a, b) => a.seq - b.seq);
  for (const row of sorted) {
    const steps = parseSubSteps(row.sub_steps);
    for (const step of steps) {
      // A PLACE seeds the full unit snapshot.
      if (step.type === 'PLACE' && step.payload && typeof step.payload === 'object') {
        const p = step.payload as { id?: string; hex?: { q: number; r: number }; currentTroopCount?: number };
        if (p.id && p.hex) {
          state.set(p.id, { q: p.hex.q, r: p.hex.r, troops: p.currentTroopCount ?? 0 });
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
        } else if (change.field === 'currentTroopCount') {
          const from = typeof change.from === 'number' ? change.from : troops;
          const to = typeof change.to === 'number' ? change.to : troops;
          troops = to;
          if (!EDITOR_COMMANDS.has(row.action_type) && to < from) {
            const key = hexKey(unit.q, unit.r);
            fallen[key] = (fallen[key] ?? 0) + (from - to);
          }
        }
      }
      unit.troops = troops;
    }
  }
  return fallen;
}
