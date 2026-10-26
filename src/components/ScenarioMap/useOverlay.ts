'use client';
// src/components/ScenarioMap/useOverlay.ts
// Drag-overlay computation: the hex highlight shown while dragging (reachable
// move hexes, threat zones, charge wedge, range rings, reaction rings) plus
// the hovered-unit front-arc tint. Pure function — ScenarioMap feeds it the
// grid state (draggingUnitId/hoveredUnit come from useHexGrid) in an effect.
import { Unit, Hex, AllianceGroup, Formation, hexDistance, getOrganizationLevel } from '@/types/gameProtocol';
import { computeReachableMap, computeMovePool, computeMoveBudget, computeHeroMoveBudget, computeHeroMovePool, computeChargeReachable, applyMoveCost, applyHeroMoveCost } from '@/packages/movement';
import { computeEffectiveMovement, getFormationMultiplier } from '@/packages/units';
import { getSetting } from '@/packages/infra';
import { imposesKillZone } from '@/packages/morale';
import { isHostile } from '@/packages/primitives';
import { frontArcIndices } from '@/packages/primitives';
import { parseWeapons } from '@/packages/units';
import { isRangedCapableWeapon, reactionMovePool, isMeleeReachable } from '@/packages/combat';
import { canRangedTarget, loosePassThroughHexes, formationOrgLevels, isLooseUnit } from '@/packages/movement';
import { arcOfTarget } from '@/packages/primitives';
import { DEFAULT_GRID_RADIUS, HEX_DIRS, hexRing, computeOccupiedHexes, computeThreatHexes, MapBackgroundConfig, terrainCostOf, makeCostOfHex, makeBlockedEdge, makeChargeBlockedEdge, TerrainCosts } from '@/packages/world';
import { Walls } from '@/packages/movement';
import { MapStructures, doorPassThroughHexes, entryBreakFormation, structureSurfaceAt, flightBlockedHexes } from '@/packages/movement';
import { StructureTemplate } from '@/types/structure';
import { GroundEffect } from '@/types/gameProtocol';
import { rangeBonusAt, unitIgnoresClimb } from '@/packages/effects';
import { canWithdraw, withdrawDestinations, WITHDRAW_ACTION_COST } from '@/packages/movement';
import { moveBudgetUnit, parseClimbTo, isAirborne, isClimbingUnit } from '@/packages/movement';
import { isSwooping } from '@/packages/combat';

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
  /** Aim facing for a loose (facing-less) charger's single front wedge (from the
   *  cursor hex). Ignored for formed units, which use their own facing. */
  chargeFacing?: number | null;
  /** Reactive archery: a threat/ZoC hex is a valid destination only as the move's
   *  first step (stop before it). Off = may stop ON it from any distance. */
  reactiveArchery?: boolean;
  /** Client toggle: label EVERY reachable preview hex (white + grey + withdraw)
   *  with its leftover MP, instead of only the movement-border hexes. */
  showAllMoveMp?: boolean;
  /** Client drag-preview mode: `'one'` = one action's pool per drag (default);
   *  `'all'` = every remaining action, colour-banded by actions spent. */
  movePreviewMode?: 'one' | 'all';
}

/** Drag-overlay output: per-hex fill colours, plus optional per-hex text labels
 *  (the leftover-MP numbers on the boundary of the reachable region). */
export interface OverlayData {
  fills: Record<string, string>;
  labels: Record<string, string>;
}

/**
 * Drag-preview fill for a reachable move hex. Droppable (no-turn) hexes are
 * white; turn-required hexes are the desaturated GREY hint (never droppable).
 * BOTH dim as more actions are spent (colour-blind safe — brightness not hue),
 * so the droppable/turn distinction reads by saturation even for colour-blind.
 */
function moveFill(needsTurn: boolean, actionsSpent: number): string {
  const alpha = Math.max(0.2, 0.6 - Math.max(0, actionsSpent - 1) * 0.13);
  return needsTurn
    ? `rgba(190, 190, 190, ${(alpha * 0.9).toFixed(2)})`
    : `rgba(255, 255, 255, ${alpha.toFixed(2)})`;
}

/**
 * Leftover-MP labels for a reachable set. `label(cost)` returns the text for a
 * hex. Default: only movement-BORDER hexes (a neighbour that is neither
 * reachable, the origin, nor a pass-through) — `0` is shown on a border.
 * `showAll`: label every reachable hex (white + grey).
 */
function labelsFor(
  reach: Map<string, { cost: number; needsTurn?: boolean }>,
  originKey: string,
  label: (cost: number) => string,
  showAll: boolean,
  passThrough?: Set<string>,
): Record<string, string> {
  const labels: Record<string, string> = {};
  reach.forEach((entry, key) => {
    const [q, r] = key.split(',').map(Number);
    const isBorder = HEX_DIRS.some(d => {
      const nk = `${q + d.q},${r + d.r}`;
      return nk !== originKey && !reach.has(nk) && !passThrough?.has(nk);
    });
    // Border hexes always label (incl. `0`); interior / grey hexes only when showAll.
    if (!showAll && (!isBorder || entry.needsTurn)) return;
    labels[key] = label(entry.cost);
  });
  return labels;
}

export function computeOverlayMap(state: OverlayState): OverlayData {
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
    chargeFacing,
    reactiveArchery = false,
    showAllMoveMp = false,
    movePreviewMode = 'one',
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
  const org = { movementMultipliers, breakOnEntry, orgLevels: formationOrgLevels(formationsMap) };

  // Reaction mode: the target is ALWAYS the unit that moved (persistently
  // highlighted). While dragging the reacting archer, hovering that mover shows
  // the shot rings; otherwise the full-action reposition hexes.
  if (reactionMode) {
    const archer = units.find(u => u.id === reactionMode.archer.id) ?? reactionMode.archer;
    const mover = units.find(u => u.id === reactionMode.moverId && !u.isDeleted) ?? null;
    const combined: Record<string, string> = {};
    const labels: Record<string, string> = {};
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
        const budgetUnit = moveBudgetUnit(archer, 'ground');
        const occupied = computeOccupiedHexes(units, archer.id);
        // A reaction reposition stops BEFORE a hostile kill zone (enter on a later
        // move) — `stopBeforeThreat`; normal moves are unaffected.
        const reactionThreats = computeThreatHexes(units, archer.id, alliances, formationsMap, structures, templates);
        const reachable = computeReachableMap(archer, budget, occupied, reactionThreats, costOfHexFor(archer), false, blockedEdgeFor(archer), undefined, undefined, org, reactiveArchery);
        reachable.forEach((entry, key) => {
          combined[key] = entry.needsTurn ? 'rgba(190, 190, 190, 0.55)' : 'rgba(255, 255, 255, 0.6)';
        });
        // Leftover-MP labels (same rule as a normal move preview).
        const originKey = `${archer.hex.q},${archer.hex.r}`;
        const leftFor = (cost: number) =>
          (archer.isHero ? applyHeroMoveCost(budgetUnit, cost, maxMP) : applyMoveCost(budgetUnit, cost, maxMP)).movementPointsAvailable;
        Object.assign(labels, labelsFor(reachable, originKey, cost => String(Math.max(0, Math.floor(leftFor(cost)))), showAllMoveMp));
      }
    }
    return { fills: combined, labels };
  }
  // Transient red flash on an out-of-range target (blocked drop).
  if (rangeViolationHex) {
    return { fills: { [`${rangeViolationHex.q},${rangeViolationHex.r}`]: 'rgba(255, 80, 80, 0.9)' }, labels: {} };
  }
  if (draggingUnitId) {
    const draggedUnit = units.find(u => u.id === draggingUnitId);
    if (!draggedUnit) return { fills: {}, labels: {} };
    // A climbing/hanging unit moves linearly: the target hex (up) and its own hex (down).
    if (isClimbingUnit(draggedUnit, structures, templates)) {
      const t = parseClimbTo(draggedUnit.climbTo);
      const combined: Record<string, string> = {};
      if (t) combined[`${t.q},${t.r}`] = 'rgba(255, 255, 255, 0.6)';
      combined[`${draggedUnit.hex.q},${draggedUnit.hex.r}`] = 'rgba(160, 210, 255, 0.6)';
      return { fills: combined, labels: {} };
    }
    const surface = structureSurfaceAt(draggedUnit.hex, structures, templates);
    const flying = isAirborne(draggedUnit.elevation, surface);
    let occupied: Set<string>;
    if (flying) {
      occupied = computeOccupiedHexes(units, undefined, 1);
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
      return { fills: combined, labels: {} };
    }

    // Charging units show their charge corridor: cost-1 hexes amber (charge
    // route — premature if you stop), cost 2+ white (full charge, free attack).
    const threatHexes = computeThreatHexes(units, draggingUnitId, alliances, formationsMap, structures, templates);
    if (draggedUnit.isCharging) {
      const combined: Record<string, string> = {};
      const movementMult = getFormationMultiplier(formationsMap, draggedUnit.currentFormation, 'movement_multiplier');
      const effectiveMax = flying ? (draggedUnit.flySpeed ?? 0) : computeEffectiveMovement(draggedUnit, movementMult);
      // A loose (facing-less) charger — e.g. a hero — has no front of its own, so
      // its wedge is aimed at the cursor hex (`chargeFacing`); a formed charger
      // keeps its own facing. Either way the cone is stopped by enemy kill zones.
      const loose = isLooseUnit(draggedUnit, formationsMap[draggedUnit.currentFormation]);
      const facing = loose && chargeFacing != null ? chargeFacing : draggedUnit.facing;
      const chargeReach = computeChargeReachable(
        { hex: draggedUnit.hex, facing }, occupied, effectiveMax,
        flying ? undefined : costOfHexFor(draggedUnit),
        flying ? undefined : chargeBlockedEdgeFor(draggedUnit),
        threatHexes,
        reactiveArchery,
      );
      for (const [key, cost] of Array.from(chargeReach.entries())) {
        combined[key] = cost >= getSetting('charge_full_distance', 2) ? 'rgba(255, 255, 255, 0.6)' : 'rgba(255, 180, 60, 0.6)';
      }
      // Leftover-MP labels for the corridor (border only, or every hex when the
      // client toggle is on) — the charge spends 1 MP per hex, so left = max - cost.
      const corridorReach = new Map<string, { cost: number }>();
      chargeReach.forEach((cost, key) => corridorReach.set(key, { cost }));
      const corridorLabels = labelsFor(corridorReach, `${draggedUnit.hex.q},${draggedUnit.hex.r}`, cost => String(Math.max(0, Math.floor(effectiveMax - cost))), showAllMoveMp);
      return { fills: combined, labels: corridorLabels };
    }

    // White reachable hexes for the dragged unit — one full pool (an action
    // converts to MP on move), or leftover MP only when 0 actions. A host with
    // an attached hero is capped by the hero's pool too (combined unit).
    const movementMult = getFormationMultiplier(formationsMap, draggedUnit.currentFormation, 'movement_multiplier');
    // Origin-mode pool: airborne units preview the fly pool (raw flySpeed), grounded
    // units the ground pool. A passenger on a fly move is passive (never caps it).
    const effectiveMax = flying ? (draggedUnit.flySpeed ?? 0) : computeEffectiveMovement(draggedUnit, movementMult);
    const budgetUnit = moveBudgetUnit(draggedUnit, flying ? 'fly' : 'ground');
    // Preview mode (client):
    //  - 'one' (default): the reach is exactly ONE action — units `computeMovePool`
    //    (full pool at 0 MP with an action, else leftover MP), heroes
    //    `computeHeroMovePool` (convert actions when MP < 1).
    //  - 'all': every remaining action — units `computeMoveBudget`, heroes
    //    `computeHeroMoveBudget`.
    // `budget = hopCap` so distance ↔ MP stay consistent. Over-budget hexes are NOT
    // highlighted (`allowBeyondBudget = false`) — the soft gate stays on the drop.
    const onePool = (bu: { movementPointsAvailable: number; actionsAvailable: number }, effMax: number, isHero: boolean): number =>
      isHero ? computeHeroMovePool(bu, effMax) : computeMovePool(bu, effMax);
    const allPool = (bu: { movementPointsAvailable: number; actionsAvailable: number }, effMax: number, isHero: boolean): number =>
      isHero ? computeHeroMoveBudget(bu, effMax) : computeMoveBudget(bu, effMax);
    const attachedHero = draggedUnit.attachedToUnitId ? undefined : units.find(u => u.attachedToUnitId === draggedUnit.id && !u.isDeleted);
    const heroBudgetUnit = (!flying && attachedHero && attachedHero.attachedPosition !== 'rider') ? moveBudgetUnit(attachedHero, 'ground') : null;
    const heroEffectiveMax = heroBudgetUnit
      ? computeEffectiveMovement(attachedHero!, getFormationMultiplier(formationsMap, attachedHero!.currentFormation, 'movement_multiplier'))
      : 0;
    let oneBudget = onePool(budgetUnit, effectiveMax, draggedUnit.isHero);
    let allBudget = allPool(budgetUnit, effectiveMax, draggedUnit.isHero);
    if (heroBudgetUnit) {
      oneBudget = Math.min(oneBudget, onePool(heroBudgetUnit, heroEffectiveMax, attachedHero!.isHero));
      allBudget = Math.min(allBudget, allPool(heroBudgetUnit, heroEffectiveMax, attachedHero!.isHero));
    }
    // Heroes keep the `{actions left}-{MP left}` label on action-funded hexes: only
    // hexes payable from materialized MP read as a plain MP number.
    const oneLabelBudget = draggedUnit.isHero
      ? Math.min(oneBudget, Math.max(0, Math.floor(budgetUnit.movementPointsAvailable)))
      : oneBudget;
    const budget = movePreviewMode === 'all' ? allBudget : oneBudget;
    const hopCap = budget;
    const passThrough = new Set<string>(Array.from(loosePassThroughHexes(units, draggedUnit, formationsMap, alliances, flying ? 'fly' : 'ground', surface)));
    if (!flying) for (const k of Array.from(doorPassThroughHexes(structures, templates, occupied))) passThrough.add(k);
    const reachableMap = computeReachableMap(draggedUnit, budget, occupied, threatHexes, flying ? undefined : costOfHexFor(draggedUnit), false, flying ? undefined : blockedEdgeFor(draggedUnit), hopCap, passThrough, flying ? undefined : org, reactiveArchery);

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
        return { fills: combined, labels: {} };
      }
      // A swooping flyer hovering a GROUND enemy: the drop offers the charge-drop
      // (move onto the hex + free melee). Amber distinguishes it from a plain shot.
      if (isSwooping(draggedUnit, structureSurfaceAt(draggedUnit.hex, structures, templates)) && (hoveredUnit!.elevation ?? 0) <= 0) {
        combined[targetKey] = 'rgba(255, 140, 60, 0.85)';
        return { fills: combined, labels: {} };
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
      } else if (isMeleeReachable(draggedUnit, hoveredUnit!, structures, templates)) {
        // Melee target in reach: mark it green (the drop attacks it, not a move).
        combined[targetKey] = 'rgba(80, 220, 120, 0.85)';
      } else {
        // Hostile but out of melee reach from the current hex (e.g. a 10-ft gap in
        // an ADJACENT hex — melee needs the same elevation or the same hex).
        combined[targetKey] = 'rgba(255, 80, 80, 0.7)';
      }
      return { fills: combined, labels: {} };
    }

    // Movement highlight only (no unit hovered). Droppable (no-turn) hexes are
    // white, banded brighter for fewer actions; turn-required hexes stay grey.
    const actionsSpentAt = (cost: number): number => {
      const start = draggedUnit.actionsAvailable ?? 0;
      const end = draggedUnit.isHero ? applyHeroMoveCost(budgetUnit, cost, effectiveMax) : applyMoveCost(budgetUnit, cost, effectiveMax);
      return Math.max(0, start - (end.actionsAvailable ?? 0));
    };
    reachableMap.forEach((entry, key) => {
      combined[key] = moveFill(!!entry.needsTurn, actionsSpentAt(entry.cost));
    });
    // Withdraw: a formed unit may step one hex into an empty rear hex that is NOT
    // in a threat zone (no face change). It is the only 2-ACTION action, so it is
    // drawn in a DIMMER white to set it apart from a one-action step. Not offered
    // while airborne; shown only when affordable (2 actions, or free-move).
    const canAffordWithdraw = freeMove || (draggedUnit.actionsAvailable ?? 0) >= WITHDRAW_ACTION_COST;
    let withdrawKeys: string[] = [];
    if (!flying && canAffordWithdraw && canWithdraw(draggedUnit)) {
      const occupied = computeOccupiedHexes(units, draggedUnit.id, surface);
      withdrawKeys = withdrawDestinations(draggedUnit, occupied, threatHexes).map(hx => `${hx.q},${hx.r}`);
      for (const key of withdrawKeys) combined[key] = 'rgba(255, 255, 255, 0.32)';
    }
    for (const key of Array.from(threatHexes)) combined[key] = 'rgba(255, 100, 100, 0.5)';

    // Leftover-MP labels. Default: the movement BORDER (a reachable hex with a
    // neighbour that is neither reachable, the origin, nor a pass-through) — `0`
    // is shown on a border. Client toggle: EVERY reachable hex (white + grey).
    // The stop is a wall / ZoC / occupied / elevation / map edge (or a next step
    // it can't afford), not an empty pool, so the number explains why it stopped.
    const originKey = `${draggedUnit.hex.q},${draggedUnit.hex.r}`;
    const leftFor = (cost: number) =>
      (draggedUnit.isHero ? applyHeroMoveCost(budgetUnit, cost, effectiveMax) : applyMoveCost(budgetUnit, cost, effectiveMax)).movementPointsAvailable;
    // A hex inside the ONE-action reach shows just the MP left; beyond it shows
    // `{actions left}-{MP left}`.
    const label = (cost: number): string => {
      const left = Math.max(0, Math.floor(leftFor(cost)));
      if (cost <= oneLabelBudget) return String(left);
      const spent = actionsSpentAt(cost);
      const actionsLeft = Math.max(0, (draggedUnit.actionsAvailable ?? 0) - spent);
      return `${actionsLeft}-${left}`;
    };
    const labels = labelsFor(reachableMap, originKey, label, showAllMoveMp, passThrough);
    // Withdraw destinations (2 actions, MP untouched) — `{actions left}-{MP left}`.
    if (showAllMoveMp) {
      const leftMp = String(Math.max(0, Math.floor(draggedUnit.movementPointsAvailable)));
      const afterWithdraw = Math.max(0, (draggedUnit.actionsAvailable ?? 0) - WITHDRAW_ACTION_COST);
      for (const key of withdrawKeys) labels[key] = `${afterWithdraw}-${leftMp}`;
    }

    return { fills: combined, labels };
  }
  if (hoveredUnit) {
    return { fills: getOverlayForUnit(hoveredUnit, structures, templates), labels: {} };
  }
  return { fills: {}, labels: {} };
}

