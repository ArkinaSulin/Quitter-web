// src/lib/withdraw.ts
// The Withdraw action: a formed unit spends 2 actions to step ONE hex straight
// back into either rear-arc hex, KEEPING its facing. It is the ordered alternative
// to a normal disengagement (which scatters + provokes pursuit): the withdraw
// never scatters and never provokes, but it costs a whole turn's actions.
import { Hex, Unit, getOrganizationLevel } from '@/types/gameProtocol';

/** Actions a normal (non-hero, non-free-move) Withdraw costs. */
export const WITHDRAW_ACTION_COST = 2;

/** The two rear-arc hexes for a unit's facing (dirs facing+1 and facing+2). */
export function rearHexes(unit: Pick<Unit, 'hex' | 'facing'>): Hex[] {
  const dirs = [
    { q: 1, r: 0 }, { q: 0, r: 1 }, { q: -1, r: 1 },
    { q: -1, r: 0 }, { q: 0, r: -1 }, { q: 1, r: -1 },
  ];
  return [(unit.facing + 1) % 6, (unit.facing + 2) % 6].map(i => {
    const d = dirs[i];
    const q = unit.hex.q + d.q;
    const r = unit.hex.r + d.r;
    return { q, r, s: -q - r };
  });
}

/** A formed (non-loose, non-hero) unit may withdraw. */
export function canWithdraw(unit: Unit): boolean {
  return !unit.isHero && getOrganizationLevel(unit.currentFormation) > 0;
}

/** Legal withdraw destinations: the rear hexes that are empty, on the board, and
 *  NOT inside an enemy kill zone (retreating into a threat zone isn't a retreat). */
export function withdrawDestinations(
  unit: Unit,
  occupied: Set<string>,
  gridRadius: number,
  threatHexes?: Set<string> | null,
): Hex[] {
  if (!canWithdraw(unit)) return [];
  return rearHexes(unit).filter(h => {
    const k = `${h.q},${h.r}`;
    if (occupied.has(k)) return false;
    if (threatHexes?.has(k)) return false;
    return Math.max(Math.abs(h.q), Math.abs(h.r), Math.abs(h.s)) <= gridRadius;
  });
}
