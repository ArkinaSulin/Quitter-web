// src/lib/pursuit.ts
// Zone-of-control pursuit domain logic (pure, unit-tested).
//
// When a unit leaves a hostile kill zone it drops to Scattered (a formed
// non-hero; see `pursuitScatters`) and one pursuer may chase it: candidates are
// ordered attacker → most MaxMP → most available MP → random, and each rolls
// `d10 ≤ aggressiveness` in turn until one passes (single pursuer). A candidate
// inside a hero's Commanding Presence is HELD unless that hero's owner has
// permitted pursuit (`commandPursuitPermit`); a suppressible candidate is
// reported so the caller can annotate why no chase happened.

import { Unit, AllianceGroup, Formation, getOrganizationLevel, hexDistance } from '@/types/gameProtocol';
import { computeEffectiveMovement, getFormationMultiplier } from '@/lib/unitStats';

/** A formed, non-hero unit drops to Scattered when it leaves a hostile ZoC. */
export function pursuitScatters(unit: Unit): boolean {
  if (unit.isHero) return false;
  return getOrganizationLevel(unit.currentFormation) > 0;
}

/**
 * A hero whose Commanding Presence covers `unit` (same alliance, within 1 hex)
 * and has NOT permitted pursuit. The strongest single hold wins; the unit's own
 * permit never blocks itself.
 */
export function forbiddingHero(
  unit: Unit,
  units: Unit[],
  alliances: Record<string, AllianceGroup>,
): Unit | null {
  const group = alliances[unit.team] || 'friendly';
  for (const h of units) {
    if (!h.isHero || h.isDeleted || h.id === unit.id) continue;
    if ((alliances[h.team] || 'friendly') !== group) continue;
    if (hexDistance(h.hex, unit.hex) > 1) continue;
    if (h.commandPursuitPermit === false) return h;
  }
  return null;
}

export interface PursuitSelection {
  pursuer: Unit | null;
  /** Candidates that passed the aggression roll but were held in line by a hero. */
  suppressed: { unit: Unit; hero: Unit }[];
}

/** Effective max MP of a unit under its own formation multiplier. */
function effectiveMaxMP(u: Unit, formationsMap: Record<string, Formation>): number {
  const mult = getFormationMultiplier(formationsMap, u.currentFormation, 'movement_multiplier');
  return computeEffectiveMovement(u, mult);
}

/**
 * Pick the pursuer. Candidates are ordered ATTACKER (the unit that caused a rout,
 * when given) → most MaxMP → most available MP → random; each candidate rolls
 * `d10 ≤ aggressiveness` in turn and the first to pass chases. A candidate held
 * by a hero's Commanding Presence is skipped and reported in `suppressed`.
 */
export function selectPursuer(
  candidates: Unit[],
  attacker: Unit | null | undefined,
  units: Unit[],
  alliances: Record<string, AllianceGroup>,
  formationsMap: Record<string, Formation>,
  rng: () => number = Math.random,
): PursuitSelection {
  const decorated = candidates.map(u => ({
    u,
    isAtk: !!attacker && u.id === attacker.id,
    maxMP: effectiveMaxMP(u, formationsMap),
    avail: u.movementPointsAvailable ?? 0,
    rand: rng(),
  }));
  decorated.sort((a, b) =>
    (Number(b.isAtk) - Number(a.isAtk)) ||
    (b.maxMP - a.maxMP) ||
    (b.avail - a.avail) ||
    (a.rand - b.rand),
  );

  const suppressed: { unit: Unit; hero: Unit }[] = [];
  for (const { u } of decorated) {
    const roll = Math.floor(rng() * 10) + 1;
    if (roll > u.aggressiveness) continue;
    const hero = forbiddingHero(u, units, alliances);
    if (hero) { suppressed.push({ unit: u, hero }); continue; }
    return { pursuer: u, suppressed };
  }
  return { pursuer: null, suppressed };
}
