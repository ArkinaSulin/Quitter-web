// src/lib/routedRetreat.ts
// Pure decision logic for routed-unit retreat (owner-decided retreat, rout-through
// friendly Open Order/Scattered). Pursuit is handled by `pursuit.ts` /
// `zocDisengage.ts`; this file owns the retreat geometry + diagnosis. Integration
// (two-phase owner pick over realtime + chained ROUT/MOVE commands) lives in the
// map layer; this file stays testable.

import { Unit, AllianceGroup, Formation, Hex } from '@/types/gameProtocol';
import { computeThreatHexes } from '@/components/ScenarioMap/mapGeometry';

const DIRS = [
  { q: 1, r: 0 }, { q: 0, r: 1 }, { q: -1, r: 1 },
  { q: -1, r: 0 }, { q: 0, r: -1 }, { q: 1, r: -1 },
];

const key = (q: number, r: number) => `${q},${r}`;

export interface RoutContext {
  routed: Unit;
  units: Unit[];
  alliances: Record<string, AllianceGroup>;
  formationsMap: Record<string, Formation>;
  /** Optional injected RNG for the final pursuer tie-break (tests). */
  rnd?: () => number;
}

export function neighborsOf(hex: Hex): Hex[] {
  return DIRS.map(d => ({ q: hex.q + d.q, r: hex.r + d.r, s: -hex.q - hex.r - d.q - d.r }));
}

/** Enemy zone-of-control hexes for the routed unit (units that can stop movement). */
export function enemyKillZone(ctx: RoutContext): Set<string> {
  return computeThreatHexes(ctx.units, ctx.routed.id, ctx.alliances, ctx.formationsMap);
}

/** Hexes currently occupied, excluding the routed unit itself. */
export function occupiedExcept(ctx: RoutContext): Set<string> {
  const s = new Set<string>();
  for (const u of ctx.units) {
    if (u.isDeleted || u.id === ctx.routed.id) continue;
    s.add(key(u.hex.q, u.hex.r));
  }
  return s;
}

/** Legal single-hex retreat candidates: empty hexes NOT in an enemy kill zone. */
export function adjacentRetreatCandidates(ctx: RoutContext): Hex[] {
  const occ = occupiedExcept(ctx);
  const kill = enemyKillZone(ctx);
  return neighborsOf(ctx.routed.hex).filter(h => !occ.has(key(h.q, h.r)) && !kill.has(key(h.q, h.r)));
}

export interface RoutThroughOption {
  throughUnitId: string;
  throughFormation: string;
  /** Passing through an Open Order friendly scatters it; Scattered is unaffected. */
  disruptToScattered: boolean;
  dest: Hex;
}

/**
 * Optional 2-hex rout: run THROUGH one adjacent friendly unit (Open Order or
 * Scattered) to the empty, non-kill-zone hex beyond it. Max distance = 2 hexes
 * (through exactly one friendly unit). Passing an Open Order friendly scatters it.
 * Friendly ROUTING units never yield — they are NOT pass-through candidates, even
 * when they are the only friendly neighbour (two crowds fleeing don't step aside).
 */
export function routThroughOptions(ctx: RoutContext): RoutThroughOption[] {
  const occ = occupiedExcept(ctx);
  const kill = enemyKillZone(ctx);
  const group = ctx.alliances[ctx.routed.team] || 'friendly';
  const out: RoutThroughOption[] = [];
  for (const n of neighborsOf(ctx.routed.hex)) {
    const through = ctx.units.find(u => !u.isDeleted && !u.isHero && u.id !== ctx.routed.id && u.hex.q === n.q && u.hex.r === n.r && (ctx.alliances[u.team] || 'friendly') === group);
    if (!through) continue;
    const formed = through.currentFormation;
    if (formed !== 'Open Order' && formed !== 'Scattered') continue;
    const dq = n.q - ctx.routed.hex.q;
    const dr = n.r - ctx.routed.hex.r;
    const dest = { q: n.q + dq, r: n.r + dr, s: -(n.q + dq) - (n.r + dr) };
    if (occ.has(key(dest.q, dest.r)) || kill.has(key(dest.q, dest.r))) continue;
    out.push({
      throughUnitId: through.id,
      throughFormation: formed,
      disruptToScattered: formed === 'Open Order',
      dest,
    });
  }
  return out;
}

export type RetreatResolution =
  | { kind: 'adjacent'; hex: Hex }
  | { kind: 'rout-through'; option: RoutThroughOption }
  | { kind: 'none' }
  | { kind: 'owner-pick' };

/**
 * Deterministic default retreat (used for the no-modal auto cases).
 * - exactly one legal adjacent hex → that hex
 * - zero adjacent but rout-through possible → prefer no-disruption (Scattered)
 * - zero of everything → 'none' (attacker may still free-attack)
 * - several adjacent options → 'owner-pick' (modal; never auto-decide for the owner)
 */
export function defaultRetreat(ctx: RoutContext): RetreatResolution {
  const adj = adjacentRetreatCandidates(ctx);
  if (adj.length === 1) return { kind: 'adjacent', hex: adj[0] };
  if (adj.length > 1) return { kind: 'owner-pick' };
  const through = routThroughOptions(ctx);
  if (through.length > 0) {
    const byDisrupt = [...through].sort((a, b) => (a.disruptToScattered ? 1 : 0) - (b.disruptToScattered ? 1 : 0));
    return { kind: 'rout-through', option: byDisrupt[0] };
  }
  return { kind: 'none' };
}

const ORDERED_FORMATIONS = new Set(['Close Order', 'Phalanx', 'Shield Wall']);

export interface RetreatDiagnosis {
  adjacentLegal: number;
  throughLegal: number;
  /** Every adjacent friendly is itself routing (won't yield) — rout-through N/A. */
  allAdjacentRouting: boolean;
  /** Every adjacent friendly holds ordered ranks (Close Order/Phalanx/Shield Wall). */
  allAdjacentOrdered: boolean;
  hasAdjacentFriendly: boolean;
}

/** Structured reason when no legal retreat exists, for precise UI messaging. */
export function retreatDiagnosis(ctx: RoutContext): RetreatDiagnosis {
  const adjacentLegal = adjacentRetreatCandidates(ctx).length;
  const throughLegal = routThroughOptions(ctx).length;
  const group = ctx.alliances[ctx.routed.team] || 'friendly';
  const adjacentFriendly = neighborsOf(ctx.routed.hex)
    .map(n => ctx.units.find(u => !u.isDeleted && u.id !== ctx.routed.id && u.hex.q === n.q && u.hex.r === n.r && (ctx.alliances[u.team] || 'friendly') === group))
    .filter(Boolean) as Unit[];
  const allAdjacentRouting = adjacentFriendly.length > 0 && adjacentFriendly.every(u => u.currentFormation === 'Routed');
  const allAdjacentOrdered = adjacentFriendly.length > 0 && adjacentFriendly.every(u => ORDERED_FORMATIONS.has(u.currentFormation));
  return {
    adjacentLegal,
    throughLegal,
    allAdjacentRouting,
    allAdjacentOrdered,
    hasAdjacentFriendly: adjacentFriendly.length > 0,
  };
}
