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
import { imposesKillZone } from '@/lib/unitMorale';
import { isHostile } from '@/lib/alliances';
import { canStopEnemyMovement } from '@/lib/formationRules';
import { MapStructures, structureSurfaceAt } from '@/lib/mapStructures';
import { StructureTemplate } from '@/types/structure';
import { parseWeapons } from '@/lib/weaponParser';
import { findFirstMeleeWeaponIndex } from '@/lib/meleeFallback';

/** Does `enemy` impose a kill zone / ZoC on `hex`? Formed hostiles only —
 *  hidden, attached, heroes, Scattered and Routed are excluded (routed/dead/
 *  scattered are handled inside `isInKillZone`; the matrix gate covers custom
 *  formations that do not stop movement). A formed, actually-airborne flyer's
 *  vertical ZoC (same column, ≤10 ft above `targetElevation`) is
 *  facing-independent. Horizontal ZoC does not cross elevation. `ownSurface` is
 *  the enemy's own hex surface (`structureSurfaceAt`) so a grounded garrison on
 *  a structure is not treated as airborne. */
export function imposesZocOn(
  enemy: Unit,
  hex: Hex,
  formationsMap: Record<string, Formation>,
  targetElevation = 0,
  ownSurface = 0,
): boolean {
  const sameHex = hex.q === enemy.hex.q && hex.r === enemy.hex.r;
  if (!imposesKillZone(enemy, hex, {
    targetElevation,
    ownSurface,
    exclude: (u: Unit) => u.isHero || !!u.attachedToUnitId,
    requireFormed: true,
  })) {
    return false;
  }
  // Horizontal ZoC additionally needs the formation to stop enemy movement (the
  // vertical same-column clause is facing-independent).
  return sameHex || canStopEnemyMovement(formationsMap[enemy.currentFormation], 'front');
}

/** Can this unit make a MELEE attack? (a melee weapon in its list, not just Fists). */
export function canMeleeAttack(unit: Unit): boolean {
  return findFirstMeleeWeaponIndex(parseWeapons(unit.weaponString || '')) >= 0;
}

/**
 * The hostiles whose kill zone covered the hex `mover` LEFT but NOT the one it
 * arrived on — i.e. the enemies it disengaged from. Unfiltered (any weapon, any
 * `pursuitUsed`), so callers can tell "did it leave a ZoC at all?" from "who can
 * actually pursue?".
 */
export function hostilesLeftZoc(
  mover: Unit,
  originHex: Hex,
  destHex: Hex,
  units: Unit[],
  alliances: Record<string, AllianceGroup>,
  formationsMap: Record<string, Formation>,
  structures?: MapStructures,
  templates?: Record<string, StructureTemplate>,
): Unit[] {
  const moverElev = mover.elevation ?? 0;
  const surfaceOf = (h: Hex) => (structures ? structureSurfaceAt(h, structures, templates ?? {}) : 0);
  return units.filter(e =>
    e.id !== mover.id &&
    !e.isDeleted &&
    isHostile(e.team, mover.team, alliances) &&
    // Elevation gating lives in imposesZocOn: horizontal ZoC needs exact
    // elevation, but a flyer directly above still imposes a vertical ZoC.
    imposesZocOn(e, originHex, formationsMap, moverElev, surfaceOf(e.hex)) &&
    !imposesZocOn(e, destHex, formationsMap, moverElev, surfaceOf(e.hex)),
  );
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
  structures?: MapStructures,
  templates?: Record<string, StructureTemplate>,
): Unit[] {
  return hostilesLeftZoc(mover, originHex, destHex, units, alliances, formationsMap, structures, templates)
    .filter(e => !(e.pursuitUsed ?? false) && canMeleeAttack(e));
}
