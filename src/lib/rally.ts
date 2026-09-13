// src/lib/rally.ts
// Rally: a routed unit (or hero) recovers its nerve when the pressure is off.
// Prerequisites (checked for the context-menu item): the unit is not fearless,
// is currently Routed, is alive, has positive effective morale, and no visible
// hostile stands adjacent. On success it returns to Scattered (heroes: Hero) and
// spends the rest of the turn (0 actions, 0 MP).
import { Unit, AllianceGroup, Formation, hexDistance } from '@/types/gameProtocol';
import { isUnitRouted, computeEffectiveMoraleModifier } from '@/lib/unitMorale';

export interface RallyCheck {
  ok: boolean;
  /** Why it can't rally (shown in the disabled menu item). */
  reason?: string;
  /** Formation it would return to on success. */
  target?: 'Hero' | 'Scattered';
}

export function canRally(
  unit: Unit,
  units: Unit[],
  alliances: Record<string, AllianceGroup>,
  formationsMap: Record<string, Formation>,
): RallyCheck {
  if (unit.ignoreMoraleChecks) return { ok: false, reason: 'fearless' };
  if (!isUnitRouted(unit)) return { ok: false, reason: 'not routed' };
  if (unit.isDeleted || (unit.currentUnitHp ?? 0) <= 0) return { ok: false, reason: 'destroyed' };

  const formation = formationsMap[unit.currentFormation] ?? null;
  const effectiveMorale =
    unit.baseMorale + (unit.currentMoraleModifier ?? 0) + computeEffectiveMoraleModifier(unit, units, alliances, formation);
  if (effectiveMorale <= 0) return { ok: false, reason: `morale ${effectiveMorale}` };

  const unitAlliance = alliances[unit.team] || 'friendly';
  const enemyAdjacent = units.some(o =>
    !o.isDeleted &&
    !o.hidden && // hidden hostiles are concealed and do not block a rally
    o.id !== unit.id &&
    (o.currentUnitHp ?? 0) > 0 &&
    (alliances[o.team] || 'friendly') !== unitAlliance &&
    hexDistance(o.hex, unit.hex) <= 1,
  );
  if (enemyAdjacent) return { ok: false, reason: 'enemy adjacent' };

  return { ok: true, target: unit.isHero ? 'Hero' : 'Scattered' };
}
