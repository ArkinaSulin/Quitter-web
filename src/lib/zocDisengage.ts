// src/lib/zocDisengage.ts
// Zone-of-control disengagement: which formed hostiles get a free opportunity
// attack (D&D term; a.k.a. "parting shot") when a unit moves out of their kill
// zone, and whether a destination is itself a kill-zone hex (spent on entry).
//
// Kill zones are the SAME front-arc hexes the movement overlay paints red
// (`isInKillZone`), gated by the formation matrix (`canStopEnemyMovement`).
// Scattered / Routed / Heroes impose no kill zone — they never part — but a
// mover of ANY formation (including Scattered or a Hero) can be part-shot when
// it leaves one.
import { Unit, Hex, AllianceGroup, Formation } from '@/types/gameProtocol';
import { isInKillZone } from '@/lib/unitMorale';
import { canStopEnemyMovement } from '@/lib/formationRules';

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

/**
 * The formed hostiles that may make an opportunity attack against `mover`: each
 * is a different alliance, has not already done so this turn, and its kill zone
 * covers the hex the mover LEFT but not the hex it arrived on.
 */
export function disengageAttackers(
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
    !(e.partingShotUsed ?? false) &&
    imposesZocOn(e, originHex, formationsMap) &&
    !imposesZocOn(e, destHex, formationsMap),
  );
}
