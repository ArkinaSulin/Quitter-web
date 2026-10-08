'use client';
// src/components/ScenarioMap/useOverlay.ts
// Drag-overlay computation: the hex highlight shown while dragging (reachable
// move hexes, threat zones, charge wedge, range rings, reaction rings) plus
// the hovered-unit front-arc tint. Pure function — ScenarioMap feeds it the
// grid state (draggingUnitId/hoveredUnit come from useHexGrid) in an effect.
import { Unit, Hex, AllianceGroup, Formation, hexDistance, getOrganizationLevel } from '@/types/gameProtocol';
import { computeReachableMap, computeMovePool, computeMoveBudget, computeHeroMovePool, computeChargeReachable } from '@/packages/movement';
import { computeEffectiveMovement, getFormationMultiplier } from '@/packages/units';
import { getSetting } from '@/packages/infra';
import { imposesKillZone } from '@/packages/morale';
import { isHostile } from '@/packages/primitives';
import { frontArcIndices } from '@/packages/primitives';
import { parseWeapons } from '@/packages/units';
import { isRangedCapableWeapon, reactionMovePool, isMeleeReachable } from '@/packages/combat';
import { canRangedTarget } from '@/packages/movement';
import { arcOfTarget } from '@/packages/primitives';
import { DEFAULT_GRID_RADIUS, HEX_DIRS, hexRing, computeOccupiedHexes, airOccupiedHexes, computeThreatHexes, MapBackgroundConfig, terrainCostOf, makeCostOfHex, makeBlockedEdge, makeChargeBlockedEdge, TerrainCosts } from '@/packages/world';
import { Walls, EdgeRef } from '@/packages/movement';
import { MapStructures, doorPassThroughHexes, entryBreakFormation, structureSurfaceAt, flightBlockedHexes } from '@/packages/movement';
import { StructureTemplate } from '@/types/structure';
import { GroundEffect } from '@/types/gameProtocol';
import { rangeBonusAt, unitIgnoresClimb } from '@/packages/effects';
import { edgeHexes } from '@/packages/combat';
import { canWithdraw, withdrawDestinations, WITHDRAW_ACTION_COST } from '@/packages/movement';
import { moveBudgetUnit, parseClimbTo, isAirborne } from '@/packages/movement';
import { isStooping } from '@/packages/combat';

/** Hovered unit's imposed kill-zone/ZoC tint: its two front hexes at the same
 *  elevation PLUS the hex directly below it when it is an actually-airborne
 *  formed flyer (the same unified rule as the drag threat overlay). */
function getOverlayForUnit(unit: Unit, structures?: MapStructures, templates?: Record<string, StructureTemplate>): Record<string, string> {
  const result: Record<string, string> = {};
  const ownSurface = structureSurfaceAt(unit.hex, structures, templates);
  const exclude = (u: Unit) => u.isHero || !!u.attachedToUnitId;
  const targetElevation = unit.elevation ?? 0;
  // The unit's OWN hex (cyan) so an offset/elevated token's home hex is obvious.
  // Set first: a flyer's vertical-ZoC red still overrides its own hex.
  result[`${unit.hex.q},${unit.hex.r}`] = 'rgba(120, 200, 255, 0.4)';
  for (const dirIdx of frontArcIndices(unit.facing)) {
    const dir = HEX_DIRS[dirIdx];
    const H: Hex = { q: unit.hex.q + dir.q, r: unit.hex.r + dir.r, s: -unit.hex.q - dir.q - unit.hex.r - dir.r };
    if (imposesKillZone(unit, H, { targetElevation, ownSurface, exclude })) {
      result[`${H.q},${H.r}`] = 'rgba(255, 100, 100, 0.5)';
    }
  }
  // Vertical: an airborne formed flyer dominates its own hex ≤10 ft below.
  if (imposesKillZone(unit, unit.hex, { targetElevation: targetElevation - 1, ownSurface, exclude, requireFormed: true })) {
    result[`${unit.hex.q},${unit.hex.r}`] = 'rgba(255, 100, 100, 0.5)';
  }
  return result;
}

export interface OverlayState {
  reactionMode: { archer: Unit; moverId: string } | null;
  draggingUnitId: string | null;
  hoveredUnit: Unit | null;
  units: Unit[];
  alliances: Record<string, AllianceGroup>;
  formationsMap: Record<string, Formation>;
  freeMove: boolean;
  backgroundConfig: MapBackgroundConfig | null;
  rangeViolationHex: Hex | null;
  terrainCosts?: TerrainCosts;
  walls?: Walls;
  /** Placed structures + templates + ground zones (entry gates for the overlay). */
  structures?: MapStructures;
  templates?: Record<string, StructureTemplate>;
  zones?: GroundEffect[];
  /** Wall edge under the pointer while dragging (drag-to-attack hint). */
  hoveredEdge?: EdgeRef | null;
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
    walls,
    structures,
    templates,
    zones,
    hoveredEdge,
  } = state;

  const isMountedOf = (u: Unit) => !!u.mountId || !!u.mountName;
  const costOfHexFor = (u: Unit) => makeCostOfHex(terrainCosts, walls, { structures, templates, isMounted: isMountedOf(u), waiveClimb: unitIgnoresClimb(u, zones) });
  const blockedEdgeFor = (u: Unit) => makeBlockedEdge(walls, { structures, templates, zones, orgLevel: getOrganizationLevel(u.currentFormation), isMounted: isMountedOf(u), waiveClimb: unitIgnoresClimb(u, zones), ignoreBlocks: freeMove });
  const chargeBlockedEdgeFor = (u: Unit) => makeChargeBlockedEdge(walls, { structures, templates, zones, orgLevel: getOrganizationLevel(u.currentFormation), isMounted: isMountedOf(u) });
  // Org-gate context: a `max_org_level_allowed` gate breaks the formation at the
  // crossing point (rescaling the movement budget) — mirrors handleUnitMove.
  const movementMultipliers: Record<string, number> = {};
  for (const [name, f] of Object.entries(formationsMap)) movementMultipliers[name] = f.movement_multiplier;
  const breakOnEntry = (fq: number, fr: number, tq: number, tr: number, formation: string) =>
    entryBreakFormation({ q: fq, r: fr }, { q: tq, r: tr }, formation, structures, templates, zones);
  const org = { movementMultipliers, breakOnEntry };

  // Reaction mode: the target is ALWAYS the unit that moved (persistently
  // highlighted). While dragging the reacting archer, hovering that mover shows
  // the shot rings; otherwise the full-action reposition hexes.
  if (reactionMode) {
    const archer = units.find(u => u.id === reactionMode.archer.id) ?? reactionMode.archer;
    const mover = units.find(u => u.id === reactionMode.moverId && !u.isDeleted) ?? null;
    const combined: Record<string, string> = {};
    const moverKey = mover ? `${mover.hex.q},${mover.hex.r}` : null;
    if (moverKey) combined[moverKey] = 'rgba(255, 80, 80, 0.55)'; // persistent target
    if (draggingUnitId === archer.id) {
      const weapon = parseWeapons(archer.weaponString || '')[archer.activeWeaponIndex ?? 0];
      const moverHover = !!hoveredUnit && hoveredUnit.id === reactionMode.moverId;
      if (moverHover && weapon && isRangedCapableWeapon(weapon)) {
        const allow = (h: Hex) => canRangedTarget(formationsMap[archer.currentFormation] ?? null, arcOfTarget(archer.hex, archer.facing, h));
        const archerRange = weapon.range + rangeBonusAt(archer, zones);
        for (const h of hexRing(archer.hex, archerRange)) {
          if (allow(h)) combined[`${h.q},${h.r}`] = 'rgba(255, 255, 255, 0.85)';
        }
        const d = hexDistance(archer.hex, mover!.hex);
        combined[moverKey!] = d <= weapon.range ? 'rgba(80, 220, 120, 0.8)' : 'rgba(255, 80, 80, 0.85)';
      } else {
        const maxMP = computeEffectiveMovement(archer, getFormationMultiplier(formationsMap, archer.currentFormation, 'movement_multiplier'));
        const budget = reactionMovePool(archer, maxMP);
        const occupied = computeOccupiedHexes(units, archer.id);
        const reachable = computeReachableMap(archer, budget, occupied, new Set(), costOfHexFor(archer), false, blockedEdgeFor(archer), undefined, undefined, org);
        reachable.forEach((entry, key) => {
          combined[key] = entry.needsTurn ? 'rgba(190, 190, 190, 0.55)' : 'rgba(255, 255, 255, 0.6)';
        });
      }
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
    // A climbing unit moves linearly: the target hex (up) and its own hex (down).
    if (draggedUnit.climbTo) {
      const t = parseClimbTo(draggedUnit.climbTo);
      const combined: Record<string, string> = {};
      if (t) combined[`${t.q},${t.r}`] = 'rgba(255, 255, 255, 0.6)';
      combined[`${draggedUnit.hex.q},${draggedUnit.hex.r}`] = 'rgba(160, 210, 255, 0.6)';
      return combined;
    }
    const surface = structureSurfaceAt(draggedUnit.hex, structures, templates);
    const flying = isAirborne(draggedUnit.elevation, surface);
    let occupied: Set<string>;
    if (flying) {
      occupied = airOccupiedHexes(units);
      for (const k of Array.from(flightBlockedHexes(structures, templates, draggedUnit.elevation ?? 0))) occupied.add(k);
    } else {
      occupied = computeOccupiedHexes(units, undefined, surface);
    }

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
      const effectiveMax = flying ? (draggedUnit.flySpeed ?? 0) : computeEffectiveMovement(draggedUnit, movementMult);
      const chargeReach = computeChargeReachable(
        draggedUnit, occupied, effectiveMax,
        flying ? undefined : costOfHexFor(draggedUnit),
        flying ? undefined : chargeBlockedEdgeFor(draggedUnit),
      );
      for (const [key, cost] of Array.from(chargeReach.entries())) {
        combined[key] = cost >= getSetting('charge_full_distance', 2) ? 'rgba(255, 255, 255, 0.6)' : 'rgba(255, 180, 60, 0.6)';
      }
      return combined;
    }

    const threatHexes = computeThreatHexes(units, draggingUnitId, alliances, formationsMap, structures, templates);

    // White reachable hexes for the dragged unit — one full pool (an action
    // converts to MP on move), or leftover MP only when 0 actions. A host with
    // an attached hero is capped by the hero's pool too (combined unit).
    const movementMult = getFormationMultiplier(formationsMap, draggedUnit.currentFormation, 'movement_multiplier');
    // Origin-mode pool: airborne units preview the fly pool (raw flySpeed), grounded
    // units the ground pool. A passenger on a fly move is passive (never caps it).
    const effectiveMax = flying ? (draggedUnit.flySpeed ?? 0) : computeEffectiveMovement(draggedUnit, movementMult);
    const budgetUnit = moveBudgetUnit(draggedUnit, flying ? 'fly' : 'ground');
    // Heroes show their full conversion potential (MP + actions × maxMP/5);
    // units show one pool (or leftover MP when no actions) — matching handleUnitMove.
    // Option 2 movement economy: the highlight pools every remaining action as
    // the MP budget (so an expensive single step is selectable), but the hex-step
    // cap stays at ONE move's pool so normal reach is unchanged.
    let budget = draggedUnit.isHero ? computeHeroMovePool(budgetUnit, effectiveMax) : computeMoveBudget(budgetUnit, effectiveMax);
    let hopCap = draggedUnit.isHero ? budget : computeMovePool(budgetUnit, effectiveMax);
    const attachedHero = draggedUnit.attachedToUnitId ? undefined : units.find(u => u.attachedToUnitId === draggedUnit.id && !u.isDeleted);
    if (!flying && attachedHero && attachedHero.attachedPosition !== 'rider') {
      const heroMult = getFormationMultiplier(formationsMap, attachedHero.currentFormation, 'movement_multiplier');
      const heroMax = computeEffectiveMovement(attachedHero, heroMult);
      const heroBudget = attachedHero.isHero ? computeHeroMovePool(attachedHero, heroMax) : computeMoveBudget(attachedHero, heroMax);
      const heroHop = attachedHero.isHero ? heroBudget : computeMovePool(attachedHero, heroMax);
      budget = Math.min(budget, heroBudget);
      hopCap = Math.min(hopCap, heroHop);
    }
    const passThrough = flying ? undefined : doorPassThroughHexes(structures, templates, occupied);
    const reachableMap = computeReachableMap(draggedUnit, budget, occupied, threatHexes, flying ? undefined : costOfHexFor(draggedUnit), false, flying ? undefined : blockedEdgeFor(draggedUnit), hopCap, passThrough, flying ? undefined : org);

    const combined: Record<string, string> = {};

    const activeWeapon = parseWeapons(draggedUnit.weaponString || '')[draggedUnit.activeWeaponIndex ?? 0];
    const isRanged = !!activeWeapon && activeWeapon.maxRange > 1;
    // A hovered unit is always a TARGET, never a movement destination: suppress
    // the movement paint so what you see is what the drop does.
    const hoveredIsUnit = !!hoveredUnit && hoveredUnit.id !== draggedUnit.id && !hoveredUnit.isDeleted;
    // A valid target: a hovered unit from a different alliance than the drag.
    const isValidTarget =
      hoveredIsUnit &&
      isHostile(hoveredUnit!.team, draggedUnit.team, alliances);

    if (hoveredIsUnit) {
      const targetKey = `${hoveredUnit!.hex.q},${hoveredUnit!.hex.r}`;
      if (!isValidTarget) {
        // Ally — cross-alliance attacks are hard-blocked; show it as invalid.
        combined[targetKey] = 'rgba(255, 80, 80, 0.7)';
        return combined;
      }
      // A stooping flyer hovering a GROUND enemy: the drop offers the charge-drop
      // (move onto the hex + free melee). Amber distinguishes it from a plain shot.
      if (isStooping(draggedUnit, structureSurfaceAt(draggedUnit.hex, structures, templates)) && (hoveredUnit!.elevation ?? 0) <= 0) {
        combined[targetKey] = 'rgba(255, 140, 60, 0.85)';
        return combined;
      }
      if (isRanged) {
        // Dragging a ranged unit over an enemy target: show range rings, clipped
        // to the formation's allowed ranged arcs (formed units: front cone only).
        const form = formationsMap[draggedUnit.currentFormation] ?? null;
        const allow = (h: Hex) => canRangedTarget(form, arcOfTarget(draggedUnit.hex, draggedUnit.facing, h));
        // Range effects / an occupant structure `range` aura extend the rings.
        const rangeBonus = rangeBonusAt(draggedUnit, zones);
        const minRange = activeWeapon!.range + rangeBonus;
        const maxRange = activeWeapon!.maxRange + rangeBonus;
        for (const h of hexRing(draggedUnit.hex, minRange)) {
          if (allow(h)) combined[`${h.q},${h.r}`] = 'rgba(255, 255, 255, 0.9)';
        }
        if (maxRange > minRange) {
          for (const h of hexRing(draggedUnit.hex, maxRange)) {
            if (allow(h)) combined[`${h.q},${h.r}`] = 'rgba(255, 180, 60, 0.9)';
          }
        }
        const d = hexDistance(draggedUnit.hex, hoveredUnit!.hex);
        let color = 'rgba(80, 220, 120, 0.8)';
        if (d > maxRange) color = 'rgba(255, 80, 80, 0.85)';
        else if (d > minRange) color = 'rgba(255, 180, 60, 0.85)';
        combined[targetKey] = color;
      } else if (isMeleeReachable(draggedUnit, hoveredUnit!)) {
        // Melee target in reach: mark it green (the drop attacks it, not a move).
        combined[targetKey] = 'rgba(80, 220, 120, 0.85)';
      } else {
        // Hostile but out of melee reach from the current hex (e.g. a 10-ft gap in
        // an ADJACENT hex — melee needs the same elevation or the same hex).
        combined[targetKey] = 'rgba(255, 80, 80, 0.7)';
      }
      return combined;
    }

    // Movement highlight only (no unit hovered).
    reachableMap.forEach((entry, key) => {
      // White = reachable straight ahead (droppable); light grey = needs a turn
      // first (hint only — the unit must rotate before moving there).
      combined[key] = entry.needsTurn ? 'rgba(190, 190, 190, 0.55)' : 'rgba(255, 255, 255, 0.5)';
    });
    // Withdraw: a formed unit may step one hex into an empty rear hex that is NOT
    // in a threat zone (no face change) — shown white/droppable like a move.
    // Not offered while airborne. The highlight appears only when the unit can
    // AFFORD it (2 actions, or free-move); when it can't, dropping on a rear hex
    // still opens the withdraw confirm (soft — actions may go negative).
    const canAffordWithdraw = freeMove || (draggedUnit.actionsAvailable ?? 0) >= WITHDRAW_ACTION_COST;
    if (!flying && canAffordWithdraw && canWithdraw(draggedUnit)) {
      const occupied = computeOccupiedHexes(units, draggedUnit.id, surface);
      const radius = backgroundConfig?.gridRadius ?? DEFAULT_GRID_RADIUS;
      for (const hx of withdrawDestinations(draggedUnit, occupied, radius, threatHexes)) {
        combined[`${hx.q},${hx.r}`] = 'rgba(255, 255, 255, 0.5)';
      }
    }
    for (const key of Array.from(threatHexes)) combined[key] = 'rgba(255, 100, 100, 0.5)';
    // Dropping on a wall edge the unit can reach attacks the barrier instead of
    // moving — tint the two hexes sharing that edge.
    if (hoveredEdge) {
      for (const hx of edgeHexes(hoveredEdge)) {
        combined[`${hx.q},${hx.r}`] = 'rgba(255, 140, 60, 0.85)';
      }
    }

    return combined;
  }
  if (hoveredUnit) {
    return getOverlayForUnit(hoveredUnit, structures, templates);
  }
  return {};
}

