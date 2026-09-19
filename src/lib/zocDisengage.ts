// src/lib/zocDisengage.ts
// Zone-of-control pursuit eligibility. When a unit LEAVES a hostile kill zone,
// the formed hostiles that had it in their kill zone may pursue it (an
// aggression-gated chase, once per turn). Kill zones are the SAME front-arc
// hexes the movement overlay paints red (`isInKillZone`), gated by the formation
// matrix (`canStopEnemyMovement`).
//
// Scattered / Routed / Heroes impose no kill zone — they never pursue — but a
// mover of ANY formation (including Scattered or a Hero) can be pursued when it
// leaves one.
import { Unit, Hex, AllianceGroup, Formation } from '@/types/gameProtocol';
import { isInKillZone } from '@/lib/unitMorale';
import { canStopEnemyMovement } from '@/lib/formationRules';
import { parseWeapons } from '@/lib/weaponParser';
import { findFirstMeleeWeaponIndex } from '@/lib/meleeFallback';

/** Does `enemy` impose a kill zone on `hex`? Formed hostiles only — hidden,
 *  attached, heroes, Scattered and Routed are excluded (routed/dead/scattered
 *  are handled inside `isInKillZone`; the matrix gate covers custom formations
 *  that do not stop movement). */
export function imposesZocOn(
  enemy: Unit,
  hex: Hex,
  formationsMap: Record<string, Formation>,
): boolean {
  if (enemy.isDeleted || enemy.hidden || enemy.attachedToUnitId || enemy.isHero) return false;
  if (!isInKillZone(enemy, hex)) return false;
  return canStopEnemyMovement(formationsMap[enemy.currentFormation], 'front');
}

/** Can this unit make a MELEE attack? (a melee weapon in its list, not just Fists). */
export function canMeleeAttack(unit: Unit): boolean {
  return findFirstMeleeWeaponIndex(parseWeapons(unit.weaponString || '')) >= 0;
}

/**
 * The hostiles that may pursue `mover` after it left the hex `originHex` for
 * `destHex`: different alliance, not yet used its pursue this turn, melee-capable,
 * and its kill zone covered the hex the mover LEFT but not the one it arrived on.
 */
export function pursuitCandidates(
  mover: Unit,
  originHex: Hex,
  destHex: Hex,
  units: Unit[],
  alliances: Record<string, AllianceGroup>,
  formationsMap: Record<string, Formation>,
): Unit[] {
  const moverAlliance = alliances[mover.team] || 'friendly';
  return units.filter(e =>
    e.id !== mover.id &&
    !e.isDeleted &&
    (alliances[e.team] || 'friendly') !== moverAlliance &&
    !(e.pursuitUsed ?? false) &&
    canMeleeAttack(e) &&
    imposesZocOn(e, originHex, formationsMap) &&
    !imposesZocOn(e, destHex, formationsMap),
  );
}
