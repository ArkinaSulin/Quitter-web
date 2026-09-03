'use client';
// src/components/ScenarioMap/useOverlay.ts
// Drag-overlay computation: the hex highlight shown while dragging (reachable
// move hexes, threat zones, charge wedge, range rings, reaction rings) plus
// the hovered-unit front-arc tint. Pure function — ScenarioMap feeds it the
// grid state (draggingUnitId/hoveredUnit come from useHexGrid) in an effect.
import { Unit, Hex, AllianceGroup, Formation, hexDistance } from '@/types/gameProtocol';
import { computeReachableMap, computeMovePool, computeHeroMovePool, computeChargeReachable } from '@/lib/moveCost';
import { computeEffectiveMovement, getFormationMultiplier } from '@/lib/unitStats';
import { getSetting } from '@/lib/settingsCache';
import { isUnitRouted } from '@/lib/unitMorale';
import { parseWeapons } from '@/lib/weaponParser';
import { isRangedCapableWeapon, getReactionMoveBudget } from '@/lib/archerReaction';
import { determineCombatPosition } from '@/lib/unitCombat';
import { DEFAULT_GRID_RADIUS, HEX_DIRS, hexRing, computeOccupiedHexes, computeThreatHexes, MapBackgroundConfig, terrainCostOf, TerrainCosts } from './mapGeometry';

/** Hovered unit's front-arc threat tint (non-loose units only). */
function getOverlayForUnit(unit: Unit): Record<string, string> {
  const result: Record<string, string> = {};
  if (unit.isHero || isUnitRouted(unit) || unit.currentFormation === 'Scattered') return result;
  for (const dir of HEX_DIRS) {
    const nq = unit.hex.q + dir.q;
    const nr = unit.hex.r + dir.r;
    const key = `${nq},${nr}`;
    const pos = determineCombatPosition({ q: nq, r: nr, s: -nq - nr }, unit.hex, unit.facing);
    if (pos === 'front') {
      result[key] = 'rgba(255, 100, 100, 0.5)';
    }
  }
  return result;
}

export interface OverlayState {
  reactionMode: { archer: Unit } | null;
  draggingUnitId: string | null;
  hoveredUnit: Unit | null;
  units: Unit[];
  alliances: Record<string, AllianceGroup>;
  formationsMap: Record<string, Formation>;
  freeMove: boolean;
  backgroundConfig: MapBackgroundConfig | null;
  rangeViolationHex: Hex | null;
  terrainCosts?: TerrainCosts;
}

export function computeOverlayMap(state: OverlayState): Record<string, string> {
  const {
    reactionMode,
    draggingUnitId,
    hoveredUnit,
    units,
    alliances,
    formationsMap,
    freeMove,
    backgroundConfig,
    rangeViolationHex,
    terrainCosts,
  } = state;

  // Reaction mode drag: hovering a hostile in weapon range shows range rings;
  // otherwise the 50% reaction-move hexes.
  if (reactionMode && draggingUnitId === reactionMode.archer.id) {
    const archer = units.find(u => u.id === reactionMode.archer.id) ?? reactionMode.archer;
    const weapon = parseWeapons(archer.weaponString || '')[archer.activeWeaponIndex ?? 0];
    const combined: Record<string, string> = {};
    const hostileHover =
      !!hoveredUnit && hoveredUnit.id !== archer.id && !hoveredUnit.isDeleted &&
      (alliances[hoveredUnit.team] || 'friendly') !== (alliances[archer.team] || 'friendly');
    if (hostileHover && weapon && isRangedCapableWeapon(weapon)) {
      for (const h of hexRing(archer.hex, weapon.range)) {
        combined[`${h.q},${h.r}`] = 'rgba(255, 255, 255, 0.85)';
      }
      const d = hexDistance(archer.hex, hoveredUnit!.hex);
      combined[`${hoveredUnit!.hex.q},${hoveredUnit!.hex.r}`] = d <= weapon.range ? 'rgba(80, 220, 120, 0.8)' : 'rgba(255, 80, 80, 0.85)';
    } else {
      const maxMP = computeEffectiveMovement(archer, getFormationMultiplier(formationsMap, archer.currentFormation, 'movement_multiplier'));
      const budget = getReactionMoveBudget(maxMP);
      const occupied = computeOccupiedHexes(units, archer.id);
      const reachable = computeReachableMap(archer, budget, occupied, new Set(), (q, r) => terrainCostOf(terrainCosts, q, r));
      reachable.forEach((entry, key) => {
        combined[key] = entry.needsTurn ? 'rgba(190, 190, 190, 0.55)' : 'rgba(255, 255, 255, 0.6)';
      });
    }
    return combined;
  }
  // Transient red flash on an out-of-range target (blocked drop).
  if (rangeViolationHex) {
    return { [`${rangeViolationHex.q},${rangeViolationHex.r}`]: 'rgba(255, 80, 80, 0.9)' };
  }
  if (draggingUnitId) {
    const draggedUnit = units.find(u => u.id === draggingUnitId);
    if (!draggedUnit) return {};
    const occupied = computeOccupiedHexes(units);

    if (freeMove) {
      const combined: Record<string, string> = {};
      const r = backgroundConfig?.gridRadius ?? DEFAULT_GRID_RADIUS;
      for (let q = -r; q <= r; q++) {
        for (let rr = -r; rr <= r; rr++) {
          const s = -q - rr;
          if (Math.abs(s) > r) continue;
          const key = `${q},${rr}`;
          if (!occupied.has(key)) combined[key] = 'rgba(255, 255, 255, 0.5)';
        }
      }
      return combined;
    }

    // Charging units show the front-arc charge wedge: cost-1 hexes amber (charge
    // route — premature if you stop), cost 2+ white (full charge, free attack).
    if (draggedUnit.isCharging) {
      const combined: Record<string, string> = {};
      const movementMult = getFormationMultiplier(formationsMap, draggedUnit.currentFormation, 'movement_multiplier');
      const effectiveMax = computeEffectiveMovement(draggedUnit, movementMult);
      const chargeReach = computeChargeReachable(draggedUnit, occupied, effectiveMax);
      for (const [key, cost] of Array.from(chargeReach.entries())) {
        combined[key] = cost >= getSetting('charge_full_distance', 2) ? 'rgba(255, 255, 255, 0.6)' : 'rgba(255, 180, 60, 0.6)';
      }
      return combined;
    }

    const threatHexes = computeThreatHexes(units, draggingUnitId, alliances, formationsMap);

    // White reachable hexes for the dragged unit — one full pool (an action
    // converts to MP on move), or leftover MP only when 0 actions. A host with
    // an attached hero is capped by the hero's pool too (combined unit).
    const movementMult = getFormationMultiplier(formationsMap, draggedUnit.currentFormation, 'movement_multiplier');
    const effectiveMax = computeEffectiveMovement(draggedUnit, movementMult);
    // Heroes show their full conversion potential (MP + actions × maxMP/5);
    // units show one pool (or leftover MP when no actions) — matching handleUnitMove.
    let pool = draggedUnit.isHero ? computeHeroMovePool(draggedUnit, effectiveMax) : computeMovePool(draggedUnit, effectiveMax);
    const attachedHero = draggedUnit.attachedToUnitId ? undefined : units.find(u => u.attachedToUnitId === draggedUnit.id && !u.isDeleted);
    if (attachedHero) {
      const heroMult = getFormationMultiplier(formationsMap, attachedHero.currentFormation, 'movement_multiplier');
      const heroMax = computeEffectiveMovement(attachedHero, heroMult);
      pool = Math.min(pool, attachedHero.isHero ? computeHeroMovePool(attachedHero, heroMax) : computeMovePool(attachedHero, heroMax));
    }
    const reachableMap = computeReachableMap(draggedUnit, pool, occupied, threatHexes, (q, r) => terrainCostOf(terrainCosts, q, r));

    const combined: Record<string, string> = {};

    const activeWeapon = parseWeapons(draggedUnit.weaponString || '')[draggedUnit.activeWeaponIndex ?? 0];
    const isRanged = !!activeWeapon && activeWeapon.maxRange > 1;
    // A valid target: a hovered unit from a different alliance than the drag.
    const isValidTarget =
      !!hoveredUnit && hoveredUnit.id !== draggedUnit.id && !hoveredUnit.isDeleted &&
      (alliances[hoveredUnit.team] || 'friendly') !== (alliances[draggedUnit.team] || 'friendly');

    if (isRanged && isValidTarget) {
      // Dragging a ranged unit over an enemy target: show range rings instead of
      // the movement highlight (movement and range never compete visually).
      for (const h of hexRing(draggedUnit.hex, activeWeapon.range)) {
        combined[`${h.q},${h.r}`] = 'rgba(255, 255, 255, 0.9)';
      }
      if (activeWeapon.maxRange > activeWeapon.range) {
        for (const h of hexRing(draggedUnit.hex, activeWeapon.maxRange)) {
          combined[`${h.q},${h.r}`] = 'rgba(255, 180, 60, 0.9)';
        }
      }
      const d = hexDistance(draggedUnit.hex, hoveredUnit!.hex);
      let color = 'rgba(80, 220, 120, 0.8)';
      if (d > activeWeapon.maxRange) color = 'rgba(255, 80, 80, 0.85)';
      else if (d > activeWeapon.range) color = 'rgba(255, 180, 60, 0.85)';
      combined[`${hoveredUnit!.hex.q},${hoveredUnit!.hex.r}`] = color;
    } else {
      // Movement highlight only (no range rings unless a valid target is hovered).
      reachableMap.forEach((entry, key) => {
        // White = reachable straight ahead (droppable); light grey = needs a turn
        // first (hint only — the unit must rotate before moving there).
        combined[key] = entry.needsTurn ? 'rgba(190, 190, 190, 0.55)' : 'rgba(255, 255, 255, 0.5)';
      });
      for (const key of Array.from(threatHexes)) combined[key] = 'rgba(255, 100, 100, 0.5)';
    }

    return combined;
  }
  if (hoveredUnit) {
    return getOverlayForUnit(hoveredUnit);
  }
  return {};
}

