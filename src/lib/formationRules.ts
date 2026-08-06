// src/lib/formationRules.ts
// Pure helpers over the data-driven formations matrix. Replaces hard-coded
// formation branches in combat / morale / movement / UI.
import { Formation } from '@/types/gameProtocol';

export type Arc = 'front' | 'flank' | 'rear';
export type RetaliationMode = 'full' | 'rows' | 'none';

export function arcsContain(arcs: string[] | undefined, arc: Arc): boolean {
  return !!arcs && arcs.includes(arc);
}

/** Arcs a unit in this formation may target with melee. */
export function canMeleeTarget(form: Formation | null | undefined, arc: Arc): boolean {
  if (!form) return true;
  return arcsContain(form.melee_target_arcs, arc);
}

/** Arcs a unit in this formation may target with ranged attacks. */
export function canRangedTarget(form: Formation | null | undefined, arc: Arc): boolean {
  if (!form) return true;
  return arcsContain(form.ranged_target_arcs, arc);
}

/** Threat mode for a given arc: 'normal' | 'double' | 'none'. */
export function getThreatMode(form: Formation | null | undefined, arc: Arc): 'normal' | 'double' | 'none' {
  if (!form) return 'normal';
  if (arcsContain(form.double_threat_arcs, arc)) return 'double';
  if (arcsContain(form.threat_arcs, arc)) return 'normal';
  return 'none';
}

/** Retaliation strength for a melee attack from `arc`. */
export function getRetaliationMode(form: Formation | null | undefined, arc: Arc): RetaliationMode {
  if (!form) return 'full';
  return form.retaliate_arcs?.[arc] ?? 'full';
}

/** May a unit in this formation charge? */
export function canFormationCharge(form: Formation | null | undefined): boolean {
  return !!form?.can_charge;
}

/** Does this formation stop enemy movement through `arc` hexes (zone of control)? */
export function canStopEnemyMovement(form: Formation | null | undefined, arc: Arc): boolean {
  if (!form) return true;
  return arcsContain(form.stop_enemy_movement_arcs, arc);
}

/** Reserved: may a charging unit pass through this formation's `arc`? */
export function canChargeThrough(form: Formation | null | undefined, arc: Arc): boolean {
  if (!form) return true;
  return arcsContain(form.charge_through_arcs, arc);
}

/** Attack-count multiplier applied to attackers against this formation. */
export function beAttackedModifier(form: Formation | null | undefined, isRanged: boolean): number {
  if (!form) return 1;
  return isRanged ? (form.be_attacked_range_modifier ?? 1) : (form.be_attacked_melee_modifier ?? 1);
}

/**
 * Human-readable note explaining a beAttacked modifier, e.g.
 * "target Open Order (ranged -50%)" or "target Scattered (melee +50%)".
 * Returns undefined when the modifier is neutral (1x).
 */
export function beAttackedModifierNote(form: Formation | null | undefined, isRanged: boolean): string | undefined {
  const mod = beAttackedModifier(form, isRanged);
  if (!form || mod === 1) return undefined;
  const kind = isRanged ? 'ranged' : 'melee';
  const pct = Math.round((mod - 1) * 100);
  const sign = pct > 0 ? '+' : '';
  return `${form.name} (${kind} ${sign}${pct}%)`;
}

/**
 * The "effective combat position" — how a raw geometric position is treated for
 * a unit. Derived from the retaliation arcs: any arc that maps to 'full' counts as
 * front-like, 'rows' as flank-like, 'none' as rear-like. Kept for call sites that
 * only need a coarse front/flank/rear label (e.g. rear-attack detection).
 */
export function getEffectivePosition(form: Formation | null | undefined, rawPos: Arc): Arc {
  const mode = getRetaliationMode(form, rawPos);
  if (mode === 'full') return 'front';
  if (mode === 'rows') return 'flank';
  return 'rear';
}
